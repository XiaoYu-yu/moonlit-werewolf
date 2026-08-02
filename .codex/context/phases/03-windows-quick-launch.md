# Phase 03 — Windows Quick Launch

Status: accepted

## Goal

Let a Windows user start the playable local Werewolf build by double-clicking one file, without
manually opening terminals or installing PostgreSQL, Redis, or Worker. Provide an equally simple
and safe stop path.

## Implementation

- Root entrypoints:
  - `一键启动狼人杀.cmd`
  - `停止狼人杀.cmd`
- PowerShell implementation:
  - `scripts/start-local.ps1`
  - `scripts/run-local-service.ps1`
  - `scripts/stop-local.ps1`
- Startup checks Node 24+, resolves pnpm through Corepack first, installs dependencies when real
  workspace manifests change, and rebuilds shared packages/API only when inputs are newer.
- API and Web run in hidden child consoles with separate stdout/stderr files under
  `.runtime/logs/`.
- Readiness requires API `/api/v1/health` and the Web home page before the browser opens.
- Runtime state records parent PIDs and exact UTC process start times. A repeated double-click
  opens the game without spawning duplicate services.
- Shutdown verifies PID, start time, command line, launcher script, and workspace path before
  terminating each recorded process tree.

## Investigation record

The first real launch exposed a runtime failure after Nest printed that it had started:
`RoomsGateway.afterInit` received an undefined `RoomRuntimeService`. A minimal metadata comparison
showed that loading the TypeScript source with `tsx` produced no `design:paramtypes`, while the
`tsc` output contained `RoomsService` and `RoomRuntimeService`. The launcher therefore builds and
runs the compiled API.

The next readiness pass exposed a Windows-only address-family issue: Windows PowerShell 5 timed out
against API `localhost` because it stayed on IPv6, while the Nest API listened on IPv4. Probing
`127.0.0.1` resolved the boundary without changing browser URLs.

The first shutdown pass also showed that `taskkill /T` can return a failure when a child disappears
mid-operation even though the root tree has stopped. The final implementation checks whether the
validated parent remains alive before treating a nonzero taskkill result as failure.

## Acceptance evidence

- Exact `一键启动狼人杀.cmd` cold launch: exit 0 and ready message.
- API health: HTTP 200 with `status=ok`.
- Web home: HTTP 200.
- Live room creation: success for a six-seat room and one player session cookie.
- Repeated exact launcher execution: API/Web parent PIDs unchanged; exactly one listener on each of
  ports 3000 and 3001.
- Exact `停止狼人杀.cmd`: exit 0; both recorded parents gone; ports 3000/3001 released; runtime
  state removed.
- Final cold restart: dependency, shared-package, and API-build stamps all used the fast path; the
  game returned ready and remains running for the user.
- PowerShell parser: zero errors in all three scripts.
- `pnpm format:check`: pass after ignoring Next's generated `next-env.d.ts`.

## Scope boundary

This launcher is for the reliable local fallback game. Real provider calls still require an
accessible Redis, Worker, transient server-side provider credentials, and their separate production
budget configuration. No secret is stored in launcher state, logs, or context.
