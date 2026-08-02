'use client';

import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { resolveRuntimeTier } from '@/lib/performance-tier';
import { unlockAudio } from '@/lib/sensory';
import type { RuntimePerformanceTier, UiPreferences } from '@/lib/types';

const STORAGE_KEY = 'werewolf-ui-preferences';

const defaultPreferences: UiPreferences = {
  motionLevel: 'auto',
  soundEnabled: true,
  hapticsEnabled: true,
  masterVolume: 0.7,
};

interface UiContextValue {
  preferences: UiPreferences;
  setPreferences: (next: UiPreferences | ((current: UiPreferences) => UiPreferences)) => void;
  tier: RuntimePerformanceTier;
}

const UiContext = createContext<UiContextValue | null>(null);

function initialTier(): RuntimePerformanceTier {
  if (typeof window === 'undefined') return 'medium';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (memory <= 4 || cores <= 4) return 'low';
  if (memory < 8 || cores < 8) return 'medium';
  return 'high';
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState(defaultPreferences);
  const [detectedTier, setDetectedTier] = useState<RuntimePerformanceTier>('medium');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateDetectedTier = () => {
      setPrefersReducedMotion(reducedMotion.matches);
      setDetectedTier(initialTier());
    };
    updateDetectedTier();
    reducedMotion.addEventListener('change', updateDetectedTier);

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<UiPreferences>;
        setPreferencesState((current) => ({ ...current, ...parsed }));
      }
    } catch {
      // Invalid local state is safely ignored.
    }

    let frame = 0;
    let previous = performance.now();
    const frames: number[] = [];
    const measure = (now: number) => {
      frames.push(now - previous);
      previous = now;
      if (frames.length >= 60) {
        const slowFrames = frames.filter((duration) => duration > 22).length;
        if (slowFrames > 12) {
          setDetectedTier((current) => (current === 'high' ? 'medium' : 'low'));
        }
        return;
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', updateDetectedTier);
    };
  }, []);

  const setPreferences = useCallback<UiContextValue['setPreferences']>((next) => {
    setPreferencesState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Private browsing may reject storage; the in-memory preference still works.
      }
      return value;
    });
  }, []);

  useEffect(() => {
    const unlock = () => void unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const tier = resolveRuntimeTier(preferences, detectedTier, prefersReducedMotion);
  const contextValue = useMemo(
    () => ({ preferences, setPreferences, tier }),
    [preferences, setPreferences, tier],
  );

  return (
    <UiContext.Provider value={contextValue}>
      <MotionConfig
        reducedMotion={tier === 'low' ? 'always' : 'user'}
        transition={{ type: 'spring', stiffness: 430, damping: 34, mass: 0.72 }}
      >
        <LazyMotion features={domAnimation} strict>
          <div data-performance-tier={tier}>{children}</div>
        </LazyMotion>
      </MotionConfig>
    </UiContext.Provider>
  );
}

export function useUiPreferences(): UiContextValue {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUiPreferences must be used within AppProviders');
  return context;
}
