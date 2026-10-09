/**
 * Scroll-animation tests.
 *
 * The failure mode these guard is content that never becomes visible: a
 * reveal that depends on an observer firing, on a browser that lacks
 * IntersectionObserver, or on a user who has asked for reduced motion. In every
 * one of those cases the element must end up visible and static.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RevealCard } from '../src/anim/RevealCard';
import { EASE, stagger } from '../src/anim/scroll';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Minimal IntersectionObserver we can fire by hand. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((o) => o !== el);
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Simulate the element scrolling into view. */
  trigger(isIntersecting: boolean): void {
    this.callback(
      this.observed.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: Record<string, unknown> = {}): HTMLElement {
  act(() => {
    root.render(<RevealCard {...props}>content</RevealCard>);
  });
  return container.firstElementChild as HTMLElement;
}

describe('RevealCard', () => {
  it('starts hidden and becomes visible when it scrolls into view', () => {
    const el = render();
    expect(el.className).toContain('reveal');
    expect(el.className).not.toContain('is-shown');
    expect(el.style.opacity).toBe('0');

    act(() => FakeObserver.instances[0]!.trigger(true));

    expect(el.className).toContain('is-shown');
    expect(el.style.opacity).toBe('');
    expect(el.textContent).toBe('content');
  });

  it('applies the configured travel distance and easing', () => {
    const el = render({ distance: 40, direction: 'left', duration: 300 });
    expect(el.style.transform).toContain('40px');
    expect(el.style.transition).toContain('300ms');
    expect(el.style.transition).toContain(EASE.out);
  });

  it('staggers with a transition delay', () => {
    const el = render({ delay: 120 });
    expect(el.style.transitionDelay).toBe('120ms');
  });

  it('keeps the observer attached after revealing so it can unobserve', () => {
    const el = render();
    act(() => FakeObserver.instances[0]!.trigger(true));
    expect(FakeObserver.instances[0]!.observed).toHaveLength(0);
    expect(el.className).toContain('is-shown');
  });

  it('shows content immediately when the browser has no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const el = render();
    expect(el.className).toContain('is-shown');
    expect(el.textContent).toBe('content');
  });

  it('never hides content when disabled (reduced motion path)', () => {
    const el = render({ disabled: true });
    expect(el.className).toContain('is-shown');
    expect(el.style.opacity).toBe('');
    expect(el.textContent).toBe('content');
  });

  it('skips the animation entirely when the OS asks for reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const el = render();
    expect(el.className).toContain('is-shown');
    expect(el.style.opacity).toBe('');
    // No observer should even be created.
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('renders as the requested element and keeps extra props', () => {
    const el = render({ as: 'article', 'data-testid': 'card', onClick: () => {} });
    expect(el.tagName).toBe('ARTICLE');
    expect(el.getAttribute('data-testid')).toBe('card');
  });

  it('renders all children, not just the first', () => {
    act(() => {
      root.render(
        <RevealCard>
          <span>one</span>
          <span>two</span>
        </RevealCard>,
      );
    });
    act(() => FakeObserver.instances[0]!.trigger(true));
    expect(container.textContent).toBe('onetwo');
  });
});

describe('stagger', () => {
  it('increases the delay per item', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(1, 50)).toBe(50);
    expect(stagger(3, 50)).toBe(150);
  });

  it('caps the delay so a long list does not take forever to settle', () => {
    expect(stagger(999)).toBe(stagger(12));
  });

  it('supports a base offset', () => {
    expect(stagger(2, 50, 100)).toBe(200);
  });
});