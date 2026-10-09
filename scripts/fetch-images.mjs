#!/usr/bin/env node
/**
 * Downloads the chapter photographs chosen in images/picks.json, optimises them
 * to WebP, and writes images/manifest.json with the attribution CC BY requires.
 *
 * WHY NOT HOTLINK `<img src="https://...">`:
 *   EduMitra is offline-first. A remote <img> is a broken box the moment the
 *   device loses signal, sends every student to a third party, and can't be
 *   cached reliably. So images are sourced once, here, committed under
 *   images/, and served from our own /api/v1/images/* — the same shape as the
 *   curriculum content packs. The client caches them like any other download
 *   and they work with the network off.
 *
 * Only freely-licensed files are accepted (CC0 / CC BY / CC BY-SA / public
 * domain / Government of India Open Data). Author and licence travel in the
 * manifest and are shown in the app.
 *
 * Picks are made by eye in .image-review/ (see image-candidates.mjs) because
 * Commons search is good enough to shortlist and not good enough to choose.
 *
 * Usage:
 *   node scripts/fetch-images.mjs           # fetch anything not on disk yet
 *   node scripts/fetch-images.mjs --force   # re-fetch everything
 */

import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const run = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'images');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const PICKS = join(OUT_DIR, 'picks.json');
const CATALOGUE = join(ROOT, '.image-review', 'catalogue.json');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA =
  'EduMitra/1.0 (offline-first CBSE learning PWA; https://github.com/Nikhil-Nirupam-Sahoo/edumitra)';

/** Card thumbnails and reel heroes. WebP keeps both tiny. */
const SIZES = { card: 640, hero: 1280 };

const FORCE = process.argv.includes('--force');

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

/**
 * Picks are stored as either a candidate index into the catalogue, or as
 * `"title:File:…"` to pin an exact Commons file.
 *
 * Indexes are the convenient form while reviewing a contact sheet, but Commons
 * search ordering is not stable between runs — the same query can return a
 * different ranking tomorrow, which silently re-points a pick at an unrelated
 * photo. Anything that must not drift (a country's parliament, a specific
 * chapter) is pinned by title.
 */
const PINNED = {
  // "The Indian Constitution" must not resolve to another country's parliament.
  'c8-sst-constitution': 'title:File:New Delhi government block 03-2016 img3.jpg',
  'c9-sst-climate': 'title:File:Monsoon clouds in Bengal India.jpg',
};
async function fileInfo(title) {
  const url =
    `${API}?action=query&format=json&titles=${encodeURIComponent(title)}` +
    `&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=${SIZES.hero}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`metadata ${res.status}`);
  const data = await res.json();
  const page = Object.values(data?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`no imageinfo for ${title}`);
  const strip = (v) => (v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const meta = info.extmetadata ?? {};
  return {
    downloadUrl: info.thumburl ?? info.url,
    license: strip(meta.LicenseShortName?.value) || 'See source',
    author: strip(meta.Artist?.value).slice(0, 80) || 'Unknown',
    sourceUrl: info.descriptionurl,
  };
}

/** Downloads and produces two WebP sizes. ImageMagick does the conversion. */
async function fetchImage(lessonId, url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  const tmp = join(OUT_DIR, '.tmp');
  await mkdir(tmp, { recursive: true });
  const tmpIn = join(tmp, `${lessonId}.src`);
  await writeFile(tmpIn, raw);

  for (const [key, width] of Object.entries(SIZES)) {
    await run('magick', [
      tmpIn,
      '-auto-orient',
      '-strip',
      '-resize', `${width}x`,
      '-quality', key === 'card' ? '72' : '76',
      '-define', 'webp:method=6',
      join(OUT_DIR, `${lessonId}.${key}.webp`),
    ]);
  }
  await rm(tmpIn, { force: true });
}

async function main() {
  const picks = await readJson(PICKS);
  const catalogue = (await exists(CATALOGUE)) ? await readJson(CATALOGUE) : {};

  // Resolve each pick (lessonId -> candidate index) back to its Commons title.
  const resolved = [];
  for (const [lessonId, pick] of Object.entries({ ...picks, ...PINNED })) {
    const pinned = typeof pick === 'string' && pick.startsWith('title:');
    if (pinned) {
      resolved.push({ lessonId, title: pick.slice('title:'.length) });
      continue;
    }
    let title = null;
    for (const sheet of Object.values(catalogue)) {
      const entry = sheet[lessonId];
      if (entry?.candidates?.[pick]) {
        title = entry.candidates[pick].title;
        break;
      }
    }
    if (!title) {
      console.warn(`  ! ${lessonId}: no catalogue entry for index ${pick} — run image-candidates.mjs --recheck`);
      continue;
    }
    resolved.push({ lessonId, title });
  }

  await mkdir(OUT_DIR, { recursive: true });
  let manifest = { schema: 1, generatedAt: null, images: {} };
  if (await exists(MANIFEST)) manifest = await readJson(MANIFEST);

  for (const { lessonId, title } of resolved) {
    const card = join(OUT_DIR, `${lessonId}.card.webp`);
    const hero = join(OUT_DIR, `${lessonId}.hero.webp`);
    if (!FORCE && manifest.images[lessonId] && (await exists(card)) && (await exists(hero))) {
      console.log(`  = ${lessonId}`);
      continue;
    }
    try {
      const info = await fileInfo(title);
      await fetchImage(lessonId, info.downloadUrl);
      manifest.images[lessonId] = {
        credit: info.author,
        license: info.license,
        sourceUrl: info.sourceUrl,
        commonsTitle: title,
        sizes: { ...SIZES },
      };
      console.log(`  + ${lessonId}: ${title} (${info.license})`);
    } catch (error) {
      console.error(`  ! ${lessonId}: ${error.message}`);
    }
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.count = Object.keys(manifest.images).length;
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nwrote ${MANIFEST} (${manifest.count} images)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});