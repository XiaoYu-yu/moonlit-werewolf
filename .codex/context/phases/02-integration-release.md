# Phase 02 — Live Integration and Release Hardening

Status: accepted — local single-instance integration candidate

## Goal

Turn the validated local vertical slice into an honest live-integration candidate: connect the web
experience to REST/Socket.IO with graceful demo fallback, close high-impact backend reliability
gaps, run root-owned desktop/mobile browser acceptance, and document reproducible local and
production startup.

## Work in progress

- API environment alignment patched:
  - `API_PORT` is preferred, defaulting to `3001`.
  - CORS reads `CORS_ORIGINS`, then `WEB_ORIGIN`, then localhost.
- Playwright CLI prerequisite verified through `npx`; Chromium and the headless shell were
  installed successfully for root-owned browser acceptance.
- Parallel tasks:
  - `/root/web_live_integration` owns `apps/web/**`.
  - `/root/backend_gap_close` owns backend/worker/AI/database paths.
  - `/root/release_audit` is read-only.
- Frontend integration review identified two backend fan-out gaps now assigned to the backend
  hardening task: HTTP AI-seat configuration and game start must broadcast the new room snapshot
  to already-connected Socket.IO clients. Timer events may initially derive from `phaseEndsAt`,
  but the `phase.timer` contract still needs an explicit implementation/decision.
- Release audit identified additional P0 integration work:
  - Private player state must be re-emitted per socket after game start and phase changes.
  - Socket payload validation needs concrete DTO metadata rather than generic envelopes.
  - Authoritative chat events must identify the server-resolved sender and reject invalid actors.
  - Next public API/socket build arguments must be declared in the web Dockerfile.
- Root deployment hardening removed MinIO's published console port and aligned `.env.example` with
  the implemented `ADMIN_API_KEY` and development-only `DEV_INVITE_CODE`.
- A reusable, secret-free `scripts/deepseek-smoke.ts` harness was added. A live DeepSeek request
  was verified through a transient hidden environment input: one attempt, no fallback, strict JSON
  parsed successfully, and the returned vote target was inside the allowed-seat set. No credential
  value was recorded.
- Release privacy review identified a public-phase side channel: exposing individual night role
  phases can reveal whether dead special roles still exist. Backend hardening is adding a
  regression-tested coarse public night phase while preserving exact phases only server-side and
  in authorized private state.
- Read-only release audit completed. Its release gate is intentionally strict:
  - P0: close realtime private-state/validation, public night side channel, production Compose
    mode, Caddy environment propagation, and configuration/financial safety drift.
  - P1: voice capture/authentication, encrypted provider persistence, distributed budgets,
    presence semantics, migrations, reproducible Docker builds, and committed browser/performance
    tests.
  - Root must describe unfinished P1 production work honestly rather than treating scaffolding as
    an operational service.
- `/root/deploy_hardening` now owns the bounded Compose/Caddy/example-env/CI corrections. It must
  not touch application Dockerfiles or source owned by the active implementation agents.
- A user message interrupted the first agent executions after their changes were written. Root
  inspected timestamps and confirmed substantial web/backend work persisted, including live room
  hooks, speech recording/transcription, bounded chat events, AI queue integration, realtime
  privacy broadcasting, concrete Socket DTO tests, and extra service tests. Three fresh finalize
  agents were started against the existing files; deployment work is being retried because its
  earlier agent had not written changes.
- Deployment finalize completed:
  - Compose forces production mode for API/worker, uses health-gated dependencies, defines
    healthchecks for all seven services, and keeps MinIO internal.
  - Caddy receives `SITE_ADDRESS`/`ACME_EMAIL` and routes `/health`, `/api/*`, Socket.IO, and web
    traffic explicitly.
  - Example budgets now use integer cents.
  - CI validates Compose, formatting, Prisma, typecheck/tests/build, and production dependencies
    against the official npm registry at the high-severity threshold.
  - YAML and Caddy 2.10.2 static validation passed; no local Docker runtime was available.
- Web finalize completed after the shared public `night` contract stabilized:
  - REST create/join and explicit demo fallback remain distinct.
  - Socket snapshots, private state, timers, AI/chat/error events, reconnect cleanup, and stale
    version/time protection are wired.
  - Role acknowledgement, speech, voting, witch choices, and other night actions are driven by
    authoritative `legalActions`/`legalTargetIds`.
  - MediaRecorder audio uploads to transcription and fills the text input; teardown does not send
    accidental recordings.
  - Live/demo chat histories are bounded and long content uses rendering containment.
  - Admin credentials remain component-memory-only; current admin API is read-only from the UI.
  - `pnpm --filter @werewolf/web typecheck` and production build both passed.
- Backend finalize completed:
  - Shared contracts now define an explicit coarse public `night`; public phase IDs are stable per
    round and night subphase/timer/version transitions are suppressed.
  - Privacy regression coverage includes different special-role survival combinations.
  - Join, AI-seat configuration, and game start REST mutations publish room snapshots.
  - Private state is published per socket; nested realtime DTOs are validated at runtime.
  - Redis absence/unreachability uses deterministic legal game-core fallback without blocking.
  - Prisma has an initial migration and its phase enum is aligned with the engine.
  - Agent verification reported 43/43 tests, six related package typechecks/builds, Prisma
    generate/validate and schema-to-migration equality, API health/create+HttpOnly-cookie smoke,
    and safe worker exit without Redis. Root verification remains pending.
- Playwright configuration and initial real-API/browser tests were added under root-owned test
  paths, along with the root `test:e2e` script and test dependency. Root `pnpm install` completed
  and synchronized the lockfile; the E2E agent is now executing against ports 3000/3001.
- Backend P1 audio/configuration security completed:
  - Transcription requires the HttpOnly player cookie and validates the session; header-token
    substitution is rejected.
  - WebM/Ogg Opus and MP4 AAC uploads must match allowed MIME, extension, magic/codec evidence,
    conservative size, and configured duration budgets.
  - Production startup rejects missing, placeholder, or short administrator API keys before
    listening.
  - Shared AI personality naming is unified on `fun`.
  - Agent verification: contracts build; API typecheck/build; 32/32 API tests; health 200;
    unauthenticated/header-only audio 403; authenticated invalid media 415; weak production key
    exits nonzero.
- Web performance/accessibility hardening completed:
  - Home initial modern-browser JS measured 210,399 B gzip before and 203,246 B after (3.4%
    reduction; below the 350 KB budget).
  - Home scene variants total 150,910 B and all runtime art totals 703,360 B.
  - Chat input state/rendering was split, lists memoized/contained, reduced-motion and background
    pause behavior improved, Canvas cleanup added, and form/focus/touch/safe-area semantics
    hardened.
  - The 390 px compact-header/connection-strip overlap found in a real screenshot was fixed.
  - Web typecheck and production build passed; LCP/INP/frame-time/long-run memory remain real-device
    measurements, not inferred claims.
- Playwright acceptance completed with 6/6 passing:
  - Real API two-context room create/join and Socket seat synchronization.
  - Explicit offline demo fallback and complete demo lobby-to-result/restart flow.
  - 390x844 overflow checks across all stages.
  - Desktop home and corrected mobile lobby pixel baselines.
  - Console, page error, and critical document/fetch/font/image/script/style/Socket failures are
    audited by every applicable test.
  - E2E TypeScript and targeted formatting checks passed; ports 3000/3001 were released.
- Shared-worktree validation incident:
  - A production deploy-layout experiment ran `pnpm prune --prod` through a workspace-linked
    temporary directory, temporarily removing root dev packages.
  - A frozen install restored 176 packages; no source or lockfile change resulted.
  - Subsequent API test setup is temporarily blocked only by the encrypted-provider repository
    being mid-edit in another active agent. Presence verification will be rerun after that boundary
    stabilizes; no pass/fail claim is inferred from the transient run.
- Presence/safe-recovery finalize completed after the administrator repository stabilized:
  - Gateway tracks a set of sockets per player token; only the final disconnect marks the player
    offline.
  - Reconnecting during an AI takeover sets an internal pending flag and cannot interrupt hidden
    night actions. Recovery occurs only on a real phase-ID boundary into dawn, last words,
    discussion, or voting; lobby/ended can recover immediately.
  - Pending humans cannot submit game/chat actions and internal recovery fields are stripped from
    public/private output.
  - Targeted rooms tests 11/11, full API tests 40/40, API typecheck/build, and changed-file
    formatting passed.
  - Multi-instance presence still requires Redis or sticky sessions.
- Production image/migration finalize completed:
  - API and Worker Dockerfiles use frozen installs plus official-compatible
    `pnpm deploy --legacy` production layouts instead of unsupported recursive monorepo pruning.
  - A non-root migration stage runs the committed `prisma migrate deploy`; Compose gates API and
    Worker startup on successful migration.
  - API/Worker deploy layouts, independent module resolution, Prisma CLI/schema availability,
    Compose/workspace YAML, and formatting were validated locally.
  - Docker images still require a real Docker/Linux CI build because this host has no Docker CLI.
- Encrypted administrator provider persistence completed:
  - Versioned AES-256-GCM envelopes use random nonces, authentication tags, AAD, a primary key ID,
    and an optional previous key for rotation.
  - Admin POST asynchronously upserts to an encrypted memory repository in local development or
    Prisma `ProviderConfig` when PostgreSQL is configured.
  - Responses expose only `maskedApiKey`; plaintext, DTO `apiKey`, and encrypted payload were absent
    from a real HTTP 201 response.
  - Database tests 5/5, full API tests 40/40, both package typechecks/builds, Prisma
    generate/validate, tamper/wrong-key rejection, and production missing-key fail-fast passed.
  - Worker startup still loads provider credentials from environment; dynamic database reload is
    a remaining limitation.
- Final distributed-budget hardening is active:
  - `/root/distributed_budgets` owns only the AI gateway/Worker budget path and is implementing
    atomic Redis/Lua reserve, settle, and release for daily and per-match buckets.
  - Unknown-price calls must reserve a non-zero floor; Redis failure must prevent provider spend
    and return a deterministic legal action.
  - Root-wide install, formatting, tests, builds, browser verification, and documentation closure
    wait until this isolated task completes.
- Independent review of the first budget implementation found five P0 accounting edge cases:
  - provider timeouts could settle unknown spend as zero;
  - an implicitly enabled process guard accumulated across calendar days;
  - explicit request estimates suppressed configured provider-price upper bounds;
  - multi-provider reservation math could reserve less than the gateway's conservative settlement;
  - a random reservation ID did not protect job replay, while a stable ID required correcting
    active/terminal replay and cross-day marker semantics.
    The original implementation agent is adding red/green regressions and repairing these before
    root acceptance.
- Root dependency audit reproduced one moderate PostCSS advisory through Next.js. pnpm 11
  explicitly ignored the old package-level override; the supported workspace-level override
  deduplicated PostCSS to 8.5.19, after which the moderate-severity production audit returned zero
  known vulnerabilities.
- Final release audit found no persisted real provider key or completion-recipient data. It did
  identify two gameplay/deployment gaps now assigned:
  - bounded public conversation history plus actor-private `memorySummary` must feed future AI
    prompts and restore chat after reconnect;
  - `TRUST_PROXY=1` must actually configure Express before Caddy-fronted Throttler limits can
    identify clients correctly.
- Budget P0 repair and re-review completed:
  - Eleven regression cases first reproduced the five accounting/replay failures.
  - Unknown-cost provider attempts now settle a conservative estimate; unexpected gateway failure
    settles the full turn reservation.
  - Pricing uses the maximum explicit-or-price-derived estimate and reserves the maximum across all
    possible provider attempts.
  - A process-local guard is enabled only when explicitly configured.
  - Stable BullMQ reservation IDs and scope-bound markers make active/settled/released and
    cross-midnight replay fail closed without a second provider call or new-day counter mutation.
  - Targeted agent evidence: AI Gateway 13/13, Worker 22/22; independent read-only re-review PASS.
    Real Redis/Lua/TTL/Cluster execution remains an external-infrastructure test.
- AI discussion continuity completed:
  - Authoritative room state keeps the latest 100 public human/AI messages.
  - Future prompts receive at most 30 messages/6,000 serialized characters plus only the acting
    AI's own private 1,000-character summary.
  - Public snapshots never expose summaries; Web restores snapshot chat and deduplicates realtime
    twins by stable message ID.
  - Targeted evidence: API 79 tests, Web 3 tests, related typechecks/builds and formatting passed.
- Reverse-proxy rate-limit identity completed:
  - Production accepts only canonical numeric `TRUST_PROXY` hops and applies the value to the Nest
    Express app before listening.
  - `ROOM_CREATE_RATE_LIMIT` now drives the route decorator and invalid production values fail fast.
  - Targeted evidence: API 75 tests, typecheck/build and formatting passed.

## Pending acceptance

- Live API health and room creation/join endpoints respond on port 3001.
- Browser can create/join a live room and receive Socket.IO room/private/timer/event updates.
- API-offline behavior is explicit and remains usable as a local demo, without silent state
  corruption.
- Desktop and mobile flows pass Playwright CLI inspection with no console errors, overflow, or
  failed critical assets.
- Fresh root `format:check`, `typecheck`, tests, Prisma validation, and production builds pass after
  all integration changes.
- README covers setup, environment variables, architecture, deployment, verification, and honest
  limitations.

## Environment constraints

- Docker CLI is unavailable on this Windows host; Compose/Caddy/Dockerfiles can be statically
  checked, but container startup requires another host/CI runner.
- External AI and speech providers cannot be live-called without real secrets; secrets must never
  be written into project context logs.

## Final local acceptance — 2026-07-18

- Clean-checkout reproduction exposed and closed two release-order defects:
  - API-only builds originally depended on ignored shared-package `dist/`; root workflows now build
    shared packages and Playwright builds the API dependency closure.
  - A fresh `@prisma/client` install contained only its pre-generation boundary; the database build
    now runs `prisma generate` before TypeScript.
- A previously damaged local pnpm virtual-store package was diagnosed because its junction target
  existed but was empty. The entire workspace `node_modules` was moved aside and a fresh frozen
  install from the official npm registry restored 417 packages without changing the lock hash.
- Fresh root evidence after all source changes:
  - `pnpm install --frozen-lockfile` and a later full clean reinstall: pass; lock SHA-256 unchanged.
  - `pnpm format:check`: pass.
  - `pnpm typecheck`: pass across all seven workspace projects and E2E TypeScript.
  - `pnpm test`: 18 files, 171 tests pass (API 112, Worker 22, game core 16, AI gateway 13,
    database 5, Web 3).
  - Prisma generate and validate: pass. The 349-line initial migration is an exact normalized match
    for `migrate diff --from-empty --to-schema-datamodel --script`.
  - `pnpm build`: pass for contracts, AI gateway, database, game core, Worker, Web, and API.
  - `pnpm audit --prod --audit-level moderate --registry=https://registry.npmjs.org/`: no known
    vulnerabilities.
  - `pnpm test:e2e`: 7/7 pass in 49.7 seconds after the clean-install/build-order repairs. A prior
    clean-artifact pass also completed 7/7 in 50.5 seconds.
  - Production API smoke: health 200; administrator-created invite 201; room create 201; second
    guest join 201; both player sessions received one cookie.
  - Home production response 200; 11 initial scripts total 241,550 bytes gzip, below the 350 KB
    budget. Initial night-village art is 150,910 bytes, below the 900 KB image budget.
  - UI prototypes: 14/14, with seven 1536x1024 desktop and seven 1024x1536 mobile PNGs.
  - Compose/workspace/CI YAML parse and semantic assertions pass. Caddyfile adapts and validates
    with Caddy 2.11.4, including CSP frame/object/base restrictions, HSTS, and frame denial.
  - Final source scan found no persisted real provider credential or completion-recipient data;
    five generic `sk-*` matches remain only in encryption/repository test fixtures.
- Browser acceptance covers explicit demo fallback, complete local demo stages, two isolated live
  clients, responsive mobile stages, visual baselines, and a real one-human/five-AI live room
  through role privacy, coarse public night, legal action/fallback, dawn, public human/AI speech,
  and authoritative first-round voting.
- Remaining external gates are intentionally not marked complete: Docker/Linux container runtime,
  real Redis Lua/TTL/Cluster, PostgreSQL migration execution, persistent/multi-instance room
  authority, dynamic Worker reload of encrypted provider records, asynchronous S3 audio and event
  persistence, admin usage closure, 100-room load, target-device frame/LCP/INP/memory validation,
  and public VPS/domain deployment.
- After this acceptance evidence was recorded, the requested completion notification was sent
  through the connected Gmail account. Recipient details were intentionally kept out of repository
  context.
