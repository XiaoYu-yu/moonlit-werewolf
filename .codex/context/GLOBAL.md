# Global Project Context

Last updated: 2026-07-22

## Objective

Build a production-oriented, publicly deployable Chinese Werewolf web game where humans can
join by room code and AI models fill empty seats. One human can play with AI, or multiple humans
can play with AI substitutes. The experience must be mobile-first, highly animated, and feel as
smooth and interruptible as a polished iOS interface.

## Locked product requirements

- Responsive web app; Simplified Chinese v1.
- Guest room-code + nickname join flow; invite code required to create a room.
- Site-managed model credentials and usage budgets.
- 6/9/12-player presets with human and per-seat AI composition.
- Active v1 providers: DeepSeek and Moonshot Kimi; playable seats and model administration should
  not expose inactive placeholder providers.
- Support an AI-only observer room where the host is not a player, chooses the AI lineup, and can
  inspect the full match while it advances automatically. Its discussion cadence and public speech
  length must adapt to the table situation rather than making every actor speak briefly or at
  monologue length.
- The authenticated AI-only host may open a per-seat history of bounded provider-authored visible
  analysis. Never request, persist, or expose hidden chain-of-thought, reasoning tokens, system
  prompts, raw provider traces, or private actor memory as that analysis.
- Text output plus server-side speech-to-text input. No AI voice output in v1.
- 60fps baseline on mid-range phones; adaptive 90/120Hz where supported.
- Rich but restrained motion, optional sound, and capability-detected haptics.
- Server-authoritative hidden information and game state.
- Windows users need an infrastructure-free double-click launcher for the local Web + memory API.
- Durable global/current/phase context logs must be maintained for compaction recovery.
- Every Moonlit Werewolf source, runtime, recovery, and verification artifact must remain under the
  project root; unrelated sibling projects under `D:\20278\code` must remain untouched.

## Rules presets

- 6: 2 Werewolves, Seer, Witch, 2 Villagers.
- 9: 3 Werewolves, Seer, Witch, Hunter, 3 Villagers.
- 12: 4 Werewolves, Seer, Witch, Hunter, Guard, 4 Villagers.
- Side-elimination win condition.
- Witch cannot use both potions in one night and can self-save only on night one.
- Guard cannot guard the same player on consecutive nights; guard + antidote still kills.
- Poisoned Hunter cannot shoot.
- Second tied exile vote produces no exile.

## Architecture

- pnpm TypeScript monorepo.
- `apps/web`: Next.js App Router, React, Tailwind CSS, Radix, Motion.
- `apps/api`: NestJS REST + Socket.IO.
- `apps/worker`: BullMQ AI/transcription jobs.
- `packages/contracts`: shared public/private/event interfaces.
- `packages/game-core`: deterministic event-driven rules engine.
- `packages/ai-gateway`: provider adapters, structured actions, retry/fallback/cost controls.
- `packages/database`: Prisma/PostgreSQL schema and client boundary.
- Redis for presence, timers, locks, queues; S3-compatible temporary audio storage.
- Docker Compose + Caddy deployment baseline.

## Non-goals for v1

Accounts, long-term player statistics, friends, payment, sheriff system, public/open spectators,
full replay UI, and AI text-to-speech.

## Performance acceptance

- LCP <= 2.5s, INP <= 200ms, CLS <= 0.1.
- 95% of core interaction frames within 16.7ms on target mid-range devices.
- No fixed 60fps timer on high-refresh devices.
- Runtime effects tiers: high/medium/low with reduced-motion support.
- 100 concurrent rooms; realtime p95 under 300ms excluding model latency.

## Visual source of truth

- Approved prototypes: `imgs_ui/` (14 PNGs: seven desktop + seven mobile).
- The user-approved implementation reference is
  `imgs_ui/ui_refactor_reference_2026-07-22.png`. Its 12-screen desktop/mobile system supersedes
  the older prototypes for layout hierarchy while the existing product contracts remain binding.
- External screen-content brief: `docs/UI_SCREEN_CONTENT_PROMPTS.md`. It lists the current product's
  pages, fields, controls, data, permissions, and states without prescribing a visual direction.
- Runtime background-only generated assets: `apps/web/public/art/`.
- Prototype screenshots are references only; controls must remain real HTML/CSS.
- External game screenshots may inform interaction patterns only. Do not copy another product's
  trademarks, character art, text, or distinctive branded assets.
