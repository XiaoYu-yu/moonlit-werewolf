import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  AiSeatDto,
  ChatEventDto,
  CreateAiObserverRoomDto,
  GameActionEventDto,
  HostControlEventDto,
  ReadyEventDto,
} from './rooms.dto.js';

describe('Socket event DTOs', () => {
  it('validates nested chat payloads instead of accepting a generic interface', async () => {
    const invalid = plainToInstance(ChatEventDto, {
      code: 'ROOM01',
      payload: { message: '', forgedSender: 'other-player' },
    });
    const errors = await validate(invalid, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'payload')).toBe(true);
  });

  it('rejects malformed nested game actions', async () => {
    const invalid = plainToInstance(GameActionEventDto, {
      code: 'ROOM01',
      payload: {
        idempotencyKey: 'short',
        type: 'seer_check',
      },
    });
    const errors = await validate(invalid, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'payload')).toBe(true);
  });

  it('rejects unknown nested ready fields and invalid host commands', async () => {
    const invalidReady = plainToInstance(ReadyEventDto, {
      code: 'ROOM01',
      payload: { ready: true, actorId: 'forged-player' },
    });
    const invalidHost = plainToInstance(HostControlEventDto, {
      code: 'ROOM01',
      payload: { command: 'end-game' },
    });
    const options = { whitelist: true, forbidNonWhitelisted: true };

    expect(
      (await validate(invalidReady, options)).some((error) => error.property === 'payload'),
    ).toBe(true);
    expect(
      (await validate(invalidHost, options)).some((error) => error.property === 'payload'),
    ).toBe(true);
  });

  it('uses the shared fun personality value and rejects the retired alias', async () => {
    const valid = plainToInstance(AiSeatDto, {
      seatNumber: 2,
      modelId: 'model',
      providerId: 'deepseek',
      personality: 'fun',
    });
    const drifted = plainToInstance(AiSeatDto, {
      seatNumber: 2,
      modelId: 'model',
      providerId: 'deepseek',
      personality: 'entertaining',
    });

    expect(await validate(valid)).toHaveLength(0);
    expect((await validate(drifted)).some((error) => error.property === 'personality')).toBe(true);
  });

  it('accepts only Kimi and DeepSeek for playable AI seats', async () => {
    const deepseek = plainToInstance(AiSeatDto, {
      seatNumber: 2,
      modelId: 'deepseek-v4-flash',
      providerId: 'deepseek',
      personality: 'logical',
    });
    const retired = plainToInstance(AiSeatDto, {
      seatNumber: 2,
      modelId: 'qwen-plus',
      providerId: 'qwen',
      personality: 'logical',
    });

    expect(await validate(deepseek)).toHaveLength(0);
    expect((await validate(retired)).some((error) => error.property === 'providerId')).toBe(true);
  });

  it('validates a complete observer lineup as nested DTOs', async () => {
    const valid = plainToInstance(CreateAiObserverRoomDto, {
      inviteCode: 'MOONLIT-TEST',
      preset: 6,
      lineup: Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        providerId: index % 2 === 0 ? 'kimi' : 'deepseek',
        personality: 'cautious',
      })),
    });
    const invalid = plainToInstance(CreateAiObserverRoomDto, {
      inviteCode: 'MOONLIT-TEST',
      preset: 6,
      lineup: Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        providerId: index === 0 ? 'glm' : 'kimi',
        personality: 'cautious',
        forgedSecret: 'never-accepted',
      })),
    });
    const options = { whitelist: true, forbidNonWhitelisted: true };

    expect(await validate(valid, options)).toHaveLength(0);
    expect((await validate(invalid, options)).some((error) => error.property === 'lineup')).toBe(
      true,
    );
  });
});
