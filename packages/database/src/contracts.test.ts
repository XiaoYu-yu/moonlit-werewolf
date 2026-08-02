import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { EventStore, PersistedEvent } from './index.js';

class MemoryEventStore implements EventStore {
  readonly events: PersistedEvent[] = [];

  async append<TPayload>(
    event: Omit<PersistedEvent<TPayload>, 'sequence' | 'createdAt'>,
  ): Promise<PersistedEvent<TPayload>> {
    const stored = {
      ...event,
      sequence: this.events.length + 1,
      createdAt: new Date(0),
    };
    this.events.push(stored);
    return stored;
  }

  async read(matchId: string, afterSequence = 0): Promise<readonly PersistedEvent[]> {
    return this.events.filter(
      (event) => event.matchId === matchId && event.sequence > afterSequence,
    );
  }
}

describe('EventStore contract', () => {
  it('supports ordered replay after a sequence', async () => {
    const store = new MemoryEventStore();
    await store.append({ matchId: 'm1', type: 'started', payload: {} });
    await store.append({ matchId: 'm1', type: 'voted', payload: { seat: 2 } });
    expect(await store.read('m1', 1)).toMatchObject([{ sequence: 2, type: 'voted' }]);
  });

  it('ships a PostgreSQL initial migration for the current schema', async () => {
    const migrationsDirectory = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const entries = await readdir(migrationsDirectory, { withFileTypes: true });
    const initial = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('_init'));
    expect(initial).toBeDefined();
    const sql = await readFile(
      new URL(`../prisma/migrations/${initial?.name}/migration.sql`, import.meta.url),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE "Room"');
    expect(sql).toContain('CREATE TABLE "GameEvent"');
    expect(sql).toContain('CREATE TYPE "GamePhase"');
  });
});
