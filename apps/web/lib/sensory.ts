import type { UiPreferences } from './types';

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return null;
  audioContext ??= new AudioContextClass();
  return audioContext;
}

export async function unlockAudio(): Promise<void> {
  const audio = context();
  if (audio?.state === 'suspended') await audio.resume();
}

export function playUiTone(
  kind: 'tap' | 'reveal' | 'confirm' | 'victory',
  preferences: UiPreferences,
): void {
  if (!preferences.soundEnabled || preferences.masterVolume <= 0) return;
  const audio = context();
  if (!audio || audio.state !== 'running') return;

  const frequencies = {
    tap: [310],
    reveal: [220, 440],
    confirm: [420, 630],
    victory: [330, 495, 660],
  }[kind];
  const now = audio.currentTime;

  frequencies.forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + index * 0.055;
    oscillator.type = kind === 'victory' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, preferences.masterVolume * 0.055),
      start + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  });
}

export function haptic(kind: 'tap' | 'confirm' | 'reveal', preferences: UiPreferences): void {
  if (!preferences.hapticsEnabled || typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  const patterns: Record<typeof kind, VibratePattern> = {
    tap: 8,
    confirm: [12, 26, 16],
    reveal: [10, 32, 20],
  };
  navigator.vibrate(patterns[kind]);
}
