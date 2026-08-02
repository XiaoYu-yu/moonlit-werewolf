import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { TranscriptionAdapter } from '@werewolf/ai-gateway';
import { describe, expect, it, vi } from 'vitest';
import {
  transcriptionMaxSecondsFromEnvironment,
  transcriptionUploadBudget,
  validateBrowserAudioFile,
} from './audio-validation.js';
import { AudioService } from './audio.service.js';

function uploadedAudio(bytes: Buffer, mimetype: string, originalname: string): Express.Multer.File {
  return {
    buffer: bytes,
    mimetype,
    originalname,
    size: bytes.byteLength,
  } as Express.Multer.File;
}

function webmAudio(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from('browser-audio-A_OPUS-payload', 'ascii'),
  ]);
}

function oggAudio(): Buffer {
  return Buffer.concat([
    Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00]),
    Buffer.from('browser-audio-OpusHead-payload', 'ascii'),
  ]);
}

function mp4Audio(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('isom', 8, 'ascii');
  bytes.write('mp4a', 16, 'ascii');
  return bytes;
}

describe('browser audio validation', () => {
  it.each([
    ['audio/webm;codecs=opus', 'speech.webm', webmAudio(), 'audio/webm'],
    ['audio/ogg;codecs=opus', 'speech.ogg', oggAudio(), 'audio/ogg'],
    ['audio/mp4', 'speech.m4a', mp4Audio(), 'audio/mp4'],
  ] as const)('accepts a matching %s upload', (mime, filename, bytes, normalizedMime) => {
    expect(validateBrowserAudioFile(uploadedAudio(bytes, mime, filename), 60)).toMatchObject({
      mimeType: normalizedMime,
      filename,
    });
  });

  it('rejects empty, unsupported, mismatched and forged uploads', () => {
    expect(() =>
      validateBrowserAudioFile(uploadedAudio(Buffer.alloc(0), 'audio/webm', 'speech.webm'), 60),
    ).toThrow(BadRequestException);
    expect(() =>
      validateBrowserAudioFile(uploadedAudio(webmAudio(), 'audio/wav', 'speech.wav'), 60),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      validateBrowserAudioFile(uploadedAudio(webmAudio(), 'audio/webm', 'speech.ogg'), 60),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      validateBrowserAudioFile(
        uploadedAudio(Buffer.from('not-a-container-A_OPUS'), 'audio/webm', 'speech.webm'),
        60,
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('applies a conservative byte budget derived from the configured seconds', () => {
    const bytes = Buffer.alloc(transcriptionUploadBudget(1) + 1);
    expect(() =>
      validateBrowserAudioFile(uploadedAudio(bytes, 'audio/webm', 'speech.webm'), 1),
    ).toThrow(PayloadTooLargeException);
    expect(transcriptionMaxSecondsFromEnvironment(undefined)).toBe(60);
    expect(transcriptionMaxSecondsFromEnvironment('55')).toBe(55);
    expect(() => transcriptionMaxSecondsFromEnvironment('0')).toThrow(/TRANSCRIPTION_MAX_SECONDS/);
    expect(() => transcriptionMaxSecondsFromEnvironment('121')).toThrow(
      /TRANSCRIPTION_MAX_SECONDS/,
    );
  });
});

describe('AudioService', () => {
  it('passes only normalized validated bytes to the transcription adapter', async () => {
    const transcribe = vi.fn(async () => ({ text: ' 可信转写 ', durationMs: 12_000 }));
    const adapter: TranscriptionAdapter = { id: 'test', transcribe };
    const service = new AudioService(adapter);

    await expect(
      service.transcribe(uploadedAudio(webmAudio(), 'audio/webm;codecs=opus', 'recording.webm')),
    ).resolves.toMatchObject({ text: ' 可信转写 ' });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'audio/webm',
        filename: 'speech.webm',
        language: 'zh',
      }),
    );
  });

  it('rejects a provider-confirmed duration above the configured default limit', async () => {
    const adapter: TranscriptionAdapter = {
      id: 'test',
      transcribe: vi.fn(async () => ({ text: '过长', durationMs: 60_001 })),
    };
    const service = new AudioService(adapter);
    await expect(
      service.transcribe(uploadedAudio(webmAudio(), 'audio/webm', 'speech.webm')),
    ).rejects.toThrow(BadRequestException);
  });
});
