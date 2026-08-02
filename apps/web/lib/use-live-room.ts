'use client';

import { OBSERVER_PRIVATE_STATE_EVENT } from '@werewolf/contracts';
import type { Socket } from 'socket.io-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  configureLiveAiSeats,
  getSocketNamespaceUrl,
  LiveApiError,
  loadRoomBootstrap,
  mergeLiveRoomEvents,
  restoreSnapshotChatEvents,
  saveRoomBootstrap,
  startLiveRoom,
} from './live-api';
import type {
  AiSeatInput,
  LiveGameEvent,
  LivePrivatePlayerState,
  LiveRoomBootstrap,
  LiveRoomState,
  ObserverPrivateState,
  PhaseTimerEvent,
  RequestedRoomMode,
  RoomConnectionMode,
  SubmitGameAction,
} from './live-api';
import { normalizeObserverPrivateStateForRoom } from './observer-thoughts';

type PendingOperation = 'ready' | 'start' | 'chat' | 'action' | 'host' | null;

interface SocketAck {
  ok?: boolean;
  message?: string;
}

const SOCKET_ACK_TIMEOUT_MS = 6_000;

function observerCorrelation(room: LiveRoomState | undefined) {
  return {
    roomId: room?.id ?? '',
    gameId: room?.game?.gameId,
    roomMode: room?.mode,
  };
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof LiveApiError || error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = Reflect.get(error, 'message');
    if (typeof message === 'string') return message;
  }
  return '操作未完成，请稍后重试。';
}

function normalizeSocketError(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const message = Reflect.get(payload, 'message');
    if (typeof message === 'string') return message;
  }
  return '实时连接发生错误。';
}

export function hasPrivatePlayerState(
  state: LivePrivatePlayerState | undefined,
): state is Exclude<LivePrivatePlayerState, { connected: true }> {
  return state !== undefined && 'playerId' in state;
}

export function useLiveRoom(roomCode: string, requestedMode: RequestedRoomMode) {
  const normalizedCode = roomCode.toUpperCase();
  const socketRef = useRef<Socket | null>(null);
  const latestRoomVersionRef = useRef(0);
  const identityRef = useRef<LiveRoomBootstrap>({
    mode: requestedMode === 'demo' ? 'demo' : 'live',
    nickname: '',
    isHost: false,
    savedAt: Date.now(),
  });
  const [hydrated, setHydrated] = useState(false);
  const [connectEnabled, setConnectEnabled] = useState(requestedMode !== 'demo');
  const [retryNonce, setRetryNonce] = useState(0);
  const [mode, setMode] = useState<RoomConnectionMode>(
    requestedMode === 'demo' ? 'demo' : 'connecting',
  );
  const [room, setRoom] = useState<LiveRoomState>();
  const [privateState, setPrivateState] = useState<LivePrivatePlayerState>();
  const [observerState, setObserverState] = useState<ObserverPrivateState>();
  const [events, setEvents] = useState<readonly LiveGameEvent[]>([]);
  const [timerEndAt, setTimerEndAt] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<PendingOperation>(null);

  useEffect(() => {
    const stored = loadRoomBootstrap(normalizedCode);
    if (stored) {
      const validObserverState = normalizeObserverPrivateStateForRoom(
        stored.observerState,
        observerCorrelation(stored.room),
      );
      const { observerState: _discardedObserverState, ...storedIdentity } = stored;
      identityRef.current = {
        ...storedIdentity,
        ...(validObserverState ? { observerState: validObserverState } : {}),
      };
      if (stored.room) {
        latestRoomVersionRef.current = stored.room.version;
        setRoom(stored.room);
        setEvents((current) =>
          restoreSnapshotChatEvents(
            current,
            Array.isArray(stored.room?.chatHistory) ? stored.room.chatHistory : [],
          ),
        );
      }
      if (validObserverState) {
        setObserverState(validObserverState);
      }
    }

    const useDemo =
      requestedMode === 'demo' || (requestedMode === 'auto' && stored?.mode === 'demo');
    setConnectEnabled(!useDemo);
    setMode(useDemo ? 'demo' : 'connecting');
    setHydrated(true);
  }, [normalizedCode, requestedMode]);

  const persistSnapshot = useCallback(
    (snapshot: LiveRoomState) => {
      const validObserverState = normalizeObserverPrivateStateForRoom(
        identityRef.current.observerState,
        observerCorrelation(snapshot),
      );
      const { observerState: _discardedObserverState, ...currentIdentity } = identityRef.current;
      const nextBootstrap: LiveRoomBootstrap = {
        ...currentIdentity,
        mode: 'live',
        room: snapshot,
        ...(validObserverState ? { observerState: validObserverState } : {}),
        savedAt: Date.now(),
      };
      identityRef.current = nextBootstrap;
      setObserverState((current) =>
        normalizeObserverPrivateStateForRoom(current, observerCorrelation(snapshot)),
      );
      saveRoomBootstrap(normalizedCode, nextBootstrap);
    },
    [normalizedCode],
  );

  useEffect(() => {
    if (!hydrated || !connectEnabled) return;

    let disposed = false;
    let socket: Socket | undefined;

    const connect = async () => {
      try {
        const { io } = await import('socket.io-client');
        if (disposed) return;

        socket = io(getSocketNamespaceUrl(), {
          autoConnect: false,
          transports: ['websocket', 'polling'],
          withCredentials: true,
          reconnection: true,
          reconnectionAttempts: 8,
          reconnectionDelay: 500,
          reconnectionDelayMax: 4_000,
          timeout: 6_000,
        });
        socketRef.current = socket;

        const markUnavailable = (reason: string) => {
          if (disposed) return;
          setMode('offline');
          setError(reason);
        };

        const onConnect = () => {
          if (disposed || !socket) return;
          setMode('connecting');
          setError(undefined);
          socket
            .timeout(SOCKET_ACK_TIMEOUT_MS)
            .emit(
              'room.join',
              { code: normalizedCode },
              (ackError: Error | null, ack: SocketAck | undefined) => {
                if (disposed) return;
                if (ackError) {
                  markUnavailable('房间会话验证超时，请确认服务状态后重试。');
                  return;
                }
                if (ack?.ok === false) {
                  markUnavailable(ack.message ?? '无法加入该实时房间。');
                  return;
                }
                setMode('live');
              },
            );
        };

        const onConnectError = () => {
          markUnavailable('暂时无法连接实时房间，服务器可能尚未启动。');
        };

        const onDisconnect = (reason: string) => {
          if (disposed || reason === 'io client disconnect') return;
          setMode('connecting');
          setError('实时连接已中断，正在自动重连…');
        };

        const onSnapshot = (snapshot: LiveRoomState) => {
          if (
            !snapshot ||
            snapshot.code?.toUpperCase() !== normalizedCode ||
            typeof snapshot.version !== 'number'
          ) {
            return;
          }
          if (snapshot.version < latestRoomVersionRef.current) return;
          latestRoomVersionRef.current = snapshot.version;
          setRoom(snapshot);
          setEvents((current) =>
            restoreSnapshotChatEvents(
              current,
              Array.isArray(snapshot.chatHistory) ? snapshot.chatHistory : [],
            ),
          );
          setTimerEndAt(snapshot.phaseEndsAt);
          persistSnapshot(snapshot);
          setMode('live');
          setError(undefined);
        };

        const onPrivateState = (state: LivePrivatePlayerState) => {
          if (!state || typeof state !== 'object') return;
          if (
            'playerId' in state &&
            identityRef.current.ownSeatId !== undefined &&
            state.playerId !== identityRef.current.ownSeatId
          ) {
            return;
          }
          setPrivateState(state);
        };

        const onObserverState = (state: unknown) => {
          const validState = normalizeObserverPrivateStateForRoom(
            state,
            observerCorrelation(identityRef.current.room),
          );
          if (!validState) return;
          setObserverState(validState);
          identityRef.current = {
            ...identityRef.current,
            observerState: validState,
            savedAt: Date.now(),
          };
          saveRoomBootstrap(normalizedCode, identityRef.current);
        };

        const onGameEvent = (event: LiveGameEvent) => {
          if (!event || typeof event !== 'object') return;
          setEvents((current) => mergeLiveRoomEvents(current, [event]));
        };

        const onPhaseTimer = (timer: PhaseTimerEvent) => {
          if (!timer || typeof timer !== 'object') return;
          if (typeof timer.version === 'number' && timer.version < latestRoomVersionRef.current) {
            return;
          }
          if (typeof timer.phaseEndsAt === 'number') {
            const serverNow = typeof timer.serverNow === 'number' ? timer.serverNow : Date.now();
            setTimerEndAt(Date.now() + Math.max(0, timer.phaseEndsAt - serverNow));
          } else if (typeof timer.remainingMs === 'number') {
            setTimerEndAt(Date.now() + Math.max(0, timer.remainingMs));
          }
        };

        const onServerError = (payload: unknown) => {
          setError(normalizeSocketError(payload));
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onConnectError);
        socket.on('disconnect', onDisconnect);
        socket.on('room.snapshot', onSnapshot);
        socket.on('player.private_state', onPrivateState);
        socket.on(OBSERVER_PRIVATE_STATE_EVENT, onObserverState);
        socket.on('game.event', onGameEvent);
        socket.on('phase.timer', onPhaseTimer);
        socket.on('error', onServerError);
        socket.on('exception', onServerError);
        socket.connect();

        return () => {
          socket?.off('connect', onConnect);
          socket?.off('connect_error', onConnectError);
          socket?.off('disconnect', onDisconnect);
          socket?.off('room.snapshot', onSnapshot);
          socket?.off('player.private_state', onPrivateState);
          socket?.off(OBSERVER_PRIVATE_STATE_EVENT, onObserverState);
          socket?.off('game.event', onGameEvent);
          socket?.off('phase.timer', onPhaseTimer);
          socket?.off('error', onServerError);
          socket?.off('exception', onServerError);
        };
      } catch {
        if (!disposed) {
          setMode('offline');
          setError('实时客户端加载失败，可以刷新重试或进入本地演示。');
        }
      }
      return undefined;
    };

    let removeListeners: (() => void) | undefined;
    void connect().then((cleanup) => {
      if (disposed) {
        cleanup?.();
        socket?.disconnect();
        return;
      }
      removeListeners = cleanup;
    });

    return () => {
      disposed = true;
      removeListeners?.();
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [connectEnabled, hydrated, normalizedCode, persistSnapshot, retryNonce]);

  useEffect(() => {
    if (mode !== 'live') return;

    const heartbeat = () => {
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit('presence.heartbeat', { code: normalizedCode });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
    const interval = window.setInterval(heartbeat, 20_000);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode, normalizedCode]);

  const phaseEndAt = timerEndAt ?? room?.phaseEndsAt;
  useEffect(() => {
    if (mode !== 'live' || phaseEndAt === undefined || room?.isPaused) return;
    let interval: number | undefined;
    const stop = () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1_000);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', start);
    };
  }, [mode, phaseEndAt, room?.isPaused]);

  const seconds = phaseEndAt === undefined ? 0 : Math.max(0, Math.ceil((phaseEndAt - now) / 1_000));

  const emitWithAck = useCallback(
    (event: string, payload: unknown): Promise<SocketAck> =>
      new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error('实时连接尚未恢复，请稍后再试。'));
          return;
        }
        socket
          .timeout(SOCKET_ACK_TIMEOUT_MS)
          .emit(event, payload, (ackError: Error | null, ack: SocketAck | undefined) => {
            if (ackError) {
              reject(new Error('服务器未及时确认操作，请重试。'));
              return;
            }
            if (ack?.ok === false) {
              reject(new Error(ack.message ?? '服务器拒绝了该操作。'));
              return;
            }
            resolve(ack ?? { ok: true });
          });
      }),
    [],
  );

  const withPending = useCallback(
    async (
      operation: Exclude<PendingOperation, null>,
      task: () => Promise<void>,
    ): Promise<boolean> => {
      if (pending !== null) return false;
      setPending(operation);
      setError(undefined);
      try {
        await task();
        return true;
      } catch (operationError) {
        setError(messageFromUnknown(operationError));
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  const setReady = useCallback(
    (ready: boolean) =>
      withPending('ready', async () => {
        await emitWithAck('seat.ready', {
          code: normalizedCode,
          payload: { ready },
        });
      }),
    [emitWithAck, normalizedCode, withPending],
  );

  const sendChat = useCallback(
    (message: string) =>
      withPending('chat', async () => {
        await emitWithAck('chat.send', {
          code: normalizedCode,
          payload: { message },
        });
      }),
    [emitWithAck, normalizedCode, withPending],
  );

  const submitAction = useCallback(
    (action: SubmitGameAction & { idempotencyKey: string }) =>
      withPending('action', async () => {
        await emitWithAck('game.action.submit', {
          code: normalizedCode,
          payload: action,
        });
      }),
    [emitWithAck, normalizedCode, withPending],
  );

  const hostControl = useCallback(
    (command: 'pause' | 'resume' | 'advance') =>
      withPending('host', async () => {
        await emitWithAck('host.control', {
          code: normalizedCode,
          payload: { command },
        });
      }),
    [emitWithAck, normalizedCode, withPending],
  );

  const configureAndStart = useCallback(
    (aiSeats: readonly AiSeatInput[]) =>
      withPending('start', async () => {
        if (!room) throw new Error('房间信息尚未加载。');
        let snapshot = room;
        if (aiSeats.length > 0) {
          snapshot = await configureLiveAiSeats(room.id, aiSeats);
          setRoom(snapshot);
          persistSnapshot(snapshot);
        }
        await emitWithAck('seat.ready', {
          code: normalizedCode,
          payload: { ready: true },
        });
        snapshot = await startLiveRoom(room.id);
        setRoom(snapshot);
        persistSnapshot(snapshot);
      }),
    [emitWithAck, normalizedCode, persistSnapshot, room, withPending],
  );

  const enterDemo = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setConnectEnabled(false);
    setRoom(undefined);
    latestRoomVersionRef.current = 0;
    setPrivateState(undefined);
    setObserverState(undefined);
    setEvents([]);
    setError(undefined);
    setMode('demo');
    const bootstrap: LiveRoomBootstrap = {
      ...identityRef.current,
      mode: 'demo',
      savedAt: Date.now(),
    };
    identityRef.current = bootstrap;
    saveRoomBootstrap(normalizedCode, bootstrap);
  }, [normalizedCode]);

  const retry = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setError(undefined);
    setMode('connecting');
    setConnectEnabled(true);
    setRetryNonce((value) => value + 1);
  }, []);

  const ownSeat = useMemo(
    () => room?.seats.find((seat) => seat.id === identityRef.current.ownSeatId),
    [room],
  );

  return {
    mode,
    room,
    privateState,
    observerState,
    events,
    seconds,
    error,
    pending,
    isHost: identityRef.current.isHost,
    isObserver:
      room?.mode === 'ai_observer' &&
      (identityRef.current.isObserver === true || observerState?.isObserver === true),
    ownSeat,
    nickname: identityRef.current.nickname,
    setReady,
    sendChat,
    submitAction,
    hostControl,
    configureAndStart,
    enterDemo,
    retry,
  };
}
