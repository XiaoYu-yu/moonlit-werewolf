import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { extname } from 'node:path';

export const ABSOLUTE_TRANSCRIPTION_UPLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TRANSCRIPTION_MAX_SECONDS = 60;
export const MAX_CONFIGURED_TRANSCRIPTION_SECONDS = 120;

const CONTAINER_ALLOWANCE_BYTES = 64 * 1024;
const MAX_BROWSER_AUDIO_BYTES_PER_SECOND = 64 * 1024;

interface BrowserAudioFormat {
  readonly extensions: readonly string[];
  readonly hasExpectedContent: (bytes: Buffer) => boolean;
}

const BROWSER_AUDIO_FORMATS: Readonly<Record<string, BrowserAudioFormat>> = {
  'audio/webm': {
    extensions: ['.webm'],
    hasExpectedContent: (bytes) =>
      startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && bytes.includes(Buffer.from('A_OPUS', 'ascii')),
  },
  'audio/ogg': {
    extensions: ['.ogg'],
    hasExpectedContent: (bytes) =>
      startsWith(bytes, [0x4f, 0x67, 0x67, 0x53, 0x00]) &&
      bytes.includes(Buffer.from('OpusHead', 'ascii')),
  },
  'audio/mp4': {
    extensions: ['.m4a', '.mp4'],
    hasExpectedContent: (bytes) =>
      isIsoBaseMedia(bytes) && bytes.includes(Buffer.from('mp4a', 'ascii')),
  },
};

export interface ValidatedBrowserAudio {
  readonly bytes: Uint8Array;
  readonly mimeType: keyof typeof BROWSER_AUDIO_FORMATS;
  readonly filename: string;
}

export function transcriptionMaxSecondsFromEnvironment(
  value = process.env.TRANSCRIPTION_MAX_SECONDS,
): number {
  if (value === undefined || value.trim() === '') return DEFAULT_TRANSCRIPTION_MAX_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONFIGURED_TRANSCRIPTION_SECONDS) {
    throw new Error(
      `TRANSCRIPTION_MAX_SECONDS must be an integer between 1 and ${MAX_CONFIGURED_TRANSCRIPTION_SECONDS}`,
    );
  }
  return parsed;
}

export function transcriptionUploadBudget(maxSeconds: number): number {
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1) {
    throw new Error('maxSeconds must be a positive integer');
  }
  return Math.min(
    ABSOLUTE_TRANSCRIPTION_UPLOAD_BYTES,
    CONTAINER_ALLOWANCE_BYTES + maxSeconds * MAX_BROWSER_AUDIO_BYTES_PER_SECOND,
  );
}

export function validateBrowserAudioFile(
  file: Express.Multer.File,
  maxSeconds: number,
): ValidatedBrowserAudio {
  if (!(file.buffer instanceof Uint8Array) || file.buffer.byteLength === 0) {
    throw new BadRequestException('Audio file is empty');
  }

  const uploadBudget = transcriptionUploadBudget(maxSeconds);
  if (file.buffer.byteLength > uploadBudget) {
    throw new PayloadTooLargeException(
      `Audio exceeds the ${maxSeconds}-second encoded upload budget`,
    );
  }

  const mimeType = normalizedMimeType(file.mimetype);
  const format = BROWSER_AUDIO_FORMATS[mimeType];
  if (!format) {
    throw new UnsupportedMediaTypeException('Unsupported browser audio MIME type');
  }

  const extension = extname(file.originalname ?? '').toLowerCase();
  if (!format.extensions.includes(extension)) {
    throw new UnsupportedMediaTypeException(
      'Audio filename extension does not match its MIME type',
    );
  }

  const bytes = Buffer.from(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
  if (!format.hasExpectedContent(bytes)) {
    throw new UnsupportedMediaTypeException(
      'Audio content does not match the declared browser audio format',
    );
  }

  return {
    bytes,
    mimeType,
    filename: `speech${extension}`,
  };
}

function normalizedMimeType(value: string): keyof typeof BROWSER_AUDIO_FORMATS {
  const [base = '', ...parameters] = value
    .trim()
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());
  const supportedParameters = parameters.every((parameter) => {
    if (parameter === '') return true;
    if (!parameter.startsWith('codecs=')) return false;
    const codec = parameter.slice('codecs='.length).replaceAll('"', '');
    if (base === 'audio/mp4') return codec.startsWith('mp4a');
    return codec === 'opus';
  });
  if (!supportedParameters) return '';
  return base as keyof typeof BROWSER_AUDIO_FORMATS;
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function isIsoBaseMedia(bytes: Buffer): boolean {
  if (bytes.byteLength < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  const boxSize = bytes.readUInt32BE(0);
  return boxSize === 1 ? bytes.byteLength >= 24 : boxSize >= 16 && boxSize <= bytes.byteLength;
}
