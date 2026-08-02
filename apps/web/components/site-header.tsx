'use client';

import { Icons } from './icons';
import { HelpPanel } from './help-panel';
import { RouteTransitionLink } from './route-transition-link';
import { SettingsPanel } from './settings-panel';

export function SiteHeader({
  compact = false,
  connectionLabel,
  playerCount,
  roomCode,
}: {
  compact?: boolean;
  connectionLabel?: string;
  playerCount?: number;
  roomCode?: string;
}) {
  return (
    <header className={`site-header ${compact ? 'site-header--compact' : ''}`}>
      <RouteTransitionLink aria-label="返回狼人杀首页" className="brand" href="/">
        <span className="brand-mark">
          <Icons.wolf size={26} />
        </span>
        <span className="brand-name">狼人杀</span>
      </RouteTransitionLink>

      {roomCode ? (
        <div className="header-room">
          房间 <strong>{roomCode}</strong>
          <span aria-hidden="true" className="online-dot" />{' '}
          {connectionLabel ?? (playerCount === undefined ? '房间会话' : `${playerCount} 人在线`)}
        </div>
      ) : null}

      <nav aria-label="主导航" className="header-actions">
        <RouteTransitionLink className="text-link desktop-only" href="/admin/models">
          模型控制台
        </RouteTransitionLink>
        <HelpPanel />
        <SettingsPanel />
      </nav>
    </header>
  );
}
