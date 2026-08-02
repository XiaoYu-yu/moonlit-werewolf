'use client';

import { useEffect, useRef } from 'react';

import { useUiPreferences } from './app-providers';

interface Particle {
  x: number;
  y: number;
  radius: number;
  velocity: number;
  drift: number;
  alpha: number;
}

export function ParticleCanvas({ mode = 'embers' }: { mode?: 'embers' | 'stars' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { tier } = useUiPreferences();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tier === 'low') return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const count = tier === 'high' ? 34 : 16;
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let running = !document.hidden;
    let particles: Particle[] = [];

    const createParticles = () => {
      particles = Array.from({ length: count }, (): Particle => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.7 + Math.random() * 1.8,
        velocity: 0.08 + Math.random() * 0.22,
        drift: (Math.random() - 0.5) * 0.12,
        alpha: 0.12 + Math.random() * 0.38,
      }));
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      createParticles();
    };

    const draw = () => {
      if (!running) return;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y += mode === 'embers' ? -particle.velocity : particle.velocity * 0.25;
        particle.x += particle.drift;
        if (particle.y < -4) particle.y = height + 4;
        if (particle.y > height + 4) particle.y = -4;
        if (particle.x < -4) particle.x = width + 4;
        if (particle.x > width + 4) particle.x = -4;
        context.beginPath();
        context.fillStyle =
          mode === 'embers'
            ? `rgba(214, 158, 76, ${particle.alpha})`
            : `rgba(218, 228, 238, ${particle.alpha})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
      animationFrame = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden;
      if (running) draw();
      else cancelAnimationFrame(animationFrame);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    draw();
    return () => {
      running = false;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.width = 1;
      canvas.height = 1;
    };
  }, [mode, tier]);

  if (tier === 'low') return null;
  return <canvas aria-hidden="true" className="particle-canvas" ref={canvasRef} />;
}
