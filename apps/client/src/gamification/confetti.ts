/**
 * Confetti — a tiny full-screen particle burst with no dependencies.
 *
 * Renders into its own fixed, click-through canvas at the top z-index; removes
 * itself when the burst ends. Respects `prefers-reduced-motion` (skips), and
 * re-launching while a burst runs just restarts it. ~100 lines, no assets.
 */

const COLORS = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#f4a261', '#9b5de5'];

export const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas: HTMLCanvasElement | null = null;
let frame = 0;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
}

export function launchConfetti({
  durationMs = 2200,
  particleCount = 140,
}: { durationMs?: number; particleCount?: number } = {}): void {
  if (REDUCED_MOTION || typeof document === 'undefined') return;

  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;';
    document.body.appendChild(canvas);
  }
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const burst: Particle[] = [];
  for (let i = 0; i < particleCount; i++) {
    const startLeft = Math.random() < 0.5;
    burst.push({
      x: startLeft ? -20 : window.innerWidth + 20,
      y: window.innerHeight * (0.15 + Math.random() * 0.55),
      vx: (startLeft ? 1 : -1) * (2 + Math.random() * 5),
      vy: -(3 + Math.random() * 6),
      width: 5 + Math.random() * 7,
      height: 3 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: -0.15 + Math.random() * 0.3,
    });
  }

  cancelAnimationFrame(frame);
  const startedAt = performance.now();

  const tick = (time: number) => {
    if (!canvas || !ctx2d) return;
    const elapsed = time - startedAt;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const particle of burst) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.22;
      particle.rotation += particle.rotationSpeed;
      particle.vx *= 0.99;
      if (particle.y < canvas.height + 30) alive = true;
      ctx2d.save();
      ctx2d.translate(particle.x, particle.y);
      ctx2d.rotate(particle.rotation);
      ctx2d.fillStyle = particle.color;
      ctx2d.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
      ctx2d.restore();
    }
    if (alive && elapsed < durationMs) {
      frame = requestAnimationFrame(tick);
    } else {
      stopConfetti();
    }
  };
  frame = requestAnimationFrame(tick);
}

export function stopConfetti(): void {
  cancelAnimationFrame(frame);
  if (canvas) {
    canvas.remove();
    canvas = null;
  }
}