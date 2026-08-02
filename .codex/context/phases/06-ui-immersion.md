# Phase 06 — UI Readability and AI Match Immersion

Status: complete

## Goal

Make the game comfortable to read at desktop and mobile sizes and make AI-only observation feel
like a real Werewolf table: longer public speeches, clear speaking order and round context, and an
interactive view of each AI's provider-authored visible analysis history.

## Product boundary

- Increase typography and touch targets without simply zooming the desktop layout or introducing
  horizontal overflow.
- Public speech may be detailed and role-played, but it must remain public-table content and must
  not leak private role facts that the acting player would not intentionally reveal.
- “AI analysis” is a bounded field deliberately authored for observer display. Never request,
  store, or expose hidden chain-of-thought, reasoning tokens, system prompts, raw provider traces,
  or another actor's private memory.
- Full role-aware analysis remains available only to the authenticated host of an AI-only observer
  room. Normal players receive only public speeches and their own authorized private state.
- Preserve phase pacing, pause/resume, reduced-motion behavior, and mobile performance.

## Workstreams

- Root: integration, privacy review, live-provider acceptance, context, and final verification.
- Web: typography scale, observer discussion timeline, per-AI responsive Dialog, accessibility,
  and mobile layout.
- AI: adaptive public-speech prompt, observer-only `visibleAnalysis` contract, limits, storage,
  provenance, and provider-cost implications.
- Acceptance: deterministic provider fixtures, long-content overflow, Dialog behavior, round
  order, minimum font/touch sizing, and reduced motion.

## Audit findings and frozen implementation direction

- The stylesheet contains 115 functional font declarations below 12px. Public speech is only 10px
  and observer seat metadata reaches 6–8px, so this is a system-wide readability defect rather
  than one isolated component.
- Observer seats are currently non-interactive articles, all decision summaries are mixed into one
  reverse-chronological channel, and the public speech feed discards already-available round,
  phase, timestamp, and speaking-order context.
- The current provider prompt explicitly requests a short speech and gives the entire structured
  response only 420 output tokens. This is the direct cause of repetitive one-line AI dialogue.
- Public speech length will be situational: roughly 40–100 Chinese characters for low-information
  or simple follow-up turns, 100–260 for normal evidence synthesis, and 260–500 only for role
  claims, checks, major contradictions, decisive voting, last words, or elimination-critical
  turns. These are guidance bands, not quotas; the system must not force every AI to speak at
  length.
- `decisionSummary` remains a compact final conclusion. A new bounded `visibleAnalysis` is
  deliberately authored by the provider for the authenticated observer and is never treated as
  hidden chain-of-thought. Provider attribution requires the original action, summary, analysis,
  successful telemetry, and rules-engine validation to agree atomically.
- The observer UI will use a chronological discussion timeline and a Radix Dialog that becomes a
  right-side drawer on desktop and a bottom sheet on mobile. The whole AI seat is a native button;
  the surface filters history by actor and preserves provider/fallback provenance.

## Acceptance target

- Core UI body text is comfortably readable and interactive controls meet a practical mobile touch
  size.
- AI public speeches contain meaningful table analysis and are not truncated to a token sentence.
- The discussion channel distinguishes system events from numbered-player speeches, shows round and
  speaking order, preserves chronological history, and handles long messages.
- Every AI seat in an AI-only room has a keyboard- and touch-accessible analysis entry; selecting it
  opens a responsive detail surface with current status and bounded chronological analysis.
- Provider/fallback provenance remains explicit, public/private information boundaries remain
  intact, and desktop/mobile tests plus real Kimi/DeepSeek acceptance pass.

## Implementation progress

- Backend and shared-contract implementation is complete. `visibleAnalysis` has a 1,200-character
  hard cap and is required only for observer turns alongside the short `decisionSummary`.
- Gateway parse/repair, BullMQ contracts, Worker handling, direct administration diagnostics, and
  room execution all carry the same requirement. Provider attribution additionally requires
  successful attempt telemetry and an action that the rules engine accepts unchanged; otherwise
  the model text is discarded and the observer receives an explicit fallback record with no
  impersonated analysis.
- Standard-room prompts do not mention or require observer analysis. Observer/standard output
  ceilings are phase-aware, and public speech uses the frozen situational length guidance rather
  than a uniform minimum.
- Fresh backend evidence: formatting passed; Contracts, Gateway, API, and Worker typecheck/build
  passed; Gateway 38/38, API 166/166, and Worker 23/23 tests passed (227 total).
- Web implementation is complete. The observer now keeps one persistent chronological discussion
  timeline with round dividers, current-speaker context, full untruncated short/medium/long speech,
  bottom-aware auto-follow, and a new-message affordance when the host scrolls upward.
- Every observer AI seat has a native 44px-or-larger button. It opens a per-actor Radix Dialog with
  explicit focus restoration, a desktop right drawer, and a mobile 88dvh bottom sheet. Entries
  preserve model/fallback provenance and separate the short conclusion from provider-authored
  visible analysis.
- A shared typography layer raises prototype-scale functional labels throughout home, game, and
  administration surfaces; public speech and analysis bodies render at 16px with wrapping and no
  line clamp. The former mobile shrunken round table is reorganized into a readable grid.
- Fresh Web evidence: formatting, strict Web typecheck, and production build passed; five Vitest
  files passed all 22 tests.

## Final acceptance evidence

- Root fresh gates on the final source passed: `pnpm format:check`, `pnpm typecheck`, `pnpm test`,
  and `pnpm build`. The workspace test total is 271/271: database 6, AI gateway 38, game core 16,
  Web 22, Worker 23, and API 166.
- The focused Phase 06 browser suite passed 3/3 after isolating the controlled provider's speech
  counter by `gameId`. It verifies the same room can naturally contain 63, 133, and 260 character
  speeches rather than forcing one length on every actor.
- The final isolated-port Playwright run passed 12/12. It covers desktop and 390 px mobile
  discussion order, round dividers, short/medium/long content, 16 px bodies, 44 px touch targets,
  actor-filtered analysis drawers, long-text wrapping, focus restoration, reduced motion, normal
  live rooms, demo flow, and public-event privacy.
- The mobile lobby baseline initially differed by 4 percent because it still represented the old
  small-type layout. Root compared expected, actual, and diff images; the independent responsive
  test proved no horizontal overflow. Only then was the intentional baseline regenerated, and the
  full 12-test suite passed again.
- Minimal paid gateway calls passed for both configured providers. Kimi returned a legal vote with
  a 314-character visible analysis in 3.8 seconds; DeepSeek returned a legal vote with a
  92-character visible analysis in 1.3 seconds. Both used one successful provider attempt and no
  fallback.
- An isolated loopback browser smoke rendered the real server thinking state and opened the
  per-seat analysis drawer for both providers. It observed a 515-character Kimi analysis and a
  233-character DeepSeek analysis. The run delta was four calls, four successes, and zero failures;
  the isolated 3630/3731 listeners were then closed.
- All five launcher PowerShell scripts parse with zero errors. The already-running 3000/3001
  processes predate the accepted source and have no `.runtime/local-dev.json` ownership record, so
  root did not terminate them. The user must close that old local instance once and then
  double-click `一键启动狼人杀.cmd` to load Phase 06.

## 2026-07-19 stale launcher incident

- Status: resolved and accepted.
- The user confirmed that double-click startup still fails because Node PID 39488 listens on 3000.
  Root reproduced both listeners: 3000/PID 39488 and 3001/PID 39956 started at 04:36:25, the API
  health and Web home both return 200, and their start times align with the launcher logs.
- `.runtime/local-dev.json` is absent, so the normal PID/start-time/command-line ownership path
  cannot reuse or stop the old instance. The current generic port guard therefore blocks the
  accepted Phase 06 runtime even though both services have the exact local Werewolf fingerprint.
- Root is implementing a narrowly verified stale-instance recovery path and will not weaken the
  rule for arbitrary or partially occupied ports.
- Root cause: when a valid state referenced elevated services, ordinary-user CIM returned an empty
  command line. The old Boolean ownership check treated that as not-owned, both stop calls silently
  did nothing, and the startup path still unconditionally removed `local-dev.json`. The surviving
  services then hit the generic port guard forever.
- `start-local.ps1` now preserves state until cleanup is proved, reuses exact PID/start-time records
  even when an elevated command line is unreadable, and invokes `stop-stale-local.ps1` only after a
  dual-port loopback Node + API health + exact Web title fingerprint.
- The elevated helper independently validates PID/start time, exact listener ownership, both HTTP
  fingerprints, and exact Web/API `run-local-service.ps1` ancestor arguments before stopping
  either wrapper tree. A rejected UAC or any changed evidence performs zero cleanup.
- The first repair run exposed a real Windows PowerShell 5 encoding issue before any process was
  changed: a UTF-8 Chinese title literal broke parsing. Both launcher files are now ASCII-only and
  construct the title from Unicode code points.
- Live acceptance recovered elevated old listener PIDs 39488/39956 with one UAC approval, removed
  both old wrapper trees, rebuilt changed packages/API, loaded Kimi + DeepSeek, and returned Web/API 200. The replacement wrapper command lines are readable and match this workspace.
- The exact root `一键启动狼人杀.cmd` then exited 0 and preserved both wrapper PIDs on repeat
  launch. The exact stop script exited 0, removed state, and left zero listeners; a final ordinary
  cold restart used all fast paths and returned Web/API 200 without another UAC.
- All six PowerShell scripts parse with zero errors under Windows PowerShell 5.
