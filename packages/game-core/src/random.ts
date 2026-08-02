import type { Role } from '@werewolf/contracts';

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffleRoles(roles: readonly Role[], seed: number): readonly Role[] {
  const shuffled = [...roles];
  const random = mulberry32(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[target] as Role;
    shuffled[target] = value as Role;
  }
  return shuffled;
}
