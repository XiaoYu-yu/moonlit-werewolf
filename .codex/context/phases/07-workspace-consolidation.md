# Phase 07 — Workspace Consolidation

Status: complete

## Goal

Keep every Moonlit Werewolf source, runtime, recovery, and verification artifact inside
`D:\20278\code\ai langren_kill` so `D:\20278\code` contains only deliberate project roots.

## Safety boundary

- Do not move, rename, delete, or inspect private contents of unrelated projects such as `Study`,
  `Campus part-time job`, `Codex_tokens_managr`, or `111`.
- Move only candidates whose name, timestamp, contents, and project history prove Moonlit Werewolf
  ownership.
- Before every recursive move, resolve and verify source and destination absolute paths in one
  PowerShell process. Sources must be direct children of `D:\20278\code`; destinations must remain
  below the Werewolf project root.
- Preserve recovery artifacts rather than deleting them unless the user separately authorizes
  deletion.
- Keep archived generated content under ignored `.runtime/` so it cannot enter Git, Prettier,
  Docker build contexts, or production bundles.

## Initial inventory

- `D:\20278\code` has no loose top-level files.
- Three direct child directories are clearly Moonlit verification/recovery artifacts:
  - `moonlit-clean-e2e-second-artifacts-20260718-1133`
  - `moonlit-clean-e2e-third-artifacts-20260718-1137`
  - `moonlit-corrupt-node-modules-20260718-1131`
- The two clean-E2E artifact sets each contain 156 generated dist files and about 0.37 MiB.
- The explicitly corrupt node_modules recovery tree contains 26,704 files and about 676.77 MiB.
- No current source, script, E2E, or context file references the three external paths.

## Actions completed

- Resolved and verified all source and destination boundaries in one PowerShell process before
  moving anything. Each source was a direct child of `D:\20278\code`; each destination was a direct
  child of project-local `.runtime/recovery`.
- Moved all three confirmed Moonlit directories into the project without touching unrelated
  sibling projects.
- After the user separately authorized deletion of unused content, repeated the exact boundary,
  file-count, byte-count, and functional-reference checks.
- Permanently removed the two duplicate generated build snapshots and the corrupt dependency
  recovery tree. The cleanup detached 1,102 reparse points before recursively deleting the corrupt
  tree so its links could not affect the current project dependency store.
- Removed the empty recovery directory and the temporary cleanup script. No wildcard deletion was
  used.

## Acceptance evidence

- `D:\20278\code` has zero loose files and exactly five deliberate top-level project roots:
  `111`, `ai langren_kill`, `Campus part-time job`, `Codex_tokens_managr`, and `Study`.
- All three old Moonlit directory names are absent both beside the project and under
  `.runtime/recovery`.
- Functional source reference scan across `apps`, `packages`, `scripts`, and `e2e` returned zero
  references to the deleted directories.
- Current `node_modules\.pnpm` remains present after cleanup.
- `http://localhost:3000` and `http://127.0.0.1:3001/api/v1/health` both return 200.
- An exact duplicate `一键启动狼人杀.cmd` run exits 0, reports the game already running, and
  preserves API/Web wrapper PIDs 37472/45428.
- Root `pnpm format:check` passes. A Git diff check is not applicable because this local workspace
  has no `.git` metadata; direct context-file conflict-marker checks are used instead.
