# Phase 10 — GitHub Publication

Status: complete on 2026-08-03

## Goal

Publish the accepted Moonlit Werewolf source to the user's GitHub account without moving
project-owned files out of the local workspace, leaking credentials, or pulling third-party
research dumps into the public repository.

## Outcome

- Created public repository `XiaoYu-yu/moonlit-werewolf`.
- Initialized Git in the existing project root, set `main` as the default branch, and committed
  239 tracked files (36.1 MB) as `7a68aaf`.
- Pushed `main` to `https://github.com/XiaoYu-yu/moonlit-werewolf.git`; GitHub Actions queued
  run `30757752043` for the initial import.
- Added `docs/ui-research/` to `.gitignore` so the 387-file, 126.78 MB local reference dump stays
  outside the repository.
- Verified the index contains no `.env`, `.runtime/`, `node_modules`, `dist`, Next build output,
  provider secret files, or UI-research images.
- Scanned tracked source before push; no real provider credentials or private keys were found.
  Only synthetic test values and environment-variable references remain.
- Removed the temporary deploy-key fallback after the push; the configured remote is HTTPS with the
  machine credential manager.
- Initial GitHub Actions failure was resolved by upgrading Next: `apps/web` now requests
  `^16.2.11` and the lockfile resolves `next@16.2.12`. `pnpm audit --prod --audit-level moderate`
  reports no known vulnerabilities and `pnpm --filter @werewolf/web build` passes.
- Container image pipeline is green after disabling pnpm's dependency pre-check for the
  post-deploy Prisma generate step; API, worker, Web, and migration images all build.

## Acceptance evidence

- GitHub Actions run `30758580611` completes green: verify 1m11s, browser 2m53s, containers 1m34s.
- GitHub API confirms repository `nameWithOwner=XiaoYu-yu/moonlit-werewolf`,
  `visibility=PUBLIC`, `defaultBranchRef=main`, and `ci.yml` exists at the expected path.
- Local working tree remains the same project; no project-owned file was moved or deleted.

## Boundary

A GitHub import is source publication, not production deployment. Real Docker/Linux execution,
PostgreSQL/Redis, S3, public HTTPS, device performance, and load acceptance remain external.
