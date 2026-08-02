# Current Execution State

Last updated: 2026-08-03

## Active phase

Phase 10 GitHub publication is complete. The project is now public at
https://github.com/XiaoYu-yu/moonlit-werewolf on branch `main` at commit `7a68aaf`. The initial
GitHub Actions CI run is queued/running; the accepted Phase 09 source was imported unchanged.

## 2026-08-03 — GitHub publication

- Created public repository `XiaoYu-yu/moonlit-werewolf` and pushed 239 tracked files (36.1 MB).
- `docs/ui-research/` (387 files, 126.78 MB) is excluded from the repository via `.gitignore`; it
  remains local and is not part of the public source.
- Pre-push scanning found no real provider credentials or private keys in tracked content.
- Initial CI failed on production audit because `next@16.2.10` had high advisories; the Web
  dependency moved to `^16.2.11` and the lockfile resolved `next@16.2.12`. Audit is clean and
  the production Web build passes locally.

## Work completed

- Approved 14 UI prototypes exist in `imgs_ui/`.
- A complete external UI screen-content prompt package now exists at
  `docs/UI_SCREEN_CONTENT_PROMPTS.md`, with the product background, 15 focused content prompts, and
  a minimum 18-screen list. It does not prescribe colors, typography, layout style, art direction,
  or motion.
- Root pnpm workspace, strict TypeScript config, formatting, ignore rules, and Vitest workspace added.
- `.env.example`, Docker Compose, Caddy, and GitHub CI baseline added.
- Three clean background scenes generated and delivered as responsive AVIF/WebP assets under
  `apps/web/public/art/`; prototype PNG files remain visual references only.
- Shared contracts and deterministic game core completed with 16 unit tests.
- Responsive Next.js frontend completed for home, lobby, role reveal, day, night, results, and
  model administration, including adaptive motion, sound, haptics, and local demo flow.
- NestJS REST/Socket.IO API, BullMQ worker skeleton, AI provider adapters, Prisma schema, and
  server-authoritative room/game services completed as a runnable vertical slice.
- Root `一键启动狼人杀.cmd` and `停止狼人杀.cmd` now provide idempotent, infrastructure-free
  Windows startup and safe process-tree shutdown for the Web + memory API.
- Root `配置AI模型.cmd` and `清除AI密钥.cmd` now provide hidden-input, current-user DPAPI
  protection for local Kimi/DeepSeek credentials. The launcher passes decrypted keys only to the
  API child and the scripts parse cleanly under Windows PowerShell 5.
- `.env.example` now exposes only Kimi/DeepSeek as playable chat providers; DashScope remains
  isolated to speech transcription.
- Model administration now starts empty and reads only server-returned Kimi/DeepSeek configuration,
  usage, latency, error, and budget data; no fabricated counters or inactive chat providers remain.
- AI-only observer rooms now place the authenticated host outside all 6/9/12 AI seats, expose full
  roles/actions only through observer-private state, and advance automatically with a bounded
  display delay.
- Home, route, observer-stage, and administration transitions now use the shared adaptive motion
  system and preserve reduced-motion behavior.
- AI-only observer matches now expose one authoritative current decision at a time and a bounded
  observer-private “AI 思路频道”. Valid Kimi/DeepSeek responses carry an explicit final-decision
  summary; provider failure and deterministic actions are visibly labeled fallback.
- Observer pacing is phase-aware (brief identity acknowledgement, multi-second night/vote windows,
  longest public-speech window) and pause/resume preserves the resolved turn without a duplicate
  model request or charge.
- Administration labels model cost as an estimate with its pricing basis, the explicit local demo
  no longer displays a fabricated AI score, and operating-system reduced-motion always disables
  optional effects including the Canvas particle loop.
- Clean-checkout build order, Prisma generation, proxy identity, AI queue timeout envelopes,
  dependency overrides, and Caddy security headers are hardened and regression-tested.
- Final Phase 05 repair verification is complete; exact current evidence is recorded in
  `.codex/context/phases/05-ai-thought-channel.md`.
- An earlier completion notification was sent before the independent audit reopened Phase 05. The
  final-repair notification is now also confirmed sent after the accepted state was logged; no
  recipient detail is stored in repository context.
- Phase 09 refactored the homepage, connection/recovery, lobby, role reveal, discussion, last words,
  voting, dawn, night actions, Hunter shot, results, AI observer, per-seat analysis, and model
  administration to the approved light-player/dark-observer interface system.
- Live result rendering is neutral until the server supplies a winner, unrevealed roles are not
  counted, non-actionable seats are not focusable buttons, and public timelines no longer expose
  internal event identifiers.
- Homepage tabs and errors, live progress, Help/Settings focus, Provider Dialog focus containment,
  mobile touch targets, contrast, reduced motion, and 320/390 px boundaries pass final review.
- Observer/administration CSS is route-loaded outside the homepage. The hidden administration
  particle loop was removed, and the patched dependency tree resolves `sharp@0.35.3`.

## Active ownership

- Root: completed Phase 09 integration, truthful live-stage mapping, browser acceptance, security
  dependency repair, context, and final verification.
- `/root/normal_game_ui_refactor`: completed the shared light interface, truthful result state,
  homepage keyboard behavior, connection, lobby, role, discussion, night, and result styling.
- `/root/frontend_refactor_audit`: completed the dark AI observer, analysis UI, truthful model
  administration, Radix provider Dialog, hidden-particle removal, and 320 px header repair.
- `/root/ui_guideline_review`: completed the final read-only Web-interface re-review with
  PASS, P0=0, and P1=0.
- `/root/ui_acceptance_e2e`: completed new Phase 09 browser acceptance specs for keyboard, focus,
  Dialog behavior, and 320/390 px content boundaries.
- `/root/real_werewolf_ui_research`: completed official shipped-game research and the newly
  separated voting, dawn, and last-words surfaces.

- Root: Phase 04 integration, launcher/secrets boundary, context, and final verification completed.
- `/root/ai_spectator_backend`: completed AI-only room contracts/API/runtime and tests.
- `/root/provider_runtime`: completed Kimi/DeepSeek runtime and truthful usage/configuration data.
- `/root/web_ai_observer`: completed model administration, AI-only observer UI, and transitions.
- `/root/game_core`: completed `packages/contracts/**` and `packages/game-core/**`.
- `/root/web_finalize`: completed Web finalize and the reused backend P1 audio-session/MIME,
  production-key, and shared-personality security task.
- `/root/backend_finalize`: completed realtime privacy, DTO validation, REST/Socket fan-out, AI
  queue/fallback, public-night contract, Prisma migration, and backend verification.
- `/root/release_audit`: completed read-only requirement and deployment audit.
- `/root/deploy_finalize`: completed Compose/Caddy/environment/CI production-baseline fixes.
- `/root/playwright_e2e`: completed six repeatable real-API/demo/mobile/visual browser tests.
- `/root/web_perf_harden`: completed measured Web bundle/runtime/accessibility hardening and fixed
  the mobile compact-header overlap found by visual QA.
- `/root/docker_migrations`: completed reproducible `pnpm deploy` production images and a
  migration-before-API container path.
- `/root/presence_recovery`: completed multi-socket presence and safe-stage human recovery.
- `/root/admin_provider_persistence`: completed encrypted in-memory/Prisma provider configuration
  persistence; Worker dynamic configuration reload remains out of scope.
- `/root/distributed_budgets`: completed Redis/Lua budget implementation and the independent
  P0-accounting repair pass; second-agent read-only re-review returned PASS.
- `/root/ai_conversation_context`: completed bounded public discussion history, actor-private AI
  memory summaries, prompt context, and reconnect chat restoration.
- `/root/proxy_rate_limit`: completed safe Express trust-proxy configuration and the
  environment-controlled room-create rate limit.
- `/root/real_game_e2e`: completed a real API/Socket single-human plus five-AI
  authoritative-stage Playwright flow.
- `/root/final_release_readonly`: completed final read-only release/security review.
- `/root/queue_timeout_safety`: completed canonical queue/provider timeout envelopes and startup
  validation.
- `/root/ai_thought_backend`: completed structured decision summaries, observer-private state,
  serial phase-aware pacing, pause/resume safety, and backend tests.
- `/root/ai_thought_web`: completed the current-thinker stage, bounded thought channel, mobile and
  reduced-motion behavior, and Web tests.
- `/root/ai_thought_e2e`: completed the controlled OpenAI-compatible provider and privacy/cadence
  browser acceptance.
- Root: Phase 05 was previously handed off, then reopened on 2026-07-19 after a fresh independent
  security and action-integrity audit found release-blocking defects.
- `/root/fix_local_security`: completed the loopback/admin boundary and Docker runtime exclusion.
- `/root/fix_action_integrity`: completed contradictory structured-action and provider-provenance
  repair.
- `/root/fix_web_observer_hardening`: completed observer event validation, failure guidance, and
  mobile-control hardening.
- `/root/investigate_game_prompts`: implementing the shared observer/standard-room role-executable
  boundary, Witch self-save prompt rule, and exact role-target wording/tests; completed.
- `/root/investigate_gateway_failures`: completed the read-only gateway/repair-contract re-review.
- `/root/investigate_observer_pacing`: completed the read-only live-smoke/pause-race re-review.
- Root: completed the restricted-PATH launcher hotfix, exact cold-start/duplicate-start/stop
  re-acceptance, context, and user handoff.
- `/root/launcher_path_review`: completed the read-only Corepack/pnpm launcher review.
- Root: owns Phase 06 integration, React/CSS implementation, privacy boundary, live-provider
  acceptance, context, and final verification.
- `/root/ui_round_audit`: completed the observer discussion timeline, per-AI analysis Dialog,
  responsive typography/mobile layout, Web unit/build verification, and the strengthened paid
  browser smoke.
- `/root/ai_speech_analysis_audit`: completed the observer-only `visibleAnalysis` contract,
  adaptive speech prompt, strict provenance boundary, queue/direct execution parity, backend
  tests, and the bounded paid provider smoke.
- `/root/ui_acceptance_audit`: completed deterministic short/medium/long provider fixtures and
  desktop/mobile UI acceptance.
- Root: completed stale-instance recovery, exact double-click restart, stop/restart, context, and
  final runtime verification.
- `/root/launcher_stale_recovery_review`: completed the read-only safety/root-cause review.
- `/root/elevated_stale_cleanup_helper`: completed the narrow, independently validating UAC helper.
- Root: completed the Phase 07 inventory, safe same-volume moves, authorized cleanup, launcher
  validation, and durable context.
- `/root/outside_project_inventory`: read-only audit of Werewolf artifacts outside the project root.
- Root: completed Phase 08 current-screen inventory, redesign prompt integration, handoff
  documentation, and context.
- `/root/ui_prompt_page_inventory`: completed the read-only current frontend screen/state inventory.
- `/root/ui_prompt_visual_system`: completed the read-only prototype and visual-system review.
- `/root/ui_prompt_responsive_specs`: completed responsive, accessibility, motion, and delivery
  acceptance requirements.

## Immediate next actions

1. Confirm the initial GitHub Actions CI run for commit `7a68aaf` completes on `main`.
2. When requested, continue the documented external gates (Docker/Linux VPS, Redis/PostgreSQL,
   HTTPS domain, device and load acceptance) before claiming a production deployment.
3. Keep `.runtime/`, `docs/ui-research/`, and real credentials out of future pushes.

## Known environment constraints

- Node 24.14.1, pnpm 11.9.0 available.
- Git repository initialized on 2026-08-03; public GitHub remote `origin` is configured.
- Docker CLI is not installed on this Windows host, so Compose files can be statically checked but
  containers cannot be launched locally in this session.
- No `.openai/hosting.json`; no existing Sites project is attached.

## Resolved integration incidents

- A prior deploy-layout experiment left the local pnpm virtual store damaged. Clean-artifact E2E
  exposed an empty `semver` junction target. Root moved the entire dependency tree aside and
  completed a fresh frozen install of 417 packages from the official npm registry; the lock hash
  did not change.
- Clean-artifact verification also exposed ignored shared `dist/` and ungenerated Prisma Client
  assumptions. Root workflows now build packages first, Playwright builds the API dependency
  closure, and the database build generates Prisma Client.
- The documented `tsx watch` API path omitted Nest constructor decorator metadata and crashed the
  Socket gateway after apparent startup. The quick launcher now rebuilds changed API sources with
  `tsc` and runs `dist/main.js`.
- Windows PowerShell 5 could wait on `localhost` IPv6 while the API listened on IPv4. Launcher
  readiness now probes `127.0.0.1`, while the browser continues to use `localhost`.
- Tree shutdown could report failure when a child exited during `taskkill`. Shutdown now validates
  launcher ownership using PID, command line, workspace path, and process start time, then accepts
  an already-terminated root as success.
- Some Node 24 Windows installations expose Corepack but not a global `pnpm.cmd`. Starting the root
  `build:packages` script through Corepack succeeded only until that script launched a second bare
  pnpm process. The launcher now applies the shared-package workspace filter directly in the first
  Corepack process.

## Validation state

- Frozen clean install: 417 packages restored from the official registry; lock SHA-256 unchanged.
- Formatting and strict typecheck: pass.
- Unit/integration tests: 213 tests pass across gateway, database, game core, Web, Worker, and API.
- Prisma generate/validate: pass; the 349-line initial migration exactly matches the current schema
  diff from empty.
- Production build: pass across all packages and applications.
- Production dependency audit at moderate severity: no known vulnerabilities.
- Playwright: 11/11 pass across desktop 8/8 and mobile 3/3. It includes a real
  one-human/five-AI room through private role, public night, dawn, public speech, and first voting;
  desktop/mobile AI-only observer rooms; truthful model administration; and the controlled
  OpenAI-compatible HTTP path for provider summary, cadence, pause/resume, fallback, and privacy.
- API smoke: health, invite, room create, and second-player join return 200/201 as expected, with
  separate player cookies.
- Production Web: home 200; 241,550 bytes initial JavaScript gzip and 150,910 bytes initial scene
  art, both within budget. All 14 prototype images have the required dimensions.
- YAML semantics and Caddy 2.11.4 validation pass. Source scan contains no real provider credential
  or completion-recipient data.
- Windows quick-launch acceptance: exact root `.cmd` cold start returned success; API health and Web
  returned 200; a six-seat room was created with one HttpOnly player cookie; duplicate launch kept
  the same two launcher PIDs and one listener per port; exact stop removed both process trees,
  state, and ports; a final cold restart used dependency/package/API build fast paths and returned
  ready. All three PowerShell files parse without errors and root formatting passes.
- Phase 04 quick-launch re-acceptance: API health and `localhost` Web returned 200; administration
  returned exactly DeepSeek/Kimi with missing-credential and zero real usage when unconfigured; a
  six-seat all-AI room kept the observer outside seats, hid roles from its public snapshot, rejected
  an unauthenticated observer read with 403, and increased private action history from 2 to 6 in
  2.2 seconds. Duplicate launch reused both service roots with one listener per port; stop returned
  zero and cleared state and both ports.
- Final independent read-only Phase 04 audit returned PASS with P0=0, P1=0, and P2=0 after the cost
  labeling, demo-score removal, and reduced-motion fixes.
- Phase 05 final root gates: formatting, strict typecheck, 213 unit/integration tests, Prisma schema
  validation, production build, and moderate-or-higher production dependency audit all pass.
  Source/context scans find no provider-style plaintext key outside explicit synthetic security
  test fixtures.
- Phase 05 independent backend and Web re-reviews: P0=0 and P1=0. The final Playwright run passed
  all 11 tests in one invocation on the final source while synthetic conflicting parent
  provider/admin/budget/Redis variables were present, proving the E2E process uses only its
  controlled local provider and isolated settings.
- The user-requested Phase 05 completion notification was confirmed sent through the connected
  Gmail account after final acceptance. Recipient details are deliberately omitted from repository
  context.
- The live 3000/3001 processes were started before Phase 05 and remain intentionally untouched.
  Launcher ownership verification could not safely identify the Explorer-started command line from
  this tool session, so the user must run the documented stop/start handoff before judging the new
  runtime UI.
- A Phase 04 completion notification was confirmed sent through the connected Gmail account after
  all acceptance gates passed. Recipient details are deliberately omitted from repository context.
- 2026-07-19 release re-verification revoked Phase 05 acceptance despite fresh passing gates. Root
  reran formatting, strict typecheck, all 213 unit/integration tests, production build, Prisma
  validation, the official-registry production audit, and all 11 Playwright tests successfully.
  Minimal paid gateway calls also confirmed that the current official Kimi and DeepSeek default
  models each return a valid action plus `decisionSummary`; no credential was persisted or placed in
  a listening service.
- The same audit independently reproduced three release blockers: the local API listens on every
  interface while a documented default development admin key authorizes the provider-management
  endpoint (P0); contradictory provider action fields can make the displayed summary disagree with
  the executed action (P1); and `.dockerignore` does not exclude `.runtime/` from Docker build
  context (P1). The currently running API has no configured provider credential, so no active-key
  leak was observed.
- Acceptance is deliberately limited to a local single-process integration candidate. No public
  deployment has been performed. Real Docker/Linux, Redis/PostgreSQL, multi-instance persistence,
  dynamic Worker provider reload, async S3 audio/event persistence, supplier billing
  reconciliation, device performance, 100-room load, and VPS/domain deployment remain external
  work.
- 2026-07-19 final repair acceptance supersedes the revoked Phase 05 result: formatting, full
  strict typecheck, production build, Prisma validation, official-registry production audit, and
  261/261 unit/integration tests pass. The final isolated-port Playwright invocation passes 11/11.
- The strengthened isolated paid browser smoke rendered a real server `thinking` state, displayed
  authenticated provider summaries from Kimi and DeepSeek, received server-confirmed pause, and
  recorded a run delta of four calls, four successes, and zero failures. The count remained stable
  after pause.
- Both configured local provider credentials are current-user DPAPI protected, decryptable by the
  launcher, absent from plaintext source/history/context, and excluded from Git and Docker build
  contexts. All five PowerShell scripts parse.
- Final isolated listeners are closed; the old user-started 3000/3001 listeners still have PIDs
  33576 and 10800 and require the documented user stop/start handoff.
- The requested final-repair notification was confirmed sent through Gmail after all acceptance
  evidence and context logs were complete. Recipient details are intentionally omitted.
- Explorer launcher hotfix acceptance: under a PATH with Node/Corepack and Windows system tools but
  no pnpm shim, cold start rebuilt four shared packages and the API, reported both configured
  providers, and returned API/Web 200. Duplicate start preserved API PID 37916 and Web PID 36356;
  safe stop removed state and left zero listeners on ports 3000/3001. Full formatting and
  PowerShell parse 5/5 pass.
- Phase 06 final root gates pass on the accepted source: formatting, strict typecheck, 271/271
  unit/integration tests, and the full production build.
- Phase 06 final isolated-port Playwright passes 12/12 after a human-reviewed mobile baseline
  update. The same run covers 63/133/260-character adaptive speeches, 390 px no-overflow behavior,
  16 px reading text, 44 px controls, actor-filtered analysis drawers, focus restoration, and
  public/private isolation.
- Paid Phase 06 verification passes for the currently protected Kimi and DeepSeek configurations.
  Direct gateway checks returned legal actions and bounded visible analyses without fallback; the
  isolated browser run displayed both providers inside their per-seat drawers and recorded four
  calls, four successes, and zero failures. All isolated listeners were closed afterward.
- The stale-instance handoff issue is resolved by the accepted launcher hotfix. Exact HTTP and
  process-tree verification plus one UAC approval removed the elevated old instance; the new
  ordinary-user instance has a valid version-2 state, readable workspace-owned wrapper command
  lines, Web/API 200, and both protected providers enabled.
- Exact shortcut acceptance: repeated `一键启动狼人杀.cmd` exits 0 without replacing the two
  wrapper PIDs; `停止狼人杀.cmd` removes state and leaves zero 3000/3001 listeners; the next cold
  start uses dependency/package/API fast paths, loads Kimi + DeepSeek, and returns ready. All six
  PowerShell scripts parse under Windows PowerShell 5, and the two launcher/recovery scripts contain
  zero non-ASCII bytes.
- Phase 07 consolidation acceptance: `D:\20278\code` has no loose files and now contains only the
  five deliberate roots `111`, `ai langren_kill`, `Campus part-time job`,
  `Codex_tokens_managr`, and `Study`. The three unused Moonlit recovery/build directories are absent
  both beside the project and below `.runtime/recovery`; the temporary cleanup script is absent,
  the active pnpm virtual store remains intact, Web/API return 200, and an exact duplicate
  `一键启动狼人杀.cmd` run exits 0 while preserving API/Web wrapper PIDs 37472/45428.
- Phase 09 final root gates pass on the integrated source: repository formatting, strict workspace
  and E2E typecheck, 281/281 unit/integration tests, and the full production build.
- The official-registry production audit reports no known vulnerabilities after resolving one
  patched `sharp@0.35.3` copy for both the root image pipeline and Next.
- Phase 09 final Playwright passes 17/17 in one invocation. It covers truthful Kimi/DeepSeek
  administration, desktop/mobile AI observation and per-seat analysis, fallback and five-stage
  demo flows, one human plus five AI through authoritative voting, two isolated human sessions,
  keyboard/Dialog focus, 320/390 px content boundaries, and reviewed visual baselines.
- Independent final interface re-review returns PASS with P0=0 and P1=0. Homepage initial
  JavaScript is 205,007 bytes gzip; homepage CSS is 30,526 bytes gzip, while the route-only
  observer/admin CSS is excluded. Final verification leaves 3000/3001/4010 free.

## 2026-08-02 — Independent run smoke re-check

- Fresh typecheck: all workspace packages plus E2E pass; 281/281 unit/integration tests pass.
- API dev start (memory mode) is healthy: GET /api/v1/health returns ok, storage memory, redis
  not-configured; POST /api/v1/rooms with DEV_INVITE_CODE=MOONLIT-DEV creates a room (code JI2Q5W).
- Web dev start (Next.js 16.2.10) serves the home page with HTTP 200; both service logs stay clean.
- Full Playwright E2E re-run passes 17/17 (2.3 min) on isolated ports 3100/3101 with CI=1.
- No functional bugs found. Non-blocking observations: the workspace root has no .git directory
  (version control is unavailable); E2E webServer uses next start with output: standalone, which
  warns but passes, while the production Dockerfile correctly runs apps/web/server.js.
- At the end of the re-check, dev services were left running on 3000 (web) and 3001 (api) for the
  user; E2E ports 3100/3101 were released.
