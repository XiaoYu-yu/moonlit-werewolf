# Phase 04 — Real AI and Observer Mode

Status: local implementation and acceptance complete; paid provider live-call gate remains external

## Goal

Replace model-management demo data with truthful Kimi/DeepSeek runtime data, make real provider
calls usable in local play without storing credentials in source, add a host-observed AI-only
match, and improve stage/page transitions without regressing mobile performance.

## Locked scope

- Only DeepSeek and Moonshot Kimi appear in playable model selection and model administration.
- A human may still create/join normal rooms and fill empty seats with AI.
- An AI-only room has a host observer outside the seat count; all seats are AI and the match
  advances without human actions.
- The observer may inspect every role/action because this is an explicitly omniscient local
  simulation mode. Normal live rooms retain player-specific private-state isolation.
- Provider status, usage, errors, latency, and enabled state must come from runtime/server data, not
  hard-coded demo counters.
- User-supplied keys remain transient or encrypted at rest and must never enter source, examples,
  browser bundles, screenshots, or continuity logs.

## Workstreams

- Root: integration, secret-safe local startup/configuration, context, and final acceptance.
- `/root/ai_spectator_backend`: contracts, AI-only authority mode, automatic progression, and API
  tests.
- `/root/provider_runtime`: two-provider runtime, real status/usage data, local direct-call path,
  and backend tests.
- `/root/web_ai_observer`: observer creation/visualization, real model admin UI, and transition
  motion within existing performance tiers.

## Progress

- Added protected local model configuration and removal shortcuts. Credentials are encrypted with
  current-user Windows DPAPI inside ignored runtime state and never enter the Web process.
- Updated the example deployment environment to Kimi/DeepSeek-only playable chat configuration.
- Windows PowerShell 5 parser validation passes for configure, clear, start, service runner, and
  stop scripts.
- Replaced administration placeholders with server-returned DeepSeek/Kimi configuration and real
  zero/missing/error states. The API-direct local path records sanitized provider attempt usage.
- Added authenticated AI-only room creation, observer-private full state, automatic paced actions,
  desktop/mobile observer UI, and privacy regression coverage for normal rooms.
- Added route curtains, phase/day-night transitions, observer-stage changes, and administration
  entry motion using transform/opacity-first shared tokens and reduced-motion behavior.
- Replaced the settlement demo's fabricated AI score with an explicit no-real-statistics label.
  Administration now labels cost as an estimate and explains the configured-price/conservative
  budget basis.
- Made the operating-system reduced-motion preference authoritative over stored high/medium motion
  choices so the Canvas particle loop is also disabled.

## Acceptance evidence

- `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` returned exit code 0.
- Unit/integration suites pass 194 tests: gateway 15, database 6, game core 16, Web 8, Worker 23,
  and API 126.
- `pnpm test:e2e` passes 10/10 desktop/mobile tests, including truthful model administration,
  AI-only observer mode, normal-room privacy, one-human/five-AI play, and visual/responsive checks.
- The final post-fix run completed all 10 Playwright tests in 52.1 seconds. An independent read-only
  review then returned PASS with P0=0, P1=0, and P2=0.
- Exact Windows launcher cold-started the local API and Web; API health and the `localhost` page
  returned 200. A second launch reused both service roots with one listener per port. Exact stop
  returned zero and cleared runtime state and both ports.
- The live administration endpoint returned exactly DeepSeek and Kimi. With no protected local
  credential configured, both correctly reported missing credentials and zero calls/cost.
- A six-seat AI-only room contained six AI seats and an outside observer. Its public state contained
  no role field, unauthenticated observer bootstrap returned 403, and authenticated private action
  history increased from 2 to 6 in 2.2 seconds without human input.
- Source scanning found no protected local secret file. Synthetic key-like values remain only in
  unit tests that verify masking/encryption behavior.
- The user-requested completion email was confirmed sent through Gmail after final acceptance; no
  address or other recipient detail is retained in this context log.

## External acceptance boundary

- No credential copied from chat was placed in a command, file, browser, screenshot, or context
  log. Consequently this host has not made a paid Kimi/DeepSeek network call in Phase 04.
- The user must rotate any credential exposed in chat, enter the replacement through
  `配置AI模型.cmd`, then launch a real match. Docker/Linux, Redis/PostgreSQL, Worker hot reload,
  target-device performance, 100-room load, and public VPS deployment also remain external gates.

## Acceptance target

- Real Kimi or DeepSeek structured action succeeds through the actual playable runtime path.
- A six-seat AI-only game can be created, observed, and advanced with no human seat/action.
- Normal human room privacy and existing game rules remain intact.
- Admin UI contains no fabricated providers or usage values.
- Mobile/desktop transitions remain interruptible and reduced-motion safe.
- Relevant unit/integration tests, typecheck, production build, and browser E2E pass.
