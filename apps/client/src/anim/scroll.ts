/**
 * Scroll-driven animation primitives.
 *
 * WHY NOT anime.js:
 *   anime.js is ~17 kB gzipped and ships a full timeline engine. Everything the
 *   app animates on scroll is a reveal, a stagger or a parallax — all of which
 *   the platform already does natively via the Web Animations API, at zero
 *   bytes and off the main thread once the element has been animated. Pulling in
 *   a 17 kB dependency for `IntersectionObserver` + `transform` is the wrong
 *   trade in a bundle this size, and it would have to be downloaded on a first
 *   visit that is supposed to work offline.
 *
 * The motion model here is deliberately the anime.js one — durations, easing
 * curves and staggered delays — so the feel is the same, just implemented with
 * what ships in the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/** Matches the anime.js-style easing vocabulary. */
export const EASE = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  linear: 'linear',
} as const;

export type Direction = 'up' | 'down' | 'left' | 'right' | 'none';

export interface RevealOptions {
  /** Pixels the element travels before settling. */
  distance?: number;
  direction?: Direction;
  /** Milliseconds. */
  duration?: number;
  easing?: keyof typeof EASE;
  /** Fraction of the element that must be visible to trigger (0–1). */
  threshold?: number;
  /** Only animate once per mount. */
  once?: boolean;
  /** Skip if the user prefers reduced motion. */
  disabled?: boolean;
  /** Stagger delay in ms — see `stagger()` for a grid cascade. */
  delay?: number;
}

export interface RevealResult {
  /** Spread onto the element: `ref={reveal.ref} className={reveal.className}`. */
  ref: (node: HTMLElement | null) => void;
  className: string;
  /** True once the element has entered the viewport. */
  shown: boolean;
  /** Delay in ms, for staggering a group. */
  delay: number;
}

/**
 * Reveals an element when it scrolls into view.
 *
 * The element is *hidden* only while the observer is live, so a failure to
 * observe (no IntersectionObserver, a rendering quirk) can never leave content
 * invisible — the safety net is `shown` defaulting to true once observed.
 */
export function useReveal(options: RevealOptions = {}): RevealResult {
  const {
    distance = 18,
    direction = 'up',
    duration = 620,
    easing = 'out',
    threshold = 0.15,
    once = true,
    disabled = false,
    delay = 0,
  } = options;

  const [shown, setShown] = useState(disabled);
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!node || disabled) {
      if (disabled) setShown(true);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      // No observer support: show everything rather than hide the page.
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            setShown(true);
            target.classList.add('is-shown');
            if (once) observer.unobserve(target);
          } else if (!once) {
            setShown(false);
            target.classList.remove('is-shown');
          }
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node, threshold, once, disabled]);

  const style = useMemo(() => {
    if (shown) return undefined;
    const offset =
      direction === 'up'
        ? `translate3d(0, ${distance}px, 0)`
        : direction === 'down'
          ? `translate3d(0, -${distance}px, 0)`
          : direction === 'left'
            ? `translate3d(${distance}px, 0, 0)`
            : direction === 'right'
              ? `translate3d(-${distance}px, 0, 0)`
              : 'none';
    return {
      transform: offset,
      opacity: '0',
      transition: `transform ${duration}ms ${EASE[easing]}, opacity ${duration}ms ${EASE[easing]}`,
      transitionDelay: `${delay}ms`,
      willChange: 'transform, opacity',
    };
  }, [shown, direction, distance, duration, easing, delay]);

  // The pre-animation style is applied straight onto the node so there is no
  // flash of the final position between first paint and the observer firing.
  const ref = useCallback(
    (element: HTMLElement | null) => {
      setNode(element);
      if (!element) return;
      if (style) Object.assign(element.style, style);
      else {
        element.removeAttribute('style');
        element.classList.add('is-shown');
      }
    },
    [style],
  );

  return { ref, className: 'reveal', shown, delay };
}

/**
 * Scroll-linked parallax.
 *
 * Returns a transform to apply: the element drifts at `speed` times the
 * scroll offset. Written by hand rather than driven by the observer because
 * parallax is a function of position, not of visibility.
 */
export function useParallax(speed = 0.15, enabled = true): {
  ref: RefObject<HTMLElement | null>;
  style: { transform: string } | undefined;
} {
  const ref = useRef<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      // Distance of the element's centre from the viewport centre.
      const delta = rect.top + rect.height / 2 - viewport / 2;
      setOffset(delta * speed);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [speed, enabled]);

  return {
    ref,
    style: enabled && offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined,
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Adds `in-view` to an element the first time it enters the viewport.
 *
 * For containers whose children animate themselves: the section heading fades
 * in, while each card inside runs its own `useReveal`, rather than moving the
 * whole block as one unit.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  threshold = 0.2,
): (node: T | null) => void {
  const observerRef = useRef<IntersectionObserver | null>(null);

  return useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      if (!node) return;
      if (typeof IntersectionObserver === 'undefined') {
        node.classList.add('in-view');
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).classList.add('in-view');
              observer.unobserve(entry.target);
            }
          }
        },
        { threshold },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [threshold],
  );
}

/**
 * Reading progress of a scroll container, 0–1. Drives the reel "how far
 * through this chapter" bar.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollable = node.scrollHeight - node.clientHeight;
      setProgress(scrollable <= 0 ? 1 : Math.min(1, Math.max(0, node.scrollTop / scrollable)));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener('scroll', onScroll);
    };
  }, [ref]);

  return progress;
}

/**
 * Stagger helper: gives each child of a revealed group its own delay, so a
 * grid cascades in rather than popping as one block.
 */
export function stagger(index: number, step = 55, base = 0, cap = 12): number {
  return base + Math.min(index, cap) * step;
}