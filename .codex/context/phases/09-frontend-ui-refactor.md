# Phase 09 — Frontend UI Refactor

Status: complete

## Goal

Refactor the existing Next.js frontend to the user-approved 12-screen interface system, informed
by real shipped Werewolf interaction patterns, while preserving all authoritative gameplay,
provider, privacy, responsive, accessibility, and performance behavior.

## Accepted reference

- `imgs_ui/ui_refactor_reference_2026-07-22.png`
- SHA-256: `ABC2CD6CB5F892A1781DFC271DAE57C6A9B444D942D5EA4E14EC56DAB4AA8629`

## Scope

- Shared visual tokens, controls, header, route transitions, settings, and responsive shell.
- Homepage, connection/recovery, lobby, role reveal, discussion, voting, night action, dawn/last
  words representation, results, AI observer, per-seat analysis, and model administration.
- Browser verification at desktop and 390px mobile widths.

## Non-negotiable boundaries

- Do not alter game rules or server-authoritative state contracts for a visual refactor.
- Keep public discussion separate from observer-private visible analysis.
- Show only DeepSeek and Kimi as playable providers and never fabricate provider data.
- Do not persist or expose credentials, hidden chain-of-thought, prompts, or raw provider traces.
- Treat external shipped-game screenshots as interaction research, not copyable art assets.

## Current work

- New reference copied into the project.
- Official shipped-game research reviewed NetEase Werewolf, Wolvesville, Wolfy, and Fanlang
  surfaces. The adopted patterns are persistent player/state presentation, readable public chat,
  explicit current-phase actions, preselect-then-confirm voting, and role-focused reveal; no
  third-party brand or art is being copied.
  - NetEase Werewolf official TapTap entry: `https://www.taptap.cn/app/55012`
  - Fanlang official TapTap entry: `https://www.taptap.cn/app/232786`
  - Wolvesville official Steam entry: `https://store.steampowered.com/app/2502760/Wolvesville/`
  - Wolfy official Google Play entry: `https://play.google.com/store/apps/details?id=fr.wolfy.app`
- Existing-source audit confirmed that the refactor can preserve `use-live-room.ts`, Socket events,
  legal actions/targets, idempotency, observer-private state, provider truthfulness, and Radix
  Dialog focus behavior.
- `game-experience.tsx` now maps authoritative `voting`, `dawn`, `last_words`, and `resolution`
  states to distinct presentation components while retaining the existing coarse route/test phase.
  Voting shows only legal candidates and the current player's selection, supports the protocol's
  real abstain action, and never fabricates interim vote counts. Dawn uses only public deaths, and
  last words remains in the public chat channel.
- A red/green rules-view regression test exposed that `hunter_shot` had been routed to the generic
  day surface even though the legal hunter action UI existed only in the night component. The new
  pure phase mapper now renders that authorized action surface, including legal targets, skip, and
  existing idempotency handling, without changing the engine or private-state contract.
- The dark AI observer and truthful model administration now follow the approved reference. The
  provider editor is a Radix Dialog with focus containment, Escape/close focus restoration, and
  desktop drawer/mobile sheet layouts. The CSS-hidden administration particle canvas was removed
  from the component so it no longer runs an invisible animation loop.
- The observer progress indicator uses ordered step semantics, non-interactive administration
  items no longer masquerade as links, provider switches have a 44 px target, and the compact
  observer header has verified zero horizontal overflow at 320 and 390 px.
- A read-only accessibility/truthfulness audit found no P0 issue and confirmed the public/private
  AI-analysis boundary. Its P1 findings are being repaired: neutral result synchronization,
  revealed-role-only counts, non-interactive discussion seats, scoped live announcements, readable
  revealed cards, AA contrast/focus tokens, 44 px fallback actions, modal focus behavior, and
  narrow-header overflow.
- Observer/administration styles are imported only by the `room` and `admin` route layouts instead
  of blocking the homepage. Final integrated browser acceptance and visual baselines are recorded
  below.

## Final implementation

- `apps/web/app/ui-refactor.css` and the rebuilt homepage/game components provide the approved
  light player-facing hierarchy at desktop, 390 px, and 320 px while retaining real HTML controls,
  adaptive motion, reduced-motion behavior, and the existing live/demo distinction.
- Lobby, role reveal, discussion, last words, voting, dawn, night actions, Hunter shot, and result
  are separate truthful surfaces driven by authoritative room/private state. A result whose winner
  has not arrived remains neutral, unrevealed roles are not counted, and public timelines map
  internal event identifiers to bounded Chinese descriptions.
- The AI observer uses the dark tactical dashboard from the reference, preserves adaptive public
  speech and observer-private visible analysis, and keeps the host outside all player seats.
- Model administration renders only server-returned DeepSeek/Kimi configuration and usage. Its
  provider editor is a keyboard-contained Radix Dialog; switches and mobile actions meet the 44 px
  target, and the hidden administration particle loop has been removed rather than merely hidden.
- Homepage tabs use roving focus with arrow/Home/End keys. Field errors identify and focus the
  relevant input. Live progress is an ordered status list, non-actionable seats are semantic
  articles, and Help/Settings Portal controls have an opaque high-contrast focus ring.
- `observer-admin-refactor.css` is route-loaded only by `app/room/layout.tsx` and
  `app/admin/layout.tsx`, so the homepage does not download or parse those route-only styles.
- The reviewed visual baselines were intentionally regenerated after comparison with the accepted
  reference. New Phase 09 Playwright specs preserve keyboard focus and 320/390 px content-boundary
  behavior.
- The official production dependency audit exposed a newly published high-severity advisory in
  `sharp <0.35.0`. The root dependency and workspace override now resolve one `sharp@0.35.3` copy;
  Next production build and all browser flows pass on the patched version.

## Acceptance evidence

- Independent final interface review: PASS with P0=0 and P1=0. Public/private player state,
  observer-only visible analysis, truthful provider data, Dialog focus behavior, contrast,
  touch-target, and 320 px header findings are closed.
- `pnpm exec prettier --check .`: pass.
- `pnpm typecheck`: pass across packages, applications, and E2E TypeScript.
- `pnpm test`: 281/281 unit and integration tests pass (32 Web, 166 API, 38 AI gateway,
  23 Worker, 16 game core, and 6 database).
- `pnpm build`: pass for all seven buildable workspace projects; Next production routes `/`,
  `/admin/models`, and `/room/[code]` compile successfully with `sharp@0.35.3`.
- `pnpm audit --registry=https://registry.npmjs.org --prod --audit-level=moderate`: no known
  vulnerabilities.
- Final `pnpm test:e2e`: 17/17 pass in one invocation. Coverage includes truthful administration,
  desktop/mobile AI-only observation, adaptive discussion and per-seat analysis, local fallback,
  all five demo stages, a real one-human/five-AI room through first voting, two isolated human
  sessions in one room, Dialog focus containment/restoration, 320/390 px boundaries, and desktop/
  mobile visual baselines. All provider calls in this acceptance use the isolated local mock.
- Production bundle measurement from Next route diagnostics: homepage initial JavaScript is
  205,007 bytes gzip, under the 350 KB budget. Homepage CSS is 30,526 bytes gzip; the 6,231-byte
  gzip observer/admin stylesheet is absent from the homepage and loaded only on its two routes.
- Final verification leaves ports 3000, 3001, and 4010 free.

## External acceptance still required

- Physical iPhone/Android frame pacing, 120 Hz behavior, long-session heap, real Docker/Linux,
  Redis/PostgreSQL multi-instance operation, 100-room load, and public VPS/domain deployment remain
  outside this Windows-host UI refactor.
