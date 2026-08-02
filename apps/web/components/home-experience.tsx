'use client';

import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { activeAiModels, aiPersonalities } from '@/lib/ai-models';
import type { ActiveAiProviderId, AiPersonalityId } from '@/lib/ai-models';
import {
  createAiObserverRoom,
  createLiveRoom,
  joinLiveRoom,
  LiveApiError,
  saveRoomBootstrap,
} from '@/lib/live-api';
import { motionTokens } from '@/lib/motion';
import { haptic, playUiTone } from '@/lib/sensory';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';
import { SiteHeader } from './site-header';

type HomeMode = 'create' | 'join' | 'observe';
type HomeInputField = 'inviteCode' | 'nickname' | 'roomCode';

const homeModes: readonly HomeMode[] = ['create', 'join', 'observe'];

interface ObserverSeatDraft {
  personality: AiPersonalityId;
  providerId: ActiveAiProviderId;
}

function defaultObserverSeat(index: number): ObserverSeatDraft {
  return {
    providerId: activeAiModels[index % activeAiModels.length]?.providerId ?? 'deepseek',
    personality: aiPersonalities[index % aiPersonalities.length]?.id ?? 'logical',
  };
}

function makeObserverLineup(preset: 6 | 9 | 12): Record<number, ObserverSeatDraft> {
  return Object.fromEntries(
    Array.from({ length: preset }, (_, index) => [index + 1, defaultObserverSeat(index)]),
  );
}

export function HomeExperience() {
  const router = useRouter();
  const { preferences, tier } = useUiPreferences();
  const [mode, setMode] = useState<HomeMode>('create');
  const [nickname, setNickname] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [preset, setPreset] = useState<6 | 9 | 12>(9);
  const [observerLineup, setObserverLineup] = useState(() => makeObserverLineup(9));
  const [pending, setPending] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [errorField, setErrorField] = useState<HomeInputField>();
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const modeTabRefs = useRef<Record<HomeMode, HTMLButtonElement | null>>({
    create: null,
    join: null,
    observe: null,
  });
  const inputRefs = useRef<Record<HomeInputField, HTMLInputElement | null>>({
    inviteCode: null,
    nickname: null,
    roomCode: null,
  });
  const generatedCode = `DEMO${preset}`;
  const observerSeats = useMemo(
    () =>
      Array.from({ length: preset }, (_, index) => {
        const seatNumber = index + 1;
        return {
          seatNumber,
          ...(observerLineup[seatNumber] ?? defaultObserverSeat(index)),
        };
      }),
    [observerLineup, preset],
  );

  const clearFormError = () => {
    setFormError(undefined);
    setErrorField(undefined);
  };

  const switchMode = (next: HomeMode) => {
    setMode(next);
    clearFormError();
    setFallbackAvailable(false);
    playUiTone('tap', preferences);
    haptic('tap', preferences);
  };

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = homeModes.indexOf(mode);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % homeModes.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + homeModes.length) % homeModes.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = homeModes.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextMode = homeModes[nextIndex] as HomeMode;
    switchMode(nextMode);
    modeTabRefs.current[nextMode]?.focus();
  };

  const reportFieldError = (field: HomeInputField, message: string) => {
    setFormError(message);
    setErrorField(field);
    inputRefs.current[field]?.focus();
  };

  const openRoom = (destination: string, nextMode: 'live' | 'demo') => {
    playUiTone('confirm', preferences);
    haptic('confirm', preferences);
    setNavigating(true);
    window.setTimeout(
      () => {
        router.push(`/room/${encodeURIComponent(destination)}?mode=${nextMode}`);
      },
      tier === 'low' ? 0 : 140,
    );
  };

  const enterDemo = () => {
    const cleanNickname = nickname.trim() || '月下旅人';
    const destination =
      mode === 'join' ? roomCode.trim().toUpperCase() || generatedCode : generatedCode;
    saveRoomBootstrap(destination, {
      mode: 'demo',
      nickname: cleanNickname,
      isHost: true,
      savedAt: Date.now(),
    });
    openRoom(destination, 'demo');
  };

  const enterRoom = async () => {
    if (pending) return;
    const cleanNickname = nickname.trim();
    const cleanInvite = inviteCode.trim();
    const cleanRoomCode = roomCode.trim().toUpperCase();
    clearFormError();
    setFallbackAvailable(false);

    if (!cleanNickname) {
      if (mode !== 'observe') reportFieldError('nickname', '请先输入游戏昵称。');
      if (mode !== 'observe') return;
    }

    if (mode === 'observe' && !cleanInvite) {
      reportFieldError('inviteCode', '创建 AI 观战局需要建房邀请码。');
      return;
    }

    if (mode === 'create' && !cleanInvite) {
      enterDemo();
      return;
    }
    if ((mode === 'create' || mode === 'observe') && cleanInvite.length < 4) {
      reportFieldError('inviteCode', '建房邀请码至少需要 4 个字符。');
      return;
    }
    if (mode === 'join' && !/^[A-Z0-9_-]{4,12}$/.test(cleanRoomCode)) {
      reportFieldError('roomCode', '请输入 4–12 位有效房间码。');
      return;
    }

    setPending(true);
    try {
      const observerResponse =
        mode === 'observe'
          ? await createAiObserverRoom({
              inviteCode: cleanInvite,
              preset,
              lineup: observerSeats.map((seat) => {
                const model =
                  activeAiModels.find((item) => item.providerId === seat.providerId) ??
                  activeAiModels[0];
                return {
                  seatNumber: seat.seatNumber,
                  providerId: model.providerId,
                  modelId: model.modelId,
                  personality: seat.personality,
                  nickname: `${model.label} · ${seat.seatNumber}`,
                };
              }),
            })
          : undefined;
      const room = observerResponse
        ? observerResponse.room
        : mode === 'create'
          ? await createLiveRoom({
              inviteCode: cleanInvite,
              preset,
              nickname: cleanNickname,
            })
          : await joinLiveRoom(cleanRoomCode, cleanNickname);
      const ownSeat =
        mode === 'create' ? room.seats[0] : mode === 'join' ? room.seats.at(-1) : undefined;
      saveRoomBootstrap(room.code, {
        mode: 'live',
        room,
        nickname: mode === 'observe' ? '全知观察者' : cleanNickname,
        isHost: mode !== 'join',
        isObserver: mode === 'observe',
        ...(observerResponse ? { observerState: observerResponse.observer } : {}),
        ...(ownSeat ? { ownSeatId: ownSeat.id } : {}),
        savedAt: Date.now(),
      });
      openRoom(room.code, 'live');
    } catch (error) {
      const message = error instanceof Error ? error.message : '暂时无法完成房间操作。';
      setFormError(message);
      setErrorField(undefined);
      setFallbackAvailable(
        mode !== 'observe' && error instanceof LiveApiError && error.allowsDemoFallback,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="home-page" id="main-content">
      <AnimatePresence>
        {navigating ? (
          <m.div
            animate={{ opacity: 1 }}
            aria-hidden="true"
            className="route-transition-curtain"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={motionTokens.standard}
          >
            <m.span
              animate={{ opacity: 1, scale: 1 }}
              initial={{ opacity: 0, scale: 0.92 }}
              transition={motionTokens.spring}
            >
              <Icons.moon size={34} />
            </m.span>
          </m.div>
        ) : null}
      </AnimatePresence>
      <SiteHeader />

      <section className="home-content">
        <m.div
          animate={{ opacity: 1, y: 0 }}
          className="home-welcome"
          initial={false}
          transition={motionTokens.phase}
        >
          <p className="home-status">
            <span aria-hidden="true" />
            真人与 AI 实时对局
          </p>
          <h1>选择你的对局方式</h1>
          <p>创建新房间、输入房间码加入好友，或旁观一场完整的 AI 推理对局。</p>
        </m.div>

        <m.form
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={`entry-card entry-card--launcher mode-${mode}`}
          data-testid="home-entry"
          initial={false}
          onSubmit={(event) => {
            event.preventDefault();
            void enterRoom();
          }}
          transition={{ ...motionTokens.spring, delay: 0.08 }}
        >
          <div className="entry-tabs" role="tablist">
            <button
              aria-controls="home-mode-panel"
              aria-selected={mode === 'create'}
              className={mode === 'create' ? 'active' : ''}
              id="home-mode-create"
              onClick={() => switchMode('create')}
              onKeyDown={handleModeKeyDown}
              ref={(node) => {
                modeTabRefs.current.create = node;
              }}
              role="tab"
              tabIndex={mode === 'create' ? 0 : -1}
              type="button"
            >
              <span className="entry-tab-icon entry-tab-icon--create">
                <Icons.home size={34} />
              </span>
              <span className="entry-tab-copy">
                <strong>创建房间</strong>
                <small>使用邀请码创建新房间</small>
              </span>
              <Icons.arrow className="entry-tab-arrow" size={20} />
            </button>
            <button
              aria-controls="home-mode-panel"
              aria-selected={mode === 'join'}
              className={mode === 'join' ? 'active' : ''}
              id="home-mode-join"
              onClick={() => switchMode('join')}
              onKeyDown={handleModeKeyDown}
              ref={(node) => {
                modeTabRefs.current.join = node;
              }}
              role="tab"
              tabIndex={mode === 'join' ? 0 : -1}
              type="button"
            >
              <span className="entry-tab-icon entry-tab-icon--join">
                <Icons.door size={34} />
              </span>
              <span className="entry-tab-copy">
                <strong>加入房间</strong>
                <small>输入房间码加入游戏</small>
              </span>
              <Icons.arrow className="entry-tab-arrow" size={20} />
            </button>
            <button
              aria-controls="home-mode-panel"
              aria-selected={mode === 'observe'}
              className={mode === 'observe' ? 'active' : ''}
              data-testid="home-observer-tab"
              id="home-mode-observe"
              onClick={() => switchMode('observe')}
              onKeyDown={handleModeKeyDown}
              ref={(node) => {
                modeTabRefs.current.observe = node;
              }}
              role="tab"
              tabIndex={mode === 'observe' ? 0 : -1}
              type="button"
            >
              <span className="entry-tab-icon entry-tab-icon--observe">
                <Icons.binoculars size={34} />
              </span>
              <span className="entry-tab-copy">
                <strong>AI 观战局</strong>
                <small>全知视角，观看 AI 自动对局</small>
              </span>
              <Icons.arrow className="entry-tab-arrow" size={20} />
            </button>
          </div>

          <m.div
            animate={{ opacity: 1, y: 0 }}
            aria-labelledby={`home-mode-${mode}`}
            className="entry-mode-panel"
            id="home-mode-panel"
            initial={false}
            key={mode}
            role="tabpanel"
            transition={motionTokens.standard}
          >
            <div className="entry-panel-heading">
              <span className={`entry-panel-symbol entry-panel-symbol--${mode}`} aria-hidden="true">
                {mode === 'create' ? (
                  <Icons.home size={24} />
                ) : mode === 'join' ? (
                  <Icons.door size={24} />
                ) : (
                  <Icons.binoculars size={24} />
                )}
              </span>
              <div>
                <h2>
                  {mode === 'create'
                    ? '创建一个新房间'
                    : mode === 'join'
                      ? '加入好友的房间'
                      : '创建 AI 全知观战局'}
                </h2>
                <p>
                  {mode === 'create'
                    ? '选择人数并邀请真人加入，空位可由 AI 自动补齐。'
                    : mode === 'join'
                      ? '填写你的称呼和房间码，即可进入等待大厅。'
                      : '你不占用玩家席位，可查看所有 AI 的公开发言与可见分析。'}
                </p>
              </div>
            </div>

            <div className="entry-fields">
              {mode !== 'observe' ? (
                <label className="form-field">
                  <span>你的称呼</span>
                  <div className="input-shell">
                    <Icons.user size={19} />
                    <input
                      aria-describedby={errorField === 'nickname' ? 'home-form-error' : undefined}
                      aria-invalid={errorField === 'nickname'}
                      autoComplete="nickname"
                      enterKeyHint="next"
                      maxLength={12}
                      name="nickname"
                      onChange={(event) => {
                        setNickname(event.target.value);
                        clearFormError();
                      }}
                      placeholder="例如：月下旅人…"
                      ref={(node) => {
                        inputRefs.current.nickname = node;
                      }}
                      spellCheck={false}
                      value={nickname}
                    />
                  </div>
                </label>
              ) : (
                <div className="observer-intro">
                  <span>
                    <Icons.bot size={19} />
                  </span>
                  <div>
                    <strong>你将作为全知观察者</strong>
                    <small>不占玩家席位，可查看全部身份与行动</small>
                  </div>
                </div>
              )}

              {mode === 'create' || mode === 'observe' ? (
                <>
                  <label className="form-field">
                    <span>建房邀请码</span>
                    <div className="input-shell">
                      <Icons.shield size={19} />
                      <input
                        aria-describedby={
                          errorField === 'inviteCode' ? 'home-form-error' : undefined
                        }
                        aria-invalid={errorField === 'inviteCode'}
                        autoComplete="off"
                        enterKeyHint="done"
                        maxLength={24}
                        name="inviteCode"
                        onChange={(event) => {
                          setInviteCode(event.target.value);
                          clearFormError();
                          setFallbackAvailable(false);
                        }}
                        placeholder={
                          mode === 'observe' ? '输入建房邀请码…' : '输入邀请码（演示可留空）…'
                        }
                        ref={(node) => {
                          inputRefs.current.inviteCode = node;
                        }}
                        spellCheck={false}
                        value={inviteCode}
                      />
                    </div>
                  </label>
                  <fieldset className="preset-picker">
                    <legend>对局人数</legend>
                    {[6, 9, 12].map((count) => (
                      <button
                        aria-pressed={preset === count}
                        className={preset === count ? 'active' : ''}
                        data-testid={`observer-preset-${count}`}
                        key={count}
                        onClick={() => {
                          const nextPreset = count as 6 | 9 | 12;
                          setPreset(nextPreset);
                          setObserverLineup((current) => ({
                            ...makeObserverLineup(nextPreset),
                            ...current,
                          }));
                        }}
                        type="button"
                      >
                        <strong>{count}</strong> 人局
                      </button>
                    ))}
                  </fieldset>
                  {mode === 'observe' ? (
                    <fieldset className="observer-lineup">
                      <legend>AI 阵容与性格</legend>
                      <div className="observer-seat-list">
                        {observerSeats.map((seat) => (
                          <div className="observer-seat-draft" key={seat.seatNumber}>
                            <span>{seat.seatNumber}</span>
                            <label>
                              <span className="sr-only">{seat.seatNumber} 号模型</span>
                              <select
                                aria-label={`${seat.seatNumber} 号模型`}
                                data-testid={`observer-seat-${seat.seatNumber}-model`}
                                onChange={(event) =>
                                  setObserverLineup((current) => ({
                                    ...current,
                                    [seat.seatNumber]: {
                                      personality: seat.personality,
                                      providerId: event.target.value as ActiveAiProviderId,
                                    },
                                  }))
                                }
                                value={seat.providerId}
                              >
                                {activeAiModels.map((model) => (
                                  <option key={model.providerId} value={model.providerId}>
                                    {model.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="sr-only">{seat.seatNumber} 号性格</span>
                              <select
                                aria-label={`${seat.seatNumber} 号性格`}
                                data-testid={`observer-seat-${seat.seatNumber}-personality`}
                                onChange={(event) =>
                                  setObserverLineup((current) => ({
                                    ...current,
                                    [seat.seatNumber]: {
                                      personality: event.target.value as AiPersonalityId,
                                      providerId: seat.providerId,
                                    },
                                  }))
                                }
                                value={seat.personality}
                              >
                                {aiPersonalities.map((personality) => (
                                  <option key={personality.id} value={personality.id}>
                                    {personality.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                </>
              ) : (
                <label className="form-field">
                  <span>房间码</span>
                  <div className="input-shell">
                    <Icons.moon size={19} />
                    <input
                      aria-describedby={errorField === 'roomCode' ? 'home-form-error' : undefined}
                      aria-invalid={errorField === 'roomCode'}
                      autoCapitalize="characters"
                      autoComplete="off"
                      enterKeyHint="done"
                      maxLength={12}
                      name="roomCode"
                      onChange={(event) => {
                        setRoomCode(event.target.value.toUpperCase());
                        clearFormError();
                        setFallbackAvailable(false);
                      }}
                      placeholder="例如：MOON9…"
                      ref={(node) => {
                        inputRefs.current.roomCode = node;
                      }}
                      spellCheck={false}
                      value={roomCode}
                    />
                  </div>
                </label>
              )}
            </div>

            <div className="entry-submit-row">
              <m.button
                className="primary-button primary-button--large"
                data-testid="home-submit"
                disabled={pending}
                type="submit"
                whileTap={{ scale: 0.975 }}
              >
                <span>
                  {pending
                    ? '正在连接服务器…'
                    : mode === 'observe'
                      ? `创建 ${preset} 席 AI 观战局`
                      : mode === 'create'
                        ? inviteCode.trim()
                          ? `创建 ${preset} 人房间`
                          : `进入 ${preset} 人本地演示`
                        : '加入房间'}
                </span>
                <Icons.arrow />
                <i aria-hidden="true" />
              </m.button>
              <p className="entry-note">
                {mode === 'observe'
                  ? '观察者不参与发言和投票 · 对局由 AI 自动推进'
                  : mode === 'create' && !inviteCode.trim()
                    ? '未填写邀请码时进入本地演示，不会创建线上房间'
                    : '无需注册 · 真人会话使用 HttpOnly 安全凭据'}
              </p>
            </div>
            {formError ? (
              <div
                className="entry-feedback entry-feedback--error"
                data-testid="home-feedback"
                id="home-form-error"
                role="alert"
              >
                <Icons.shield size={16} />
                <span>{formError}</span>
                {fallbackAvailable ? (
                  <button onClick={enterDemo} type="button">
                    进入本地演示
                  </button>
                ) : null}
              </div>
            ) : null}
          </m.div>
        </m.form>
      </section>

      <footer className="home-footer">
        <span>© 2026 狼人杀</span>
        <span className="footer-motto">月色之下，唯有逻辑值得信任</span>
        <span>版本 0.2 · 实时对局</span>
      </footer>
    </main>
  );
}
