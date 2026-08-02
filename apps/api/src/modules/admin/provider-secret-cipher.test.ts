import { describe, expect, it } from 'vitest';
import {
  ProviderSecretCipher,
  createProviderSecretCipherFromEnv,
} from './provider-secret-cipher.js';

const key = (byte: number): Buffer => Buffer.alloc(32, byte);

describe('ProviderSecretCipher', () => {
  it('uses randomized, authenticated and versioned ciphertext', () => {
    const cipher = new ProviderSecretCipher(key(1));
    const plaintext = 'sk-sensitive-provider-secret';
    const first = cipher.encrypt(plaintext);
    const second = cipher.encrypt(plaintext);

    expect(first).toMatch(/^v1\.[a-f0-9]{16}\./);
    expect(first).not.toContain(plaintext);
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe(plaintext);
    expect(cipher.decrypt(second)).toBe(plaintext);
  });

  it('decrypts a previous key and rotates the ciphertext to the primary key', () => {
    const oldCipher = new ProviderSecretCipher(key(2));
    const ciphertext = oldCipher.encrypt('sk-rotate-me');
    const rotatingCipher = new ProviderSecretCipher(key(3), [key(2)]);
    const result = rotatingCipher.decryptAndRotate(ciphertext);

    expect(result).toMatchObject({ plaintext: 'sk-rotate-me', rotated: true });
    expect(result.ciphertext).not.toBe(ciphertext);
    expect(new ProviderSecretCipher(key(3)).decrypt(result.ciphertext)).toBe('sk-rotate-me');
  });

  it('rejects an unknown key and authentication-tag tampering without leaking details', () => {
    const ciphertext = new ProviderSecretCipher(key(4)).encrypt('sk-hidden');
    expect(() => new ProviderSecretCipher(key(5)).decrypt(ciphertext)).toThrow(
      'Provider credential could not be decrypted',
    );
    const parts = ciphertext.split('.');
    const authTag = Buffer.from(parts[4] ?? '', 'base64url');
    authTag[0] = (authTag[0] ?? 0) ^ 0xff;
    parts[4] = authTag.toString('base64url');
    const tampered = parts.join('.');
    expect(() => new ProviderSecretCipher(key(4)).decrypt(tampered)).toThrow(
      'Provider credential could not be decrypted',
    );
  });

  it('fails fast for missing, placeholder, or invalid production keys', () => {
    expect(() => createProviderSecretCipherFromEnv({ NODE_ENV: 'production' })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
    expect(() =>
      createProviderSecretCipherFromEnv({
        NODE_ENV: 'production',
        APP_ENCRYPTION_KEY: 'replace-with-a-real-key',
      }),
    ).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() =>
      createProviderSecretCipherFromEnv({
        NODE_ENV: 'production',
        APP_ENCRYPTION_KEY: Buffer.alloc(31, 1).toString('base64'),
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      createProviderSecretCipherFromEnv({
        NODE_ENV: 'production',
        APP_ENCRYPTION_KEY: `base64:${key(6).toString('base64')}`,
      }),
    ).not.toThrow();
  });
});
