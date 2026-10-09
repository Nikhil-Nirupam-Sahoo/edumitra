#!/usr/bin/env node
/**
 * Fetch chapter photographs from Wikimedia Commons.
 *
 * WHY NOT HOTLINK `<img src="https://...">`:
 *   EduMitra is offline-first. A remote <img> is a broken box the moment the
 *   device loses signal, leaks every student to a third party, and can't be
 *   cached reliably. So images are *sourced once, here*, optimised to WebP,
 *   committed to images/, and served from our own /api/v1/images/* — the same
 *   shape as the curriculum content packs. The client then caches them like any
 *   other download and they work with the network off.
 *
 * Everything fetched here is CC0 / CC BY / CC BY-SA / public domain /
 * Government of India Open Data. Attribution is recorded per image and shipped
 * in the manifest, because CC BY requires crediting the author.
 *
 * Usage:
 *   node scripts/fetch-images.mjs            # fetch missing/changed images
 *   node scripts/fetch-images.mjs --dry-run  # report candidates, write nothing
 *   node scripts/fetch-images.mjs --only c8-sci-combustion-flame
 */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';

const run = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'images');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const API = 'https://commons.wikimedia.org/w/api.php';

// Wikimedia asks for a descriptive User-Agent with contact info.
const UA = 'EduMitra/1.0 (offline-first CBSE learning PWA; https://github.com/Nikhil-Nirupam-Sahoo/edumitra)';

/** Card thumbnails and reel heroes. WebP keeps both tiny. */
const SIZES = {
  card: 640,
  hero: 1280,
};

/**
 * A search phrase per chapter. Specific beats generic: Commons' search happily
 * returns logos, diagrams and unrelated stock, and a wrong photo is worse than
 * no photo — the whole point of this project is that visuals match the chapter.
 */
const QUERIES = {
  // --- Class 8 maths -------------------------------------------------------
  'c8-math-rational-numbers': 'Egyptian fraction papyrus Rhind',
  'c8-math-linear-equations': 'balance scale weighing laboratory',
  'c8-math-mensuration': 'stonehenge circle geometry landscape',
  // --- Class 8 science -----------------------------------------------------
  'c8-sci-force-pressure': 'aneroid barometer instrument',
  'c8-sci-combustion-flame': 'campfire flame burning wood',
  'c8-sci-microorganisms': 'bacteria microscope slide culture',
  // --- Class 8 social science ---------------------------------------------
  'c8-sst-resources': 'iron ore mine open pit',
  'c8-sst-agriculture': 'paddy field farmer India transplanting',
  'c8-sst-constitution': 'Parliament of India Sansad Bhavan building',
  // --- Class 8 english -----------------------------------------------------
  'c8-en-tenses': 'vintage pocket watch clock mechanism',
  'c8-en-active-passive': 'greek theatre stage mask comedy tragedy',
  'c8-en-comprehension': 'open book library reading pages',
  // --- Class 9 maths -------------------------------------------------------
  'c9-math-polynomials': 'bungee cord elastic stretching',
  'c9-math-number-systems': 'irrational number pi spiral mathematics',
  'c9-math-lines-angles': 'theodolite surveying instrument angle',
  // --- Class 9 science -----------------------------------------------------
  'c9-sci-matter-surroundings': 'water boiling vapour steam kettle',
  'c9-sci-motion': 'bullet train shinkansen motion blur',
  'c9-sci-atoms-molecules': 'molecular model atoms chemistry ball stick',
  // --- Class 9 social science ---------------------------------------------
  'c9-sst-democracy': 'ballot box voting election',
  'c9-sst-climate': 'monsoon rain india street umbrella',
  'c9-sst-food-security': 'wheat grain harvest farmer threshing',
  // --- Class 9 english -----------------------------------------------------
  'c9-en-reported-speech': 'telephone handset vintage conversation',
  'c9-en-conditionals': 'fork in the road path sign choice',
  'c9-en-passive-voice': 'chess board pieces game strategy',
  // --- Class 10 maths ------------------------------------------------------
  'c10-math-real-numbers': 'number line infinity real numbers mathematics',
  'c10-math-quadratic-equations': 'parabola satellite dish antenna',
  'c10-math-trigonometry': 'trigonometry sine wave pendulum',
  // --- Class 10 science ----------------------------------------------------
  'c10-sci-chemical-reactions': 'chemical reaction test tubes bubbling',
  'c10-sci-life-processes': 'photosynthesis leaf chloroplast light',
  'c10-sci-light': 'light refraction prism spectrum rainbow',
  // --- Class 10 social science ---------------------------------------------
  'c10-sst-development': 'india gate delhi monument development',
  'c10-sst-sectors-economy': 'factory workers production line industry',
  'c10-sst-federalism': 'map india states union territories',
  // --- Class 10 english ----------------------------------------------------
  'c10-en-clauses': 'sentence grammar punctuation writing manuscript',
  'c10-en-determiners': 'grocery shop market vegetables quantity',
  'c10-en-tenses': 'hourglass sand time passage',
};

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex === -1 ? null : argv[onlyIndex + 1];

/** Reject anything that is not a photograph-like raster image. */
const BAD_TITLE = /\b(logo|icon|map|diagram|chart|graph|coat of arms|seal|flag|svg|poster|screenshot|cover|stamp|banner|scheme|sign|locator|infobox|symbol)\b/i;
const BAD_EXT = /\.(svg|ogv|webm|ogv|gif|tif|tiff|djvu|pdf|xcf)$/i;

/** Licences we are allowed to redistribute with attribution. */
const LICENSE_OK = /^(cc0|cc by|cc-by|public domain|pd|godl|attribution)/i;

async function search(query) {
  const url =
    `${API}?action=query&format=json&generator=search` +
    `&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrnamespace=6&gsrlimit=25` +
    `&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=${SIZES.hero}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`search failed ${res.status}: ${query}`);
  const data = await res.json();
  const pages = data?.query?.pages ?? {};
  const out = [];
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (BAD_EXT.test(page.title)) continue;
    if (BAD_TITLE.test(page.title)) continue;
    const meta = info.extmetadata ?? {};
    const license = (meta.LicenseShortName?.value ?? '').replace(/<[^>]+>/g, '').trim();
    if (!LICENSE_OK.test(license)) continue;
    if ((info.width ?? 0) < 900) continue;
    const ratio = info.width / info.height;
    if (ratio < 1.15 || ratio > 2.4) continue; // want landscape hero crops
    out.push({
      title: page.title,
      license,
      author: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim() || 'Unknown',
      credit: (meta.Credit?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 80),
      sourceUrl: info.descriptionurl,
      downloadUrl: info.thumburl ?? info.url,
      width: info.thumburl ? SIZES.hero : info.width,
      height: info.thumburl ? Math.round(SIZES.hero / ratio) : info.height,
    });
  }
  return out;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Downloads and produces two WebP sizes. ImageMagick does the conversion. */
async function fetchImage(lessonId, candidate) {
  const res = await fetch(candidate.downloadUrl, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());

  const tmp = join(OUT_DIR, '.tmp');
  await mkdir(tmp, { recursive: true });
  const tmpIn = join(tmp, `${lessonId}.src`);
  await writeFile(tmpIn, raw);

  const outputs = {};
  for (const [key, width] of Object.entries(SIZES)) {
    const out = join(OUT_DIR, `${lessonId}.${key}.webp`);
    await run('magick', [
      tmpIn,
      '-auto-orient',
      '-strip',
      '-resize', `${width}x`,
      '-quality', key === 'card' ? '72' : '76',
      '-define', 'webp:method=6',
      out,
    ]);
    outputs[key] = out;
  }
  return outputs;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let manifest = { schema: 1, generatedAt: null, images: {} };
  if (await exists(MANIFEST)) {
    manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  }

  const ids = ONLY ? [ONLY] : Object.keys(QUERIES);
  const results = [];

  for (const lessonId of ids) {
    const query = QUERIES[lessonId];
    if (!query) {
      console.error(`no query for ${lessonId}`);
      continue;
    }
    let candidates = [];
    try {
      candidates = await search(query);
    } catch (error) {
      console.error(`  ! ${lessonId}: ${error.message}`);
      continue;
    }
    if (candidates.length === 0) {
      console.log(`  ? ${lessonId}: no usable candidate for "${query}"`);
      continue;
    }

    const chosen = candidates[0];
    if (DRY_RUN) {
      console.log(`  · ${lessonId}\n      "${query}" -> ${chosen.title}\n      ${chosen.license} · ${chosen.width}x${chosen.height}`);
      results.push({ lessonId, chosen, alternatives: candidates.length });
      continue;
    }

    // Skip if we already have both sizes for this chapter.
    if (
      manifest.images[lessonId] &&
      (await exists(join(OUT_DIR, `${lessonId}.card.webp`))) &&
      (await exists(join(OUT_DIR, `${lessonId}.hero.webp`)))
    ) {
      console.log(`  = ${lessonId}: already present`);
      continue;
    }

    try {
      await fetchImage(lessonId, chosen);
      manifest.images[lessonId] = {
        credit: chosen.author,
        license: chosen.license,
        sourceUrl: chosen.sourceUrl,
        commonsTitle: chosen.title,
        sizes: { card: SIZES.card, hero: SIZES.hero },
      };
      console.log(`  + ${lessonId}: ${chosen.title} (${chosen.license})`);
    } catch (error) {
      console.error(`  ! ${lessonId}: ${error.message}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\ndry run: ${results.length} chapters had at least one usable candidate`);
    return;
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