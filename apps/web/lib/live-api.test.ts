import type { PublicChatMessage } from '@werewolf/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_LIVE_ROOM_EVENTS, mergeLiveRoomEvents, restoreSnapshotChatEvents } from './live-api';
import type { LiveGameEvent, LiveRoomState } from './live-api';

function chatMessage(id: string, message: string): PublicChatMessage {
  return {
    id,
    type: 'chat.message',
    actorId: 'seat-2',
    seatNumber: 2,
    nickname: '二号玩家',
    message,
    at: 1_000,
    round: 2,
    phase: 'discussion',
  };
}

describe('live room chat restoration', () => {
  it('maps bounded public history into a live room snapshot contract', () => {
    const history = [chatMessage('chat-1', '公开信息')];
    const room: LiveRoomState = {
      id: 'room-1',
      code: 'ABC123',
      preset: 6,
      status: 'playing',
      phase: 'discussion',
      seats: [],
      version: 3,
      isPaused: false,
      chatHistory: history,
    };

    expect(room.chatHistory).toEqual(history);
    expect(room.chatHistory[0]).toMatchObject({
      round: 2,
      phase: 'discussion',
      seatNumber: 2,
    });
  });

  it('restores authoritative snapshot chat and deduplicates its realtime twin by id', () => {
    const realtime: LiveGameEvent = {
      id: 'chat-1',
      type: 'ai.action',
      actorId: 'seat-2',
      message: '同一条 AI 发言',
      at: 1_000,
    };
    const systemEvent: LiveGameEvent = { type: 'phase.changed', version: 5 };
    const restored = restoreSnapshotChatEvents(
      [systemEvent, realtime],
      [chatMessage('chat-1', '同一条 AI 发言')],
    );

    expect(restored.filter((event) => event.id === 'chat-1')).toHaveLength(1);
    expect(restored.find((event) => event.id === 'chat-1')?.type).toBe('chat.message');
    expect(restored).toContain(systemEvent);

    const repeated = mergeLiveRoomEvents(restored, [realtime]);
    expect(repeated.filter((event) => event.id === 'chat-1')).toHaveLength(1);
  });

  it('retains only the latest configured number of live events', () => {
    const events = Array.from({ length: MAX_LIVE_ROOM_EVENTS + 10 }, (_, index) => ({
      type: 'phase.changed',
      version: index,
    }));
    const merged = mergeLiveRoomEvents([], events);

    expect(merged).toHaveLength(MAX_LIVE_ROOM_EVENTS);
    expect(merged[0]?.version).toBe(10);
    expect(merged.at(-1)?.version).toBe(MAX_LIVE_ROOM_EVENTS + 9);
  });
});
