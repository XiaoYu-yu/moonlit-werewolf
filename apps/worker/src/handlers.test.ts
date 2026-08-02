import { describe, expect, it, vi } from 'vitest';
import type { AiGateway, TranscriptionAdapter } from '@werewolf/ai-gateway';
import type {
  AiBudgetPolicy,
  BudgetReservation,
  DistributedBudgetLedger,
} from './budget-ledger.js';
import { createJobHandlers } from './handlers.js';

const policy: AiBudgetPolicy = {
  dailyLimitCents: 100,
  matchLimitCents: 50,
  minReservationCents: 1,
  maxAttemptsPerProvider: 2,
  matchTtlSeconds: 86_400,
  settlementGraceSeconds: 3_600,
};

function acceptingLedger() {
  const reservation: BudgetReservation = {
    id: 'reservation-1',
    amountCents: 2,
    dailyKey: 'daily',
    matchKey: 'match',
    reservationKey: 'reservation',
    dailyTtlSeconds: 3_600,
    matchTtlSeconds: 86_400,
    reservationTtlSeconds: 86_400,
  };
  return {
    reserve: vi.fn(async () => ({ accepted: true as const, reservation })),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  } satisfies DistributedBudgetLedger;
}

describe('worker job handlers', () => {
  it('passes serializable AI job data into the gateway', async () => {
    const executeTurn = vi.fn(async () => ({
      action: { type: 'vote' as const, targetSeatId: 's2' },
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      costCents: 0.25,
    }));
    const ledger = acceptingLedger();
    const handlers = createJobHandlers({
      aiGateway: { executeTurn } as unknown as AiGateway,
      budgetLedger: ledger,
      budgetPolicy: policy,
      reservationId: () => 'reservation-1',
    });
    const result = await handlers.aiTurn({
      roomId: 'r1',
      matchId: 'm1',
      actorSeatId: 's1',
      primaryProviderId: 'local',
      request: { model: 'test', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['s2'],
      requireDecisionSummary: true,
      requireVisibleAnalysis: true,
      fallbackAction: { type: 'vote', targetSeatId: 's2' },
    });
    expect(result.action).toEqual({ type: 'vote', targetSeatId: 's2' });
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        requireDecisionSummary: true,
        requireVisibleAnalysis: true,
      }),
    );
    expect(ledger.settle).toHaveBeenCalledWith(expect.any(Object), 0.25);
  });

  it('decodes transcription audio only inside the worker', async () => {
    const transcribe = vi.fn(async () => ({ text: '天黑请闭眼' }));
    const adapter = { id: 'asr', transcribe } as TranscriptionAdapter;
    const handlers = createJobHandlers({
      aiGateway: {} as AiGateway,
      transcriptionAdapters: new Map([['asr', adapter]]),
    });
    const result = await handlers.transcription({
      providerId: 'asr',
      audioBase64: Buffer.from('audio').toString('base64'),
      mimeType: 'audio/webm',
      filename: 'speech.webm',
      transcriptionId: 't1',
    });
    expect(result.text).toBe('天黑请闭眼');
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: Buffer.from('audio') }),
    );
  });

  it('completes with a deterministic legal action when the gateway throws unexpectedly', async () => {
    const ledger = acceptingLedger();
    const handlers = createJobHandlers({
      aiGateway: {
        executeTurn: vi.fn(async () => {
          throw new Error('unexpected failure');
        }),
      } as unknown as AiGateway,
      budgetLedger: ledger,
      budgetPolicy: policy,
    });
    const result = await handlers.aiTurn({
      roomId: 'r1',
      matchId: 'm1',
      actorSeatId: 's1',
      primaryProviderId: 'missing',
      request: { model: 'test', messages: [] },
      actionType: 'night',
      allowedSeatIds: ['s2'],
      fallbackAction: { type: 'night', targetSeatId: 's2' },
    });
    expect(result).toMatchObject({
      action: { type: 'night', targetSeatId: 's2' },
      usedFallback: true,
      attempts: 0,
      costCents: 2,
    });
    expect(ledger.settle).toHaveBeenCalledWith(expect.any(Object), 2);
    expect(ledger.release).not.toHaveBeenCalled();
  });

  it('does not call a provider when Redis reservation fails', async () => {
    const executeTurn = vi.fn();
    const handlers = createJobHandlers({
      aiGateway: { executeTurn } as unknown as AiGateway,
      budgetLedger: {
        reserve: vi.fn(async () => {
          throw new Error('redis unavailable');
        }),
        settle: vi.fn(),
        release: vi.fn(),
      },
      budgetPolicy: policy,
    });

    const result = await handlers.aiTurn({
      roomId: 'r1',
      matchId: 'm1',
      actorSeatId: 's1',
      primaryProviderId: 'deepseek',
      request: { model: 'test', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['s2'],
      fallbackAction: { type: 'vote', targetSeatId: 's2' },
    });

    expect(executeTurn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: { type: 'vote', targetSeatId: 's2' },
      usedFallback: true,
      costCents: 0,
    });
    expect(result.failureReasons[0]).toMatch(/ledger unavailable/);
  });

  it('does not call a provider when either distributed budget is exhausted', async () => {
    const executeTurn = vi.fn();
    const handlers = createJobHandlers({
      aiGateway: { executeTurn } as unknown as AiGateway,
      budgetLedger: {
        reserve: vi.fn(async () => ({
          accepted: false as const,
          exhaustedScope: 'match' as const,
          usedCents: 50,
          limitCents: 50,
        })),
        settle: vi.fn(),
        release: vi.fn(),
      },
      budgetPolicy: policy,
    });

    const result = await handlers.aiTurn({
      roomId: 'r1',
      matchId: 'm1',
      actorSeatId: 's1',
      primaryProviderId: 'deepseek',
      request: { model: 'test', messages: [] },
      actionType: 'night',
      allowedSeatIds: ['s2'],
      fallbackAction: { type: 'night', targetSeatId: 's2' },
    });

    expect(executeTurn).not.toHaveBeenCalled();
    expect(result.failureReasons[0]).toMatch(/match budget exhausted/);
  });

  it('uses the BullMQ execution id as the deterministic reservation id', async () => {
    const executeTurn = vi.fn(async () => ({
      action: { type: 'vote' as const, abstain: true },
      attempts: 0,
      usedFallback: true,
      failureReasons: [],
      costCents: 0,
    }));
    const ledger = acceptingLedger();
    const handlers = createJobHandlers({
      aiGateway: { executeTurn } as unknown as AiGateway,
      budgetLedger: ledger,
      budgetPolicy: policy,
    });

    await handlers.aiTurn(
      {
        roomId: 'r1',
        matchId: 'm1',
        actorSeatId: 's1',
        primaryProviderId: 'deepseek',
        request: { model: 'test', messages: [] },
        actionType: 'vote',
        fallbackAction: { type: 'vote', abstain: true },
      },
      'werewolf-ai:job-42',
    );

    expect(ledger.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'werewolf-ai:job-42' }),
    );
  });

  for (const reservationState of ['active', 'settled', 'released'] as const) {
    it(`does not call the provider for a replayed ${reservationState} reservation`, async () => {
      const executeTurn = vi.fn();
      const settle = vi.fn();
      const release = vi.fn();
      const handlers = createJobHandlers({
        aiGateway: { executeTurn } as unknown as AiGateway,
        budgetLedger: {
          reserve: vi.fn(async () => ({
            accepted: false as const,
            replayed: true as const,
            reservationState,
          })),
          settle,
          release,
        },
        budgetPolicy: policy,
      });

      const result = await handlers.aiTurn(
        {
          roomId: 'r1',
          matchId: 'm1',
          actorSeatId: 's1',
          primaryProviderId: 'deepseek',
          request: { model: 'test', messages: [] },
          actionType: 'vote',
          fallbackAction: { type: 'vote', abstain: true },
        },
        'werewolf-ai:replayed-job',
      );

      expect(executeTurn).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(result.failureReasons[0]).toMatch(/replayed/);
    });
  }
});
