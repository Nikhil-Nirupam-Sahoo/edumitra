#!/usr/bin/env node
/**
 * Candidate review helper for scripts/fetch-images.mjs.
 *
 * Commons' search is good enough to *shortlist* and not good enough to
 * *choose* — "assembly line factory workers" comes back with an armoured car.
 * This downloads small previews of the top candidates per chapter and montages
 * them into labelled contact sheets so the picks can be made by eye, then
 * written into images/picks.json and consumed by fetch-images.mjs.
 *
 *   node scripts/image-candidates.mjs            # sheets for chapters with no pick
 *   node scripts/image-candidates.mjs --sheet 2  # just rebuild sheet 2
 */

import { mkdir, writeFile, readFile, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const WORK = join(ROOT, '.image-review');
const PICKS = join(ROOT, 'images', 'picks.json');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'EduMitra/1.0 (offline-first CBSE learning PWA; https://github.com/Nikhil-Nirupam-Sahoo/edumitra)';

const TOP_N = 6;
const THUMB_W = 420;

const QUERIES = JSON.parse(await readFile(new URL('./image-queries.json', import.meta.url), 'utf8'));

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function stripHtml(v) {
  return (v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function search(query) {
  const url =
    `${API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrnamespace=6&gsrlimit=${TOP_N * 4}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const data = await res.json();
  const pages = Object.values(data?.query?.pages ?? {});
  const out = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const meta = info.extmetadata ?? {};
    const license = stripHtml(meta.LicenseShortName?.value);
    if (out.length >= TOP_N) break;
    out.push({
      title: page.title,
      license,
      author: stripHtml(meta.Artist?.value).slice(0, 60) || 'Unknown',
      sourceUrl: info.descriptionurl,
      thumb: info.thumburl,
    });
  }
  return out;
}

const argv = process.argv.slice(2);
const sheetIdx = argv.indexOf('--sheet');
const onlySheet = sheetIdx === -1 ? null : Number(argv[sheetIdx + 1]);

await mkdir(WORK, { recursive: true });
await mkdir(join(ROOT, 'images'), { recursive: true });

let picks = {};
if (await exists(PICKS)) picks = JSON.parse(await readFile(PICKS, 'utf8'));

const pending = Object.keys(QUERIES).filter((id) => !picks[id]);
const recheck = argv.includes('--recheck');
const targets = recheck ? Object.keys(QUERIES) : pending;
console.log(
  `${Object.keys(QUERIES).length} chapters, ${targets.length} ` +
    `${recheck ? 'being re-catalogued' : 'still need a pick'}`,
);

// Group chapters into contact sheets of 4 (2x2 candidates each).
const groups = [];
for (let i = 0; i < targets.length; i += 4) groups.push(targets.slice(i, i + 4));

const catalogue = {};

for (let g = 0; g < groups.length; g++) {
  if (onlySheet !== null && onlySheet !== g) continue;
  const ids = groups[g];
  const tiles = [];
  catalogue[g] = {};

  for (const lessonId of ids) {
    const candidates = await search(QUERIES[lessonId]);
    catalogue[g][lessonId] = { query: QUERIES[lessonId], candidates };
    const rows = [];
    const have = new Set(await readdir(WORK));
    for (const c of candidates) {
      const idx = candidates.indexOf(c);
      const img = join(WORK, `${lessonId}-${idx}.jpg`);
      if (!have.has(`${lessonId}-${idx}.jpg`)) {
        try {
          const r = await fetch(c.thumb, { headers: { 'user-agent': UA } });
          await writeFile(img, Buffer.from(await r.arrayBuffer()));
        } catch { continue; }
      }
      rows.push({ img, c });
    }
    // One row per chapter: label each tile with its candidate index.
    for (const { img, c } of rows) {
      const idx = candidates.indexOf(c);
      const labelled = img.replace(/\.jpg$/, '-lbl.png');
      await run('magick', [
        img,
        '-resize', `${THUMB_W}x`,
        '-background', '#101018', '-fill', 'white',
        '-gravity', 'north', '-pointsize', '34',
        'label:' + String(idx),
        '-gravity', 'center', '-append', labelled,
      ]);
      tiles.push({ path: labelled, lessonId, index: idx });
    }
  }

  if (tiles.length === 0) {
    console.log(`sheet ${g}: no tiles`);
    continue;
  }
  const args = ['montage'];
  for (const t of tiles) args.push(t.path);
  args.push('-tile', '6x', '-geometry', '+6+6', '-background', '#0a0a12', join(WORK, `sheet-${g}.png`));
  await run('magick', args);
  console.log(
    `sheet ${g}: ${tiles.length} tiles -> .image-review/sheet-${g}.png\n` +
      ids.map((id) => `   ${id}  "${QUERIES[id]}"`).join('\n'),
  );
}

await writeFile(join(WORK, 'catalogue.json'), JSON.stringify(catalogue, null, 2));
console.log(`\ncatalogue -> .image-review/catalogue.json`);