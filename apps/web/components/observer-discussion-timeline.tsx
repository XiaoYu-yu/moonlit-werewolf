'use client';

import * as m from 'motion/react-m';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findActiveAiModel } from '@/lib/ai-models';
import type { LiveRoomState } from '@/lib/live-api';
import { motionTokens } from '@/lib/motion';
import type { ObserverDiscussionItem } from '@/lib/observer-discussion';
import type { ActiveAiDecision } from '@/lib/observer-thoughts';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

function speakingPhaseLabel(phase: string): string {
  return phase === 'last_words' ? '遗言' : '公开发言';
}

export const ObserverDiscussionTimeline = memo(function ObserverDiscussionTimeline({
  activeDecision,
  currentActorId,
  items,
  room,
}: {
  activeDecision: ActiveAiDecision | undefined;
  currentActorId: string | undefined;
  items: readonly ObserverDiscussionItem[];
  room: LiveRoomState;
}) {
  const { tier } = useUiPreferences();
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);
  const previousSpeechCount = useRef(0);
  const [newSpeechCount, setNewSpeechCount] = useState(0);
  const seatsById = useMemo(() => new Map(room.seats.map((seat) => [seat.id, seat])), [room.seats]);
  const currentActor = currentActorId ? seatsById.get(currentActorId) : undefined;
  const currentDecision = activeDecision?.actorId === currentActorId ? activeDecision : undefined;
  const speechCount = items.reduce((count, item) => count + (item.kind === 'speech' ? 1 : 0), 0);
  const latestSpeech = useMemo(
    () => [...items].reverse().find((item) => item.kind === 'speech'),
    [items],
  );

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = tier === 'low' ? 'auto' : 'smooth') => {
      const feed = feedRef.current;
      if (!feed) return;
      feed.scrollTo({ top: feed.scrollHeight, behavior });
      pinnedToLatest.current = true;
      setNewSpeechCount(0);
    },
    [tier],
  );

  useEffect(() => {
    const added = Math.max(0, speechCount - previousSpeechCount.current);
    previousSpeechCount.current = speechCount;
    if (added === 0) return;
    if (pinnedToLatest.current) {
      const frame = requestAnimationFrame(() => scrollToLatest('auto'));
      return () => cancelAnimationFrame(frame);
    }
    setNewSpeechCount((current) => current + added);
  }, [scrollToLatest, speechCount]);

  const onScroll = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const nearLatest = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;
    pinnedToLatest.current = nearLatest;
    if (nearLatest) setNewSpeechCount(0);
  }, []);

  return (
    <section className="observer-discussion ornate-panel" data-testid="observer-discussion-channel">
      <div className="observer-discussion-heading">
        <div>
          <p className="panel-kicker">公开桌面频道</p>
          <h2>发言实况</h2>
          <p>按真实轮次记录公开发言；短回应与完整盘逻辑都会原样保留。</p>
        </div>
        <span>{speechCount} 条公开发言</span>
      </div>

      <div
        className="observer-current-speaker"
        data-active={currentActor ? 'true' : 'false'}
        data-testid="observer-current-speaker"
      >
        <span className="observer-current-speaker-avatar" aria-hidden="true">
          {currentActor?.number ?? '·'}
        </span>
        <div>
          <small>当前发言席位</small>
          <strong>
            {currentActor
              ? `${currentActor.number} 号 ${currentActor.nickname}`
              : '等待法官进入下一位发言'}
          </strong>
          <p>
            {currentActor
              ? `${findActiveAiModel(currentActor.ai?.providerId)?.label ?? 'AI'} · ${
                  currentDecision?.status === 'thinking' ? '正在组织本轮发言' : '等待公开发言提交'
                }`
              : '阶段切换与结算期间不会生成占位发言'}
          </p>
        </div>
        {currentDecision ? (
          <span className="observer-current-speaker-state">
            <i aria-hidden="true" />
            {currentDecision.status === 'thinking'
              ? '模型生成中'
              : currentDecision.status === 'summary_ready'
                ? '分析已返回'
                : '规则兜底'}
          </span>
        ) : null}
      </div>

      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {latestSpeech?.kind === 'speech'
          ? `${latestSpeech.seatNumber} 号 ${latestSpeech.nickname} 新增一条公开发言`
          : ''}
      </div>

      <div className="observer-discussion-feed-wrap">
        <div
          aria-label="AI 对局公开发言记录"
          aria-live="off"
          className="observer-discussion-feed observer-chat-feed"
          data-testid="observer-chat-feed"
          onScroll={onScroll}
          ref={feedRef}
          role="log"
        >
          {items.length === 0 ? (
            <div className="observer-waiting">
              <span aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              等待 AI 进入公开发言阶段
            </div>
          ) : (
            items.map((item) => {
              if (item.kind === 'round') {
                return (
                  <div
                    className="observer-round-divider"
                    data-testid={`observer-round-divider-${item.round}`}
                    key={item.id}
                    role="separator"
                  >
                    <span />
                    <strong>第 {item.round} 天 · 发言实况</strong>
                    <span />
                  </div>
                );
              }

              const seat = seatsById.get(item.actorId);
              const model = findActiveAiModel(seat?.ai?.providerId);
              const current = item.actorId === currentActorId;
              return (
                <m.article
                  animate={{ opacity: 1, y: 0 }}
                  className={`observer-speech ${current ? 'is-current' : ''}`}
                  data-actor-id={item.actorId}
                  data-current={current ? 'true' : 'false'}
                  data-message-id={item.id}
                  data-message-length={item.message.length}
                  data-phase={item.phase}
                  data-round={item.round}
                  data-seat-number={item.seatNumber}
                  data-testid={`observer-speech-${item.id}`}
                  initial={{ opacity: 0, y: 8 }}
                  key={item.id}
                  transition={motionTokens.standard}
                >
                  <span className="observer-speech-seat">{item.seatNumber}</span>
                  <div className="observer-speech-body">
                    <header>
                      <div>
                        <strong>{item.nickname}</strong>
                        <small>
                          {model?.label ?? seat?.ai?.providerId ?? 'AI'} ·{' '}
                          {speakingPhaseLabel(item.phase)}第 {item.ordinal} 位
                        </small>
                      </div>
                      <time dateTime={new Date(item.at).toISOString()}>
                        {timeFormatter.format(item.at)}
                      </time>
                    </header>
                    <p>{item.message}</p>
                  </div>
                </m.article>
              );
            })
          )}
        </div>
        {newSpeechCount > 0 ? (
          <button
            className="observer-new-speech"
            data-testid="observer-scroll-latest"
            onClick={() => scrollToLatest()}
            type="button"
          >
            <span data-testid="observer-new-speech-count">{newSpeechCount} 条新发言</span>
            <Icons.arrow size={15} />
          </button>
        ) : null}
      </div>
    </section>
  );
});
