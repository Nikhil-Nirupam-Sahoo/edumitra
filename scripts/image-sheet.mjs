#!/usr/bin/env node
/**
 * Builds labelled contact sheets from the previews already downloaded by
 * image-candidates.mjs — no network, so sheets can be regenerated and
 * re-reviewed as often as needed.
 *
 * Layout: one horizontal row per chapter (candidates left→right, each stamped
 * with its index), rows stacked vertically. The candidate order matches
 * .image-review/catalogue.json, so a pick is just "row N, index K".
 *
 *   node scripts/image-sheet.mjs 0 3      # chapters 0..3
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const WORK = join(ROOT, '.image-review');
const TILE_W = 300;
const ROWS_PER_SHEET = 4;

const catalogue = JSON.parse(await readFile(join(WORK, 'catalogue.json'), 'utf8'));
const sheetArg = Number(process.argv[2] ?? 0);

// The catalogue is already keyed by sheet index (0, 1, 2 …), one group per
// ROWS_PER_SHEET chapters.
const allSheets = Object.keys(catalogue)
  .map(Number)
  .sort((a, b) => a - b)
  .map((index) => ({ index, entries: Object.entries(catalogue[index]) }));

await mkdir(WORK, { recursive: true });

const available = new Set(await readdir(WORK));

/**
 * Commons search happily returns 240px animated GIF icons among the real
 * photos, and those make montage fail outright. Validate before using.
 */
async function usable(file) {
  try {
    const { stdout } = await run('magick', [
      'identify', '-format', '%w %h %n', file,
    ]);
    const [w, h, frames] = stdout.trim().split(/\s+/).map(Number);
    return Number.isFinite(w) && w >= 600 && h >= 400 && frames <= 1;
  } catch {
    return false;
  }
}

for (const sheet of allSheets) {
  if (sheetArg >= 0 && sheet.index !== sheetArg) continue;
  const rowFiles = [];
  const used = [];

  for (const [lessonId, { candidates }] of sheet.entries) {
    const tiles = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const raw = `${lessonId}-${i}.jpg`;
      if (!available.has(raw)) continue;
      if (!(await usable(join(WORK, raw)))) continue;
      const tile = join(WORK, `t-${lessonId}-${i}.png`);
      try {
        // Stamp the index so a pick can be read straight off the sheet.
        await run('magick', [
          join(WORK, raw),
          '-auto-orient',
          '-resize', `${TILE_W}x${TILE_W}^`,
          '-gravity', 'center', '-extent', `${TILE_W}x${TILE_W}`,
          '-background', 'black', '-fill', 'yellow', '-pointsize', '40',
          '-gravity', 'north', '-annotate', '+0+6', `[${i}]`,
          tile,
        ]);
      } catch {
        continue;
      }
      tiles.push(tile);
      used.push({ lessonId, index: i });
    }
    if (tiles.length === 0) continue;
    const row = join(WORK, `row-${sheet.index}-${lessonId}.png`);
    await run('magick', [
      ...tiles,
      '-background', '#0a0a12',
      '+append',
      '-bordercolor', '#0a0a12', '-border', '6',
      row,
    ]);
    // Title strip so the row can be identified without the catalogue.
    const titled = join(WORK, `rowt-${sheet.index}-${lessonId}.png`);
    await run('magick', [
      '-size', '200x40', 'xc:#0a0a12',
      '-fill', '#00e5ff', '-pointsize', '22', '-gravity', 'center',
      '-annotate', '+0+0', lessonId,
      row,
      '-background', '#0a0a12', '-gravity', 'south', '-append', titled,
    ]);
    rowFiles.push(titled);
  }

  if (rowFiles.length === 0) continue;
  const out = join(WORK, `sheet-${sheet.index}.png`);
  await run('magick', [...rowFiles, '-background', '#0a0a12', '-append', out]);
  const dims = await run('magick', ['identify', '-format', '%wx%h', out]);
  await writeFile(
    join(WORK, `sheet-${sheet.index}.json`),
    JSON.stringify({ cells: used }, null, 2),
  );
  console.log(`sheet ${sheet.index}: ${out} ${dims.stdout} (${used.length} candidates)`);
}