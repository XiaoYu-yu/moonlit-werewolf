export const motionTokens = {
  instant: { duration: 0.14 },
  standard: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
  phase: { duration: 0.46, ease: [0.16, 1, 0.3, 1] as const },
  spring: { type: 'spring' as const, stiffness: 430, damping: 34, mass: 0.72 },
};

export const phaseVariants = {
  initial: { opacity: 0, y: 16, scale: 0.992 },
  enter: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.995 },
};
