import type { Alignment, GamePreset, Role } from '@werewolf/contracts';

export const ROLE_PRESETS: Readonly<Record<GamePreset, readonly Role[]>> = {
  6: ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager'],
  9: [
    'werewolf',
    'werewolf',
    'werewolf',
    'seer',
    'witch',
    'hunter',
    'villager',
    'villager',
    'villager',
  ],
  12: [
    'werewolf',
    'werewolf',
    'werewolf',
    'werewolf',
    'seer',
    'witch',
    'hunter',
    'guard',
    'villager',
    'villager',
    'villager',
    'villager',
  ],
};

export const GOD_ROLES: ReadonlySet<Role> = new Set(['seer', 'witch', 'hunter', 'guard']);

export function getPresetRoles(preset: GamePreset): readonly Role[] {
  return [...ROLE_PRESETS[preset]];
}

export function getAlignment(role: Role): Alignment {
  return role === 'werewolf' ? 'werewolves' : 'good';
}

export function isGodRole(role: Role): boolean {
  return GOD_ROLES.has(role);
}
