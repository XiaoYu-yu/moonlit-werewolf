import type {
  GameAction,
  GamePhase as EngineGamePhase,
  ObserverPrivateState as EngineObserverPrivateState,
  PrivatePlayerState,
  PublicChatMessage,
  PublicRoomState as EnginePublicRoomState,
} from '@werewolf/contracts';

export type RoomConnectionMode = 'connecting' | 'live' | 'demo' | 'offline';

export type RequestedRoomMode = 'auto' | 'live' | 'demo';

export interface LiveAiSeatConfig {
  modelId: string;
  providerId: string;
  personality: 'logical' | 'cautious' | 'aggressive' | 'fun';
}

export interface LiveSeatState {
  id: string;
  number: number;
  kind: 'human' | 'ai' | 'ai_takeover';
  nickname: string;
  ready: boolean;
  connected: boolean;
  ai?: LiveAiSeatConfig;
}

export interface LiveRoomState {
  id: string;
  code: string;
  preset: 6 | 9 | 12;
  mode?: 'standard' | 'ai_observer';
  observerMode?: boolean;
  status: 'lobby' | 'playing' | 'finished';
  phase: EngineGamePhase | 'night';
  seats: readonly LiveSeatState[];
  version: number;
  phaseEndsAt?: number;
  isPaused: boolean;
  game?: EnginePublicRoomState;
  chatHistory: readonly PublicChatMessage[];
}

export type LivePrivatePlayerState =
  | PrivatePlayerState
  | {
      connected: true;
    };

export interface LiveGameEvent {
  readonly type: string;
  readonly id?: string;
  readonly at?: number;
  readonly message?: string;
  readonly version?: number;
  readonly [key: string]: unknown;
}

export interface PhaseTimerEvent {
  phaseEndsAt?: number;
  remainingMs?: number;
  serverNow?: number;
  version?: number;
}

export interface LiveRoomBootstrap {
  mode: 'live' | 'demo';
  room?: LiveRoomState;
  nickname: string;
  isHost: boolean;
  isObserver?: boolean;
  observerState?: ObserverPrivateState;
  ownSeatId?: string;
  savedAt: number;
}

export interface CreateRoomInput {
  inviteCode: string;
  preset: 6 | 9 | 12;
  nickname: string;
}

export interface AiSeatInput extends LiveAiSeatConfig {
  seatNumber: number;
  nickname?: string;
}

export interface CreateAiObserverRoomInput {
  inviteCode: string;
  preset: 6 | 9 | 12;
  lineup: readonly AiSeatInput[];
}

export type ObserverPrivateState = EngineObserverPrivateState;

export interface ProviderRecord {
  id: string;
  slug: string;
  name: string;
  kind: 'openai-compatible' | 'dashscope' | 'volcengine-ark';
  baseUrl: string;
  modelId: string;
  source: 'environment' | 'stored' | 'default';
  configured: boolean;
  enabled: boolean;
  status: 'ready' | 'disabled' | 'missing-credential' | 'error';
  concurrencyLimit: number;
  timeoutMs: number;
  dailyBudgetCents: number;
  fallbackProviderId?: string;
  maskedApiKey: string;
  createdAt?: string;
  updatedAt?: string;
  usage: ProviderUsageRecord;
}

export interface ProviderUsageRecord {
  calls: number;
  succeeded: number;
  failed: number;
  costCents: number;
  averageLatencyMs: number;
  lastError?: string;
  lastCalledAt?: string;
}

export interface AdminUsageSummary {
  calls: number;
  succeeded: number;
  failed: number;
  costCents: number;
  providers: number;
  averageLatencyMs: number;
  providerUsage: readonly (ProviderUsageRecord & { providerId: string })[];
}

export interface AdminDashboard {
  providers: readonly ProviderRecord[];
  usage: AdminUsageSummary;
}

export interface UpdateProviderInput {
  enabled?: boolean;
  concurrencyLimit?: number;
  timeoutMs?: number;
  dailyBudgetCents?: number;
  baseUrl?: string;
  apiKey?: string;
  fallbackProviderId?: string | null;
}

type ApiErrorKind =
  'validation' | 'authentication' | 'not_found' | 'conflict' | 'unavailable' | 'unknown';

const ROOM_BOOTSTRAP_PREFIX = 'werewolf.room.';
const REQUEST_TIMEOUT_MS = 7_000;
export const MAX_LIVE_ROOM_EVENTS = 120;

export function isLiveChatEvent(event: LiveGameEvent): boolean {
  return (
    event.type === 'chat.message' ||
    (event.type === 'ai.action' && typeof event.message === 'string')
  );
}

function liveEventIdentity(event: LiveGameEvent): string | undefined {
  if (typeof event.id === 'string' && event.id.length > 0) return `id:${event.id}`;
  if (!isLiveChatEvent(event) || typeof event.message !== 'string') return undefined;
  const actorId = typeof event.actorId === 'string' ? event.actorId : '';
  const at = typeof event.at === 'number' ? event.at : '';
  return `chat:${actorId}:${at}:${event.message}`;
}

export function mergeLiveRoomEvents(
  current: readonly LiveGameEvent[],
  incoming: readonly LiveGameEvent[],
  limit = MAX_LIVE_ROOM_EVENTS,
): readonly LiveGameEvent[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  const merged: LiveGameEvent[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const event of [...current, ...incoming]) {
    const identity = liveEventIdentity(event);
    if (identity === undefined) {
      merged.push(event);
      continue;
    }
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, merged.length);
      merged.push(event);
    } else {
      merged[existingIndex] = event;
    }
  }

  return merged.slice(-boundedLimit);
}

export function restoreSnapshotChatEvents(
  current: readonly LiveGameEvent[],
  chatHistory: readonly PublicChatMessage[] | undefined,
  limit = MAX_LIVE_ROOM_EVENTS,
): readonly LiveGameEvent[] {
  const nonChatEvents = current.filter((event) => !isLiveChatEvent(event));
  const snapshotEvents = (chatHistory ?? []).map((message): LiveGameEvent => ({ ...message }));
  return mergeLiveRoomEvents(nonChatEvents, snapshotEvents, limit);
}

export class LiveApiError extends Error {
  readonly status: number | undefined;
  readonly kind: ApiErrorKind;

  constructor(message: string, kind: ApiErrorKind, status?: number) {
    super(message);
    this.name = 'LiveApiError';
    this.kind = kind;
    this.status = status;
  }

  get allowsDemoFallback(): boolean {
    return this.kind === 'unavailable';
  }
}

function normalizedPublicApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    return process.env.NODE_ENV === 'development' ? 'http://localhost:3001/api/v1' : '/api/v1';
  }

  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith('/api/v1')) return withoutTrailingSlash;
  if (withoutTrailingSlash.endsWith('/api')) return `${withoutTrailingSlash}/v1`;
  return `${withoutTrailingSlash}/api/v1`;
}

export function getSocketNamespaceUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (configured) {
    const base = configured === '/' ? '' : configured.replace(/\/+$/, '');
    return `${base}/game`;
  }

  const apiUrl = normalizedPublicApiUrl();
  if (apiUrl.startsWith('/')) return '/game';

  try {
    return `${new URL(apiUrl).origin}/game`;
  } catch {
    return '/game';
  }
}

function apiUrl(path: string): string {
  return `${normalizedPublicApiUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const message = Reflect.get(payload, 'message');
  if (Array.isArray(message)) {
    return (
      message.filter((item): item is string => typeof item === 'string').join('；') || fallback
    );
  }
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (
      init.body !== undefined &&
      !(init.body instanceof FormData) &&
      !headers.has('Content-Type')
    ) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new LiveApiError(
        errorMessage(payload, `请求失败（${response.status}）`),
        kindForStatus(response.status),
        response.status,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof LiveApiError) throw error;
    const unavailableMessage =
      error instanceof DOMException && error.name === 'AbortError'
        ? '连接服务器超时，请稍后重试。'
        : '暂时无法连接游戏服务器。';
    throw new LiveApiError(unavailableMessage, 'unavailable');
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function createLiveRoom(input: CreateRoomInput): Promise<LiveRoomState> {
  const response = await apiRequest<{ room: LiveRoomState }>('/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.room;
}

export async function createAiObserverRoom(
  input: CreateAiObserverRoomInput,
): Promise<{ room: LiveRoomState; observer: ObserverPrivateState }> {
  return apiRequest<{ room: LiveRoomState; observer: ObserverPrivateState }>('/rooms/ai-observer', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchAiObserverState(code: string): Promise<ObserverPrivateState> {
  const response = await apiRequest<{ observer: ObserverPrivateState }>(
    `/rooms/${encodeURIComponent(code)}/observer`,
  );
  return response.observer;
}

export async function joinLiveRoom(code: string, nickname: string): Promise<LiveRoomState> {
  const response = await apiRequest<{ room: LiveRoomState }>(
    `/rooms/${encodeURIComponent(code)}/join`,
    {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    },
  );
  return response.room;
}

export async function configureLiveAiSeats(
  roomId: string,
  seats: readonly AiSeatInput[],
): Promise<LiveRoomState> {
  return apiRequest<LiveRoomState>(`/rooms/${encodeURIComponent(roomId)}/ai-seats`, {
    method: 'PUT',
    body: JSON.stringify({ seats }),
  });
}

export async function startLiveRoom(roomId: string): Promise<LiveRoomState> {
  return apiRequest<LiveRoomState>(`/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
  });
}

export async function fetchAdminDashboard(adminKey: string): Promise<AdminDashboard> {
  const headers = { 'x-admin-key': adminKey };
  const [providers, usage] = await Promise.all([
    apiRequest<readonly ProviderRecord[]>('/admin/providers', { headers }),
    apiRequest<AdminUsageSummary>('/admin/usage', { headers }),
  ]);
  return { providers, usage };
}

export async function updateAdminProvider(
  adminKey: string,
  providerSlug: string,
  input: UpdateProviderInput,
): Promise<ProviderRecord> {
  return apiRequest<ProviderRecord>(`/admin/providers/${encodeURIComponent(providerSlug)}`, {
    method: 'PATCH',
    headers: { 'x-admin-key': adminKey },
    body: JSON.stringify(input),
  });
}

export async function transcribeAudio(
  audio: Blob,
  filename = 'speech.webm',
): Promise<{ text: string; durationMs?: number; requestId?: string }> {
  const body = new FormData();
  body.append('file', audio, filename);
  return apiRequest('/audio/transcriptions', {
    method: 'POST',
    body,
  });
}

export function saveRoomBootstrap(code: string, bootstrap: LiveRoomBootstrap): void {
  try {
    window.sessionStorage.setItem(
      `${ROOM_BOOTSTRAP_PREFIX}${code.toUpperCase()}`,
      JSON.stringify(bootstrap),
    );
  } catch {
    // Private browsing/storage denial must never block room entry.
  }
}

export function loadRoomBootstrap(code: string): LiveRoomBootstrap | undefined {
  try {
    const raw = window.sessionStorage.getItem(`${ROOM_BOOTSTRAP_PREFIX}${code.toUpperCase()}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<LiveRoomBootstrap>;
    if (
      (parsed.mode !== 'live' && parsed.mode !== 'demo') ||
      typeof parsed.nickname !== 'string' ||
      typeof parsed.isHost !== 'boolean' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return undefined;
    }
    return parsed as LiveRoomBootstrap;
  } catch {
    return undefined;
  }
}

export function makeIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export type SubmitGameAction = GameAction extends infer Action
  ? Action extends { actorId: string }
    ? Omit<Action, 'actorId'>
    : never
  : never;
