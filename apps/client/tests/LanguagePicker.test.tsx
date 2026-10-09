// @vitest-environment jsdom
/**
 * LanguagePicker tests.
 *
 * The regression these guard: with no translation key on the server, every
 * "translate the app into…" chip was clickable and each one ended in the same
 * dead-end error. Cached bundles must stay selectable regardless — they live
 * on the device and have to keep working offline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LanguagePicker } from '../src/modules/settings/LanguagePicker';
import { clearRemoteForTests, putRemoteBundleForTests } from '../src/i18n/remote';
import { SUPPORTED_LOCALES } from '../src/i18n';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

async function flush(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function render(): void {
  act(() => {
    root.render(<LanguagePicker locale="en" onLocaleChange={() => {}} />);
  });
}

/** Cached bundle chips — the three that ship in the bundle. */
function bundledChips(): HTMLButtonElement[] {
  const groups = container.querySelectorAll('.language-list');
  return [...(groups[0]?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
}

function extraChips(): HTMLButtonElement[] {
  const groups = container.querySelectorAll('.language-list');
  return [...(groups[1]?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
}

function statusText(): string {
  return [...container.querySelectorAll('.language-status')]
    .map((n) => n.textContent ?? '')
    .join(' ');
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clearRemoteForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  clearRemoteForTests();
});

describe('LanguagePicker', () => {
  it('always offers the bundled languages, enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ enabled: false }))),
    );
    render();
    await flush();

    // Derived from SUPPORTED_LOCALES so a newly bundled language appears here
    // automatically — this asserts every one of them is offered and enabled.
    const chips = bundledChips();
    expect(chips.map((c) => c.textContent?.trim())).toEqual(
      SUPPORTED_LOCALES.map((l) => l.label),
    );
    expect(chips.length).toBeGreaterThanOrEqual(4);
    for (const chip of chips) expect(chip.disabled).toBe(false);
  });

  it('disables the extra languages when the server has no translation key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ enabled: false }))),
    );
    render();
    await flush();

    const extras = extraChips();
    expect(extras.length).toBeGreaterThan(10);
    for (const chip of extras) expect(chip.disabled).toBe(true);
    expect(statusText()).toContain('switched off');
  });

  it('enables the extra languages when translation is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ enabled: true }))),
    );
    render();
    await flush();

    for (const chip of extraChips()) expect(chip.disabled).toBe(false);
    expect(statusText()).not.toContain('switched off');
  });

  it('keeps a cached language selectable even with no server configured', async () => {
    putRemoteBundleForTests('fr', { 'nav.lessons': 'Leçons' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ enabled: false }))),
    );
    render();
    await flush();

    const french = extraChips().find((c) => (c.textContent ?? '').includes('Français'));
    expect(french, 'French chip missing').toBeDefined();
    expect(french!.disabled).toBe(false);
    expect(french!.textContent).toContain('✓');
    // The uncached ones are still off.
    const bengali = extraChips().find((c) => (c.textContent ?? '').includes('বাংলা'));
    expect(bengali!.disabled).toBe(true);
  });

  it('stays usable offline without blocking the bundled languages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    render();
    await flush();

    for (const chip of bundledChips()) expect(chip.disabled).toBe(false);
    // Unknown availability (null) must not disable anything — guessing "off"
    // would lock out a student who is merely offline.
    for (const chip of extraChips()) expect(chip.disabled).toBe(false);
  });

  it('switches to a bundled language without touching the network', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: true })));
    vi.stubGlobal('fetch', fetchMock);
    let chosen = '';
    act(() => {
      root.render(
        <LanguagePicker locale="en" onLocaleChange={(code) => (chosen = code)} />,
      );
    });
    await flush();
    const before = fetchMock.mock.calls.length;

    const tamil = bundledChips().find((c) => (c.textContent ?? '').includes('தமிழ்'))!;
    act(() => {
      tamil.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(chosen).toBe('ta');
    // Only the status probe, no translation request.
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});