# Phase 01 — Foundation and Vertical Slice

Status: completed

## Goal

Produce a complete workspace that installs, typechecks, tests, builds, and runs a mock-data vertical
slice covering all approved screens while the backend/game packages expose real interfaces.

## Completed evidence

- Root workspace/config files created.
- Deployment and CI baselines created.
- Three background-only assets generated:
  - `village-night.png`
  - `village-day.png`
  - `ritual-chamber.png`
- Parallel package implementation is active.
- Shared contracts and deterministic rules engine completed:
  - 6/9/12 presets and seeded role assignment.
  - Guard/Wolf/Seer/Witch/Hunter actions and edge rules.
  - Two-round voting, side-elimination win checks, timeouts, event replay, redacted views.
  - 15/15 game-core Vitest tests passed; contracts/core builds and typechecks passed.
- Responsive web vertical slice completed for all seven planned states and both desktop/mobile
  layouts, with adaptive Motion/CSS animation, sound/haptic preferences, and optimized AVIF/WebP
  scenes.
- Backend vertical slice completed: Nest REST/Socket.IO, room/game services, AI adapters,
  transcription boundary, BullMQ worker skeleton, Prisma schema, and container definitions.
- Root integrated the workspace and recorded successful results for:
  - `pnpm install`
  - `pnpm typecheck`
  - `pnpm test` — 27 tests passed
  - `pnpm --filter @werewolf/database db:generate`
  - `pnpm --filter @werewolf/database db:validate` with a temporary local-format URL
  - `pnpm build`

## Acceptance boundary

Phase 01 establishes a buildable/runnable vertical slice. Live frontend-to-backend behavior,
root-owned real-browser acceptance, production persistence/queue hardening, and final deployment
documentation move to Phase 02.

## Blockers / risks

- Docker cannot be executed on the current host.
- Docker cannot be runtime-validated until Docker is installed on a host or CI runner.
- Provider calls cannot be end-to-end validated without administrator-supplied credentials.
