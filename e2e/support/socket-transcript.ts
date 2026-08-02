import { expect, type Page } from '@playwright/test';

export interface RecordedSocketEvent<T = unknown> {
  readonly name: string;
  readonly payload: T;
  readonly raw: string;
  readonly receivedAt: number;
}

export interface SocketTranscript {
  readonly events: RecordedSocketEvent[];
}

function decodeSocketPacket(raw: string): RecordedSocketEvent | undefined {
  const jsonStart = raw.indexOf('[');
  if (jsonStart === -1) return undefined;

  try {
    const packet: unknown = JSON.parse(raw.slice(jsonStart));
    if (!Array.isArray(packet) || typeof packet[0] !== 'string') return undefined;
    return {
      name: packet[0],
      payload: packet[1],
      raw,
      receivedAt: Date.now(),
    };
  } catch {
    return undefined;
  }
}

export function recordSocketTranscript(page: Page): SocketTranscript {
  const transcript: SocketTranscript = { events: [] };

  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      const raw =
        typeof frame.payload === 'string'
          ? frame.payload
          : Buffer.from(frame.payload).toString('utf8');
      for (const packet of raw.split('\u001e')) {
        const event = decodeSocketPacket(packet);
        if (event) transcript.events.push(event);
      }
    });
  });

  return transcript;
}

export function latestSocketEvent<T = unknown>(
  transcript: SocketTranscript,
  name: string,
  predicate: (payload: T) => boolean = () => true,
  afterIndex = 0,
): RecordedSocketEvent<T> | undefined {
  for (let index = transcript.events.length - 1; index >= afterIndex; index -= 1) {
    const event = transcript.events[index];
    if (event?.name === name && predicate(event.payload as T)) {
      return event as RecordedSocketEvent<T>;
    }
  }
  return undefined;
}

export async function waitForSocketEvent<T = unknown>(
  transcript: SocketTranscript,
  name: string,
  predicate: (payload: T) => boolean = () => true,
  options: {
    readonly afterIndex?: number;
    readonly timeout?: number;
    readonly description?: string;
  } = {},
): Promise<RecordedSocketEvent<T>> {
  const afterIndex = options.afterIndex ?? 0;
  let match: RecordedSocketEvent<T> | undefined;

  await expect
    .poll(
      () => {
        match = latestSocketEvent(transcript, name, predicate, afterIndex);
        return match !== undefined;
      },
      {
        message: options.description ?? `waiting for Socket.IO event ${name}`,
        timeout: options.timeout ?? 12_000,
      },
    )
    .toBe(true);

  if (!match) throw new Error(`Socket.IO event ${name} was not recorded`);
  return match;
}
