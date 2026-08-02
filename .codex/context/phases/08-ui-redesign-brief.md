# Phase 08 — UI Screen Content Handoff

Status: complete

## Goal

Give the user a complete, copy-ready description of what every screen contains without prescribing
the external designer's visual direction.

## Scope inspected

- Existing desktop/mobile prototypes under `imgs_ui/`.
- Current homepage, live-room, game-stage, AI-observer, per-seat analysis, administration, and
  settings components under `apps/web/`.
- Locked model, responsive, accessibility, motion, performance, and visible-analysis requirements
  from durable project context.

## Deliverable

- `docs/UI_SCREEN_CONTENT_PROMPTS.md`
  - One shared product-function background.
  - Fifteen focused screen and component content prompts.
  - Current DeepSeek/Kimi-only provider boundary.
  - Desktop and mobile coverage without choosing a layout or art style.
  - Short, ordinary, and long adaptive AI speech content.
  - Observer-private visible-analysis drawer and truthful provider/fallback provenance.
  - Connection, room, role, phase, voting, night, result, observer, administration, provider,
    settings, and global state inventories.
  - Minimum 18-screen delivery list.

## Important boundary

- This phase changes documentation and design handoff context only. It does not modify production
  Web components, CSS, runtime art, game behavior, provider configuration, or credentials.
- The user explicitly rejected a prescribed design direction. The final brief therefore omits
  colors, fonts, layout style, art direction, motion direction, design tokens, and negative style
  prompts.
- New external designs remain proposals until the user reviews and approves them.

## Validation

- The brief was checked against the current frontend source inventory rather than only the original
  seven-page prototype list.
- It includes the current AI observer stage, full public-discussion timeline, per-seat
  visible-analysis drawer, real-provider administration, settings, and system states.
- No API key, private credential, hidden chain-of-thought, system prompt, or raw provider trace is
  included or requested.
