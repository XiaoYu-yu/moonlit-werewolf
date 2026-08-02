# Agent Continuity Protocol

This repository keeps durable context for long-running Codex work. After any context
compaction, handoff, interruption, or resumed session, read these files before acting:

1. `.codex/context/GLOBAL.md`
2. `.codex/context/CURRENT.md`
3. `.codex/context/DECISIONS.md`
4. The active file under `.codex/context/phases/`

## Logging rules

- Update `CURRENT.md` whenever the active phase, immediate next action, blocker, agent
  ownership, or validation status changes.
- Append important architecture/product decisions to `DECISIONS.md`; do not silently
  replace history.
- Update the active phase log after meaningful implementation or validation work.
- When a phase completes, record its acceptance evidence and create/update the next phase log.
- Keep `GLOBAL.md` concise and stable. Change it only when requirements or architecture change.
- Never record API keys, passwords, tokens, private user data, or full model prompts containing
  secrets in context logs.
- Treat command output as evidence, not context: record the command, result, and relevant error,
  not huge raw logs.

## Collaboration rules

- Preserve changes made by other agents.
- Before editing a path owned by another active agent, coordinate first.
- Root integration owns workspace files, CI, deployment, documentation, and final verification.
