# Decision Log

## 2026-07-18 — Product and architecture

- Use a responsive web app rather than desktop or mini-program clients.
- Guests join by room code and nickname; creating rooms consumes an invite code.
- Model credentials are site-managed and encrypted; never sent to browsers.
- Use a server-authoritative event-driven game engine with player-specific redacted views.
- Use OpenAI-compatible, DashScope, and Volcengine Ark adapter families instead of assuming one
  universal provider wire format.

## 2026-07-18 — Visual implementation

- Approved raster prototypes define visual intent only.
- Runtime controls are HTML/CSS and accessible; background scenes and portraits are separate
  optimized assets.
- Motion uses transform/opacity-first animation, interruptible springs, adaptive effect tiers, and
  reduced-motion semantics.
- Sound is opt-in after a user gesture. Haptics are capability-detected and may be unavailable on
  iOS web browsers.

## 2026-07-18 — Implementation organization

- Use a pnpm workspace without requiring a Turborepo runtime.
- Use Node 24 and current stable package lines already selected in package manifests.
- Parallel agents have non-overlapping path ownership; root performs dependency and build
  integration.
- Context continuity is a required project artifact. `AGENTS.md` defines the read/update protocol.

## 2026-07-18 — Local ports and integration fallback

- The web app uses port 3000 and the API uses `API_PORT=3001`; `PORT` remains a deployment
  compatibility fallback.
- Browser CORS is configured with `CORS_ORIGINS`, falling back to `WEB_ORIGIN`.
- The product may retain an explicit local demo mode when the API is unavailable, but it must not
  present simulated state as a connected live room.

## 2026-07-18 — Secret handling and internal services

- User-supplied provider credentials are used only through transient process environment variables
  during live verification. They are never written to source, `.env.example`, screenshots, or
  durable context logs.
- MinIO is an internal Compose service; its management console is not published on a host port by
  the production baseline.
- The current administrator boundary uses `ADMIN_API_KEY`. The example environment must match the
  implemented guard, while stronger account/session authentication remains a production-hardening
  item.

## 2026-07-18 — Production package and migration layout

- API and Worker images use `pnpm deploy --legacy` to create isolated production trees. pnpm's
  recursive `prune` is not valid for a monorepo, and the non-legacy deploy mode would require a
  workspace-injection lockfile change outside the scoped image repair.
- Database migrations run as a dedicated non-root one-shot Compose service. API and Worker start
  only after `prisma migrate deploy` succeeds.
- Compose receives PostgreSQL credentials from `.env`; production configuration must not hardcode
  the development database password.

## 2026-07-18 — Provider credential encryption

- Administrator-supplied provider credentials are stored only as versioned AES-256-GCM envelopes
  with random nonces, authentication tags, AAD, and key IDs.
- `APP_ENCRYPTION_KEY_PREVIOUS` supports bounded key rotation; API responses and logs expose only a
  masked key and never ciphertext or plaintext.
- Production fails before listening when the provider encryption key is missing, placeholder, or
  not exactly 32 decoded bytes.

## 2026-07-18 — Distributed AI budget semantics

- Redis atomically reserves the Beijing-calendar daily bucket and authoritative match bucket before
  any provider call; all keys share the `{ai-budget}` Redis Cluster hash tag.
- A provider call that starts but has unknown final usage is charged its conservative estimate.
  An unexpected gateway failure settles the full turn reservation rather than releasing spend that
  may already have occurred.
- Reservations cover the maximum explicit-or-price-derived per-attempt estimate across every
  primary/fallback attempt. BullMQ job IDs become stable reservation IDs; active, settled, and
  released replays never call a provider again.
- Reservation markers retain their original daily/match scope so a replay across Beijing midnight
  cannot mutate the new day's counter.
- `AI_PROCESS_BUDGET_CENTS` is an optional process-lifetime emergency ceiling, not an implicit
  substitute for the Redis daily budget.

## 2026-07-18 — Proxy and dependency security

- Production accepts only a canonical numeric `TRUST_PROXY` hop count; Compose uses one trusted
  Caddy hop so HTTP rate limits resolve the actual client rather than a shared proxy address.
- pnpm 11 workspace overrides live in `pnpm-workspace.yaml`. The workspace forces PostCSS 8.5.19 or
  newer for vulnerable `<8.5.10` dependency paths and CI rejects moderate-or-higher production
  advisories.

## 2026-07-18 — AI discussion continuity

- Authoritative room state keeps a bounded public discussion history that may be returned in room
  snapshots for reconnect recovery.
- AI prompts receive only the recent public discussion plus the acting AI seat's own bounded
  `memorySummary`; another AI's summary is never placed in its prompt or a public view.
- Runtime limits are 100 retained public messages, 30 prompt messages, 6,000 serialized prompt
  characters for chat context, and 1,000 characters per actor-private memory summary.
- Public and realtime copies share a stable message ID so the Web client can restore from a
  snapshot without rendering duplicates.

## 2026-07-18 — Clean-checkout build reproducibility

- Shared package exports continue to point at generated `dist/`, but every documented root
  development, typecheck, and test workflow now builds shared packages first.
- The database package generates Prisma Client as part of its own build so an API dependency-closure
  build works after a completely fresh install.
- Playwright builds `@werewolf/api...`, not only the API package, before starting the test server.
  This keeps the browser job independent from ignored local build artifacts and other CI jobs.

## 2026-07-18 — AI queue timeout envelope

- API queue result waiting covers provider timeout multiplied by attempts and unique primary/fallback
  candidates, plus a fixed 5,000 ms scheduling margin.
- Provider, queue-connect, attempt-count, and queue-result timeout values use canonical positive
  integer parsing. Invalid production configuration fails before the API listens; development falls
  back to bounded safe defaults.
- This envelope prevents normal provider retries from outliving the API wait, but it is not a
  distributed cancellation protocol. A task already active during exceptional Redis queue
  congestion may still complete and settle its reserved budget after the API uses a fallback.

## 2026-07-18 — Phase 02 acceptance boundary

- The accepted deliverable is a locally verified single-API-process integration candidate, not a
  completed public or multi-instance production deployment.
- Hard browser acceptance ends after a real six-seat room reaches authoritative first-round voting.
  Match settlement is checked when it occurs; a surviving human legitimately requires further
  round-two input and is not auto-played by the test.
- External gates remain real Redis/PostgreSQL/Docker execution, Worker/provider-admin dynamic
  configuration, durable room authority, asynchronous S3 transcription/persistence, device
  performance, load, and a user-supplied VPS/domain.

## 2026-07-18 — Windows local quick launcher

- The double-click path deliberately starts only the Web and in-memory API. It clears an inherited
  `REDIS_URL` for the API and does not start Worker, so a missing Redis or Worker cannot delay a
  local game; AI turns use the existing deterministic legal fallback.
- The launcher runs the `tsc`-compiled Nest API rather than `tsx watch`, because the latter does not
  emit the constructor metadata required by Nest dependency injection.
- Dependencies, shared packages, and the API are rebuilt only when their real inputs change.
  Runtime state and logs live under ignored `.runtime/`.
- Repeated startup reuses the recorded services. Shutdown may terminate only processes whose PID,
  start time, command line, and workspace path match launcher state; it never kills by executable
  name or port alone.

## 2026-07-18 — Phase 04 playable providers and observer boundary

- Only Moonshot Kimi and DeepSeek are selectable chat providers in live seats and model
  administration. DashScope remains a separate speech-to-text integration and is not presented as
  a playable seat.
- The AI-only mode creates an authenticated host observer outside the configured 6/9/12 seats.
  Omniscient roles and actions are available only to that room's observer session; normal rooms
  continue to receive redacted public state plus one player's authorized private state.
- Windows local credentials are configured through a separate hidden-input shortcut and protected
  with current-user DPAPI under ignored `.runtime/`. Only the API child inherits decrypted values;
  the launcher clears them before starting the Web child.

## 2026-07-18 — Phase 04 provider execution and observer pacing

- When Redis is absent, the API executes AI turns through the same structured Kimi/DeepSeek gateway
  instead of requiring Worker. It applies provider concurrency and Beijing-day budget limits and
  records sanitized attempt telemetry without prompts, responses, hidden reasoning, or credentials.
- Administration labels recorded cost as an estimate rather than an actual supplier bill. Token
  usage is priced with configured site rates when available; otherwise the conservative request
  budget estimate is retained and disclosed.
- Provider-local model defaults are authoritative for fallback attempts so a Kimi model ID cannot
  leak into DeepSeek requests or vice versa.
- Administration updates are immediately effective for the local API-direct path. A Redis/BullMQ
  Worker still loads its provider configuration from process environment and requires a restart;
  dynamic Worker configuration reload is an explicit external follow-up.
- AI-only observer rooms pace authoritative automatic actions with a non-blocking per-room serial
  delay (500 ms by default, bounded by configuration). Normal human rooms do not inherit this
  display delay.
- The operating-system `prefers-reduced-motion` signal always forces the low-effects tier, even if a
  previously stored manual preference requested richer motion. This disables the Canvas particle
  loop as well as optional Motion transitions.

## 2026-07-18 — Phase 05 visible AI decision summaries

- “AI thinking” means an explicit, concise `decisionSummary` generated as part of the provider's
  final structured response. The system never requests, captures, stores, or displays hidden
  chain-of-thought, raw reasoning tokens, system prompts, or full provider traces.
- Role-aware decision-summary text exists only in the bounded `observer.private_state` history of
  the authenticated host of an AI-only room. Public snapshots, public game events, normal-player
  private state, and room-wide `ai.status` events never contain the summary text.
- Every thought entry records truthful provenance. A valid Kimi/DeepSeek response is labeled
  `provider`; absent credentials, provider failure, invalid structured output, and deterministic
  legal fallback are labeled `fallback` and cannot impersonate model reasoning.
- Observer cadence is phase-aware rather than one fixed 500 ms delay: identity acknowledgement is
  brief, night and vote decisions receive a multi-second window, and public speech receives the
  longest window. Real provider latency counts toward perceived thinking time, and standard human
  rooms retain their existing timing.
- Secret night sub-phase snapshots remain suppressed, but authenticated host pause/resume changes
  are public control state and must still be broadcast. Pausing freezes the already-resolved turn;
  resuming restores its remaining deadline without a second provider request.
- A provider summary may be labeled `provider` only when its structured action matches the acting
  role, passes a pure rules-engine submission check unchanged, and has credible provider
  provenance. If the action must be rewritten or rejected, the observer entry and executed action
  both become explicit deterministic fallback; a model summary can never describe an action that
  the engine did not actually apply.

## 2026-07-19 — Phase 05 real-provider structured-turn boundary

- Kimi and DeepSeek structured game turns use their short non-thinking request mode. The game asks
  for a bounded, user-visible final `decisionSummary`, never hidden reasoning tokens or raw
  chain-of-thought. The provider timeout is 20 seconds so normal Kimi latency does not trigger an
  unnecessary paid retry.
- Provider action JSON has an exact seven-key allowlist: `type`, `message`, `targetSeatId`,
  `abstain`, `useHeal`, `memorySummary`, and `decisionSummary`. Inactive `null`/`false` schema
  placeholders remain compatible, but unknown fields, multiple active controls, wrong summary
  types, and oversized memory summaries are rejected at both parser and queue boundaries.
- A structured-output repair attempt must continue following the original role-specific
  instruction. It may restate the exact allowed target IDs, but it must not broaden every night
  role into the union of target, abstain, and Witch-heal controls.
- AI prompts list authoritative target UUIDs together with seat number and nickname, state each
  role's target meaning, and exclude the engine's differently named legal-action fields. Both
  normal human-plus-AI rooms and AI-only observer rooms validate the unchanged provider action
  against the acting role and rules engine before execution or memory persistence.
- The Witch prompt offers self-heal only on night one. If the provider action is role-incompatible,
  malformed, or cannot be submitted unchanged, both execution and stored memory use the
  deterministic legal fallback boundary.
- Paid browser acceptance runs only against an isolated loopback API. It records a pre-run usage
  baseline, requires a rendered server `thinking` state and real summaries from every expected
  provider, waits for server-confirmed pause and any in-flight turn to settle, and evaluates only
  the run's usage delta.

## 2026-07-19 — Corepack-only Windows launcher

- The Explorer launcher must work when the Node installation exposes `node.exe` and
  `corepack.cmd` but no global `pnpm.cmd` shim. Launcher-owned build steps therefore stay inside
  one Corepack-started pnpm process.
- Shared packages are built with the direct workspace filter
  `--filter "./packages/**" --if-present build`. The launcher must not invoke the root
  `build:packages` script because that script starts a second bare `pnpm`, which is unavailable in
  this valid Windows environment.
- Root package scripts remain optimized for normal developer and CI environments that install the
  pnpm shim. The hotfix is deliberately scoped to the double-click path and does not rewrite every
  manual CLI script.
- Ad-hoc Next.js verification output directories matching `.next-*` are excluded from Git,
  Prettier, and Docker contexts alongside the standard `.next` output.

## 2026-07-19 — Phase 06 adaptive speech and observer analysis

- Public AI speech length is situational guidance, not a per-turn quota: low-information responses
  stay brief, ordinary evidence synthesis is medium length, and long analysis is reserved for role
  claims, counterclaims, checks, decisive vote states, last words, and elimination-critical turns.
  Personalities affect wording and evidence style without forcing every actor into a monologue.
- `decisionSummary` remains the compact final conclusion. `visibleAnalysis` is a separately authored
  observer-facing explanation with a hard 1,200-character limit; it is not hidden chain-of-thought,
  reasoning tokens, a system prompt, a raw provider trace, or private memory.
- A Kimi/DeepSeek analysis may be labeled `provider` only when the summary, visible analysis,
  successful provider telemetry, role-executable action, and unchanged rules-engine submission all
  agree. Otherwise the provider text is discarded and the entry is an explicit deterministic
  fallback without fabricated analysis.
- The AI-only room uses one chronological public discussion timeline with round and speaking-order
  context. Each AI seat opens an actor-filtered Radix Dialog rendered as a desktop right drawer or
  mobile bottom sheet, with explicit provider/fallback provenance and focus restoration.
- Core public speech and analysis bodies render at 16 px, practical mobile controls are at least
  44 px, and the 390 px lobby is reflowed instead of shrinking its desktop table. Visual baselines
  may change only after a no-overflow responsive assertion and human comparison confirm the
  difference is intentional.

## 2026-07-19 — Verified recovery of elevated stale local services

- A missing launcher state never authorizes killing a process by port or PID alone. Automatic
  recovery is offered only when 3000 and 3001 each have one loopback Node listener, the API has the
  exact memory-mode health fingerprint, and the Web page has the exact Moonlit Werewolf title.
- If the verified old instance is elevated, the normal launcher requests one UAC approval for a
  narrow ASCII-only helper. The helper derives the project root from its own location, revalidates
  both listener PIDs and start times, and walks both parent trees to find exact
  `run-local-service.ps1` Web/API wrappers with the exact project-root argument. It validates both
  trees before terminating either wrapper.
- Only the cleanup helper is elevated. Replacement Web/API services are started afterward by the
  original ordinary-user launcher.
- `local-dev.json` may be deleted only after the recorded processes and both ports are confirmed
  stopped. An unreadable elevated command line is `unverifiable`, not proof that the state is
  invalid; cancellation or failed verification preserves the old service and state.
- Explorer-facing Windows PowerShell scripts remain ASCII-only because Windows PowerShell 5 can
  misread UTF-8 without a BOM. Required Chinese fingerprints are constructed from Unicode code
  points instead of source literals.

## 2026-07-19 — Project-local artifact boundary

- Every Moonlit Werewolf source, runtime, recovery, and verification artifact belongs below
  `D:\20278\code\ai langren_kill`; project tooling must not create sibling artifact directories
  directly under `D:\20278\code`.
- Temporary output that is still useful belongs under ignored project-local `.runtime/`. Generated
  snapshots and corrupt dependency backups may be deleted only after confirming they are unreferenced
  and inactive, and after the user authorizes removal.
- Cleanup is exact-name and boundary validated. Unrelated sibling projects are never moved or
  deleted as part of Werewolf maintenance, and wildcard deletion at the code-root boundary is
  prohibited.

## 2026-07-20 — External UI redesign handoff

- The existing 14 prototype images remain atmosphere references, not mandatory layout templates.
  A new design should retain the dark Eastern moonlit-village world while reducing heavy frames,
  repetitive gold ornament, low-contrast microcopy, and desktop-to-mobile mechanical scaling.
- Redesign scope follows the current product, not the older seven-page prototype list. It must
  include AI-only observer play, adaptive public speeches, per-seat visible-analysis drawers,
  truthful DeepSeek/Kimi administration, settings, loading, empty, disconnected, and fallback
  states.
- Primary design frames are 1536×1024 desktop and 390×844 mobile. Public speech and visible-analysis
  body text starts at 16px, touch targets are at least 44×44px, and mobile layouts are separately
  composed.
- External visuals do not become implementation source of truth until the user explicitly approves
  them. Final handoff should be editable Figma with tokens, components, variants, responsive rules,
  motion annotations, and separately exportable assets rather than flattened page images.

## 2026-07-20 — Screen-content-only prompt correction

- The user does not want Codex to choose or suggest a UI design direction for this handoff. The
  external designer should receive only the product's screens, fields, controls, information,
  permissions, and runtime states, then choose the visual direction independently.
- `docs/UI_SCREEN_CONTENT_PROMPTS.md` supersedes the earlier design-direction draft. It deliberately
  omits prescribed colors, typography, composition, art style, motion style, design tokens, and
  style-oriented negative prompts.

## 2026-07-22 — User-approved frontend implementation reference

- The user supplied `imgs_ui/ui_refactor_reference_2026-07-22.png` and explicitly authorized a
  production frontend refactor based on it. The reference now leads layout hierarchy and visual
  density for the 12 represented desktop/mobile surfaces.
- Current game rules, live-room contracts, observer-private visible-analysis boundary, truthful
  DeepSeek/Kimi data, adaptive speech, accessibility, and performance requirements remain binding
  even where the static reference cannot show them.
- Research of shipped Werewolf products is used only to identify established interaction patterns
  such as persistent phase/timer context, visible seat state, readable discussion history, circular
  or grid player placement, and explicit voting/skill confirmation. No third-party brand assets or
  distinctive artwork are copied.

## 2026-07-22 — Phase 09 truthful UI and route performance

- Player-facing lobby/game surfaces use the approved light card system, while the authenticated
  AI observer retains a dark tactical dashboard and administration uses a light data workspace.
  Visual separation never changes public/private state authorization.
- Coarse Web routing may remain `lobby/role/day/night/result`, but authoritative `dawn`,
  `last_words`, `voting`, `resolution`, and `hunter_shot` phases must map to distinct truthful
  surfaces. Only a currently legal action is rendered as an actionable seat or confirmation.
- A finished route with no authoritative `winner` is a synchronization state, not a good-team win.
  Unknown roles are not counted, raw event identifiers are not user-facing copy, and interim vote
  totals are never invented.
- Homepage tabs follow the ARIA roving-focus keyboard pattern. Live progress uses ordered status
  semantics, Portal Dialogs own their focus treatment independent of page ancestors, and practical
  mobile actions remain at least 44 px.
- Observer/administration CSS is imported from nested `room` and `admin` layouts rather than the
  root layout. This keeps its 6,231 gzip bytes off the homepage without changing the observer's
  dynamically loaded JavaScript boundary.

## 2026-07-22 — Patched Sharp resolution

- The official security audit published during Phase 09 marks `sharp <0.35.0` vulnerable through
  bundled libvips. The workspace directly requests `sharp@^0.35.3` and overrides every older sharp
  resolution to `^0.35.3`, including Next's narrower optional dependency range.
- This override is accepted only with fresh production build, image pipeline, browser-flow, and
  official-registry audit evidence. It should be removed when the active Next release natively
  declares a patched compatible range.
