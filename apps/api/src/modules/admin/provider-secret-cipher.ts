import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const CIPHER_VERSION = 'v1';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD_PREFIX = 'werewolf-provider-api-key';
const DEVELOPMENT_KEY = createHash('sha256')
  .update('werewolf-development-only-provider-secret-key')
  .digest();

export interface RotatedProviderSecret {
  readonly plaintext: string;
  readonly ciphertext: string;
  readonly rotated: boolean;
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    [
      'changeme',
      'change-me',
      'dev-encryption-key',
      'example',
      'placeholder',
      'replace-me',
      'secret',
    ].some((placeholder) => lower === placeholder || lower.includes(placeholder)) ||
    /^(?:your|replace|change)[-_ ]/.test(lower) ||
    /^x+$/.test(lower)
  );
}

function strictBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : undefined;
}

export function parseProviderEncryptionKey(
  raw: string,
  variableName = 'APP_ENCRYPTION_KEY',
): Buffer {
  if (raw !== raw.trim() || isPlaceholder(raw)) {
    throw new Error(`${variableName} must be a non-placeholder 32-byte key`);
  }

  let key: Buffer;
  if (raw.startsWith('base64:')) {
    const decoded = strictBase64(raw.slice('base64:'.length));
    if (!decoded) throw new Error(`${variableName} must contain valid base64`);
    key = decoded;
  } else if (raw.startsWith('hex:')) {
    const value = raw.slice('hex:'.length);
    if (!/^[a-fA-F0-9]{64}$/.test(value)) {
      throw new Error(`${variableName} must contain 64 hexadecimal characters`);
    }
    key = Buffer.from(value, 'hex');
  } else if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = strictBase64(raw) ?? Buffer.from(raw, 'utf8');
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(`${variableName} must decode to exactly ${KEY_BYTES} bytes`);
  }
  return key;
}

export class ProviderSecretCipher {
  readonly #primaryKey: Buffer;
  readonly #primaryKeyId: string;
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(primaryKey: Buffer, previousKeys: readonly Buffer[] = []) {
    if (primaryKey.length !== KEY_BYTES || previousKeys.some((key) => key.length !== KEY_BYTES)) {
      throw new Error('Provider encryption keys must be exactly 32 bytes');
    }
    this.#primaryKey = Buffer.from(primaryKey);
    this.#primaryKeyId = keyId(this.#primaryKey);
    this.#keys = new Map(
      [this.#primaryKey, ...previousKeys].map((key) => [keyId(key), Buffer.from(key)]),
    );
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const aad = Buffer.from(`${AAD_PREFIX}:${CIPHER_VERSION}:${this.#primaryKeyId}`, 'utf8');
    const cipher = createCipheriv('aes-256-gcm', this.#primaryKey, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      CIPHER_VERSION,
      this.#primaryKeyId,
      nonce.toString('base64url'),
      encrypted.toString('base64url'),
      authTag.toString('base64url'),
    ].join('.');
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split('.');
    if (parts.length !== 5 || parts[0] !== CIPHER_VERSION) {
      throw new Error('Provider credential could not be decrypted');
    }
    const [, encryptedKeyId, nonceText, encryptedText, authTagText] = parts;
    const key = encryptedKeyId ? this.#keys.get(encryptedKeyId) : undefined;
    if (!key || !nonceText || !authTagText) {
      throw new Error('Provider credential could not be decrypted');
    }

    try {
      const nonce = Buffer.from(nonceText, 'base64url');
      const encrypted = Buffer.from(encryptedText ?? '', 'base64url');
      const authTag = Buffer.from(authTagText, 'base64url');
      if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw new Error('Invalid encrypted credential');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(`${AAD_PREFIX}:${CIPHER_VERSION}:${encryptedKeyId}`, 'utf8'));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Provider credential could not be decrypted');
    }
  }

  decryptAndRotate(ciphertext: string): RotatedProviderSecret {
    const plaintext = this.decrypt(ciphertext);
    const encryptedKeyId = ciphertext.split('.')[1];
    if (encryptedKeyId === this.#primaryKeyId) {
      return { plaintext, ciphertext, rotated: false };
    }
    return {
      plaintext,
      ciphertext: this.encrypt(plaintext),
      rotated: true,
    };
  }
}

export function createProviderSecretCipherFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderSecretCipher {
  const rawPrimary = environment.APP_ENCRYPTION_KEY;
  if (!rawPrimary) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('APP_ENCRYPTION_KEY is required in production');
    }
    return new ProviderSecretCipher(DEVELOPMENT_KEY);
  }

  const previousKeys = (environment.APP_ENCRYPTION_KEY_PREVIOUS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) =>
      parseProviderEncryptionKey(value, `APP_ENCRYPTION_KEY_PREVIOUS[${index}]`),
    );
  return new ProviderSecretCipher(parseProviderEncryptionKey(rawPrimary), previousKeys);
}
