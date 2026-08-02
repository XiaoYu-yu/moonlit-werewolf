# Phase 05 — AI Decision Summary Channel and Human Cadence

Status: complete for the local single-process integration candidate — final repair accepted
2026-07-19

## Goal

Make AI-only observation feel like a normal Werewolf match rather than a rapid event replay. Show
which AI is currently deciding and publish a concise decision summary produced by the actual model
response into an observer-only channel before the authoritative action advances.

## Safety and product boundary

- Never request, expose, or persist hidden chain-of-thought, provider reasoning tokens, system
  prompts, or raw private model traces.
- Ask the provider to return a short final decision summary as an explicit structured response
  field. This is user-visible output, not hidden reasoning.
- Full role-aware summaries are visible only to the authenticated host of an explicitly AI-only
  observer room. Normal player rooms retain their existing hidden-information boundary.
- If no provider is configured, a request fails, or structured output is invalid, label the entry
  as deterministic fallback. Never present fallback text as Kimi/DeepSeek reasoning.
- Bound summary length and retained history; sanitize all provider errors and omit prompts,
  responses, credentials, and memory summaries.

## Cadence target

- Identity acknowledgements remain brief so the opening does not stall.
- Night choices and votes get a readable multi-second decision window.
- Public speeches get the longest window and remain sequential.
- Real provider latency counts as genuine thinking time; a minimum display interval is added only
  when the result returns too quickly.
- Pausing an observer room prevents pending authoritative actions from applying until resumed.
- Normal human rooms do not inherit observer pacing.

## Workstreams

- Root: contract integration, continuity logs, full verification, and release boundary.
- Backend: structured decision summaries, observer-private history, lifecycle events,
  phase-specific pacing, and API tests.
- Web: current-thinker stage, decision-summary channel, reduced-motion/mobile behavior, and Web
  tests.

## Integration progress

- Backend, Web, and E2E workstreams are implemented and frozen for root integration.
- Playwright Web/API/mock-provider ports are environment-selectable while preserving the default
  3000/3001/4010 behavior. Root can therefore run the full browser suite on isolated ports without
  interrupting a user-started local instance.
- The focused E2E TypeScript and formatting checks pass. Full workspace and browser regression are
  complete.
- Root regression found that secret-night snapshot suppression also hid the public host
  pause/resume flag. The runtime now broadcasts only those safe control-state changes while still
  suppressing secret night sub-phase transitions; a focused API regression test covers both states.
- Root regression also removed cross-test provider-call ambiguity by correlating mock requests with
  `gameId` and actor ID. The pause assertion now proves that the same pending AI decision is not
  requested twice even while other in-memory AI rooms exist.

## Acceptance evidence

- Workspace formatting, strict typecheck, 213 unit/integration tests, and production build pass
  after final documentation integration.
- Playwright passed 8/8 desktop and 3/3 mobile tests on isolated ports. The suite covers the real
  OpenAI-compatible HTTP adapter path with a local controlled provider, provider/fallback
  provenance, minimum cadence, one active thinker, pause/resume without a duplicate request,
  public-event privacy, mobile overflow, normal live rooms, demo flow, and visual baselines.
- Paid Kimi/DeepSeek network calls are deliberately not part of automated acceptance. They require
  user-configured credentials and supplier availability; the test provider validates the same HTTP
  and structured-response boundary without storing or exposing a real key.
- The final full Playwright run passes 11/11 in one invocation on the final source state, even when
  the parent shell contains synthetic conflicting provider, admin, budget, and Redis values. The
  test API explicitly clears external credentials/services and uses only the controlled local HTTP
  provider.
- Independent backend and Web re-reviews both report P0=0 and P1=0 after repairing
  role-incompatible provider actions, source provenance, pause idempotence, accessible status
  announcements, accurate planned/actual model labels, and mobile thought-channel readability.
- The user-requested completion notification was confirmed sent through the connected Gmail
  account after acceptance; no recipient information is stored in repository context.

## Local launcher handoff

- The currently listening 3000/3001 instance predates Phase 05. Codex did not stop it because the
  launcher ownership guard could not verify the Explorer-started process command line from this
  tool session.
- The user must double-click `停止狼人杀.cmd` and then `一键启动狼人杀.cmd` once to load the
  accepted Phase 05 API and Web build. This handoff is required; the current browser process must
  not be described as already updated.

## Acceptance target

- A real provider response can carry a bounded decision summary through gateway, API, Socket, and
  observer UI.
- Fallback entries are visibly and programmatically distinct from provider summaries.
- Six-seat AI-only matches no longer complete multiple meaningful actions in a fraction of a
  second; speech, vote, and night phases are readable.
- Public room snapshots and normal player private states contain no observer thought summaries.
- Pause/resume, reconnect, reduced motion, mobile layout, unit tests, production build, and
  Playwright pass.

## 2026-07-19 release re-verification

- Fresh root gates pass: formatting, strict typecheck, 213/213 unit/integration tests, production
  build, Prisma validation, official-registry production dependency audit, and Playwright 11/11 on
  isolated ports.
- Minimal paid calls through the project gateway confirmed both current default providers: Kimi and
  DeepSeek each returned one legal vote with a provider-authored `decisionSummary`, without fallback.
  Credentials remained transient and were not written to source, context, or a listening service.
- Acceptance is nevertheless revoked. The quick local API listens on all interfaces while its
  documented default development admin key authorizes provider-management reads and updates. Once a
  real credential is configured, a network peer could redirect a provider base URL and cause a later
  Bearer credential to be sent off-host. No provider is configured in the current local API, so no
  actual leak was observed.
- The structured-action parser silently accepts mutually contradictory fields such as a vote with
  both `targetSeatId` and `abstain: true`. It can therefore retain a summary saying one action while
  executing another. Provider results without successful attempt telemetry are also accepted by an
  internal queue boundary.
- `.dockerignore` does not exclude `.runtime/`; a future protected provider-secret file and launcher
  state could enter Docker build context and builder layers.
- Do not restore `complete` status until these release blockers have regression tests and the full
  verification matrix, including a safe isolated real-provider browser flow, passes again.
- Repair ownership is split into three non-overlapping workstreams: local API/admin/Docker security,
  AI action/provenance integrity, and Web observer hardening. Root owns integration, live-provider
  browser acceptance, launcher restart, documentation, and final verification.

## 2026-07-19 final repair and acceptance

### Repair summary

- The double-click API defaults to `127.0.0.1`; the known development admin key is accepted only
  from a real loopback socket. Production Compose explicitly opts into `0.0.0.0`, and `.runtime/`
  is excluded from Git and Docker build contexts.
- The structured-action parser now distinguishes inactive schema placeholders from active
  contradictions, rejects unknown fields, validates bounded string summaries at the queue
  boundary, and prevents a model summary from describing a different executed action.
- Repair requests defer to the original role-specific instruction instead of advertising a generic
  union of night actions. Prompts provide exact legal target UUIDs and role semantics, hide the
  engine's conflicting action names, and enforce the Witch's night-one-only self-save rule.
- Role-executable validation now occurs before the observer/standard-room branch. A malformed or
  role-incompatible provider action is discarded before normal-room application and cannot persist
  its provider memory summary.
- Playable Kimi and DeepSeek requests use short non-thinking structured mode. This keeps the
  user-visible `decisionSummary` while avoiding truncated hidden-thinking output under the bounded
  game-token budget. The provider timeout default is 20 seconds.
- The observer UI identifies providers from authenticated observer-private state. The live smoke
  requires an actual rendered `thinking` state, provider-authored summaries from each expected
  provider, server-confirmed pause, settled in-flight work, and per-run usage deltas.

### Final acceptance evidence

- `pnpm format:check`: pass.
- `pnpm typecheck`: pass across all packages, applications, and E2E sources.
- `pnpm test`: 261/261 pass: database 6, AI gateway 36, game core 16, Web 16, Worker
  23, and API 164.
- `pnpm build`: production build passes for all workspace packages and applications.
- Prisma schema validation passes. The official-registry production dependency audit reports no
  known vulnerabilities at moderate-or-higher severity.
- Final isolated-port Playwright run: 11/11 pass after correcting the Witch E2E helper to support
  the valid state where heal and abstain buttons are both visible.
- Isolated paid browser observer: the page rendered a server `thinking` state, then displayed
  provider-authored summaries from both Kimi and DeepSeek. The run recorded four calls, four
  successes, zero failures; after server-confirmed pause, the totals remained unchanged.
- Windows security checks: all five PowerShell scripts parse, both configured provider entries
  decrypt successfully for the current user from DPAPI-protected `.runtime/` storage, the protected
  file contains no plaintext provider-key prefix, and PowerShell history contains no provider-key
  assignments.
- Source/context scans find no completion recipient and no provider-style plaintext credential
  outside explicit synthetic security-test fixtures.
- Isolated 3600/3601/4610 listeners were stopped. The pre-existing 3000/3001 listeners retained
  their original PIDs and were deliberately not touched.

### Handoff boundary

- The accepted source is complete for the local single-process experience requested in this phase.
  It is not a claim of public VPS deployment, real Docker/Redis/PostgreSQL multi-instance
  acceptance, device-lab performance, or 100-room load acceptance.
- The existing browser-visible service on 3000/3001 predates these changes. The user must
  double-click `停止狼人杀.cmd`, wait for completion, and then double-click `一键启动狼人杀.cmd`
  to load the accepted build and the DPAPI-protected Kimi/DeepSeek credentials.
- The requested Gmail completion notification was confirmed sent after final acceptance. Recipient
  details are intentionally omitted from repository context.

## 2026-07-19 Explorer launcher hotfix

- The user's first post-handoff double-click reproduced a real Windows PATH variant: Node and
  Corepack were available, but the Node directory had no `pnpm.cmd` shim. Corepack successfully
  started the root `build:packages` command, then its nested bare `pnpm --filter ...` failed with
  “pnpm is not recognized”.
- Root reproduced the failure with a restricted PATH containing only the Node directory and Windows
  system tools: `corepack.cmd pnpm --version` returned 11.9.0, while the nested
  `corepack.cmd pnpm build:packages` exited 1. The equivalent direct workspace filter exited 0 and
  built all four shared packages.
- `scripts/start-local.ps1` now calls the direct shared-package filter in the original
  Corepack-started process. An independent read-only review confirmed the remainder of the launcher
  chain has no nested bare-pnpm dependency.
- Restricted-PATH cold start under Windows PowerShell 5 rebuilt shared packages and the Nest API,
  loaded both DPAPI-protected providers, and returned API/Web HTTP 200. A second start retained the
  same API/Web PIDs. The exact stop script removed the state file and left zero listeners on
  3000/3001.
- All five PowerShell scripts parse, full workspace formatting passes, launcher logs contain no
  plaintext provider credential or pnpm-not-recognized error, and generated `.next-*` verification
  directories are excluded from Git, Prettier, and Docker contexts.
