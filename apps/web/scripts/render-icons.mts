/**
 * Bakes the app's icons and social card out of the same quilt the hero paints.
 *
 * The mark is not a drawing of the product, it is a crop of it: the identical
 * generator, palette and clock the hero canvas runs, sampled at four blocks
 * instead of eighteen so the cells survive being 4px wide in a tab strip. That
 * is the whole idea — someone who has seen the site recognises the tab, because
 * it is literally the same sky.
 *
 * The focus moves, and only the focus. The hero puts its hot core at
 * (0.84, 0.12) to keep the bottom-left quadrant black for the headline; an icon
 * has no headline to protect and a corner-lit one reads as a dark smudge at
 * 16px, so the core comes in to (0.55, 0.38) where it lights most of the tile.
 *
 * Outputs, all committed:
 *   src/app/icon.svg             — browser tabs. Vector, so it is sharp anywhere.
 *   src/app/favicon.ico          — 32², for anything that asks for /favicon.ico
 *                                  by hand rather than reading the markup.
 *   src/app/apple-icon.png       — 180², square: iOS masks its own corners.
 *   src/app/opengraph-image.png  — 1200×630 social card.
 *
 * Regenerate with:  pnpm --filter @aam/web icons
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CLOCK_BASE, HERO_QUILT, cellTone, quiltGrid, sampleRamp } from '../src/lib/pixel-quilt';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');

/** The icon's setting: the hero's quilt, coarser and lit from nearer the middle. */
const ICON_QUILT = { ...HERO_QUILT, blocks: 4, focusX: 0.55, focusY: 0.38 };

/** Cells are drawn a hair over size; at fractional widths this is what stops
 *  hairline seams of the page background showing between them. */
const OVERDRAW = 0.4;

/**
 * The quilt as flat `<rect>`s.
 *
 * No seams. The hero draws a lit and a shadowed edge on every gridline to make
 * the grid read as cloth, but a seam is ~1% of a cell and at icon sizes that is
 * a sub-pixel line that renderers turn into mud.
 */
function quiltCells(width: number, height: number, settings: typeof ICON_QUILT): string {
  const grid = quiltGrid(width, height, settings.blocks);
  const cells: string[] = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const [r, g, b] = sampleRamp(settings.stops, cellTone(grid, row, col, CLOCK_BASE, settings));
      cells.push(
        `<rect x="${(col * grid.cw).toFixed(2)}" y="${(row * grid.ch).toFixed(2)}"` +
          ` width="${(grid.cw + OVERDRAW).toFixed(2)}" height="${(grid.ch + OVERDRAW).toFixed(2)}"` +
          ` fill="rgb(${r},${g},${b})"/>`,
      );
    }
  }
  return cells.join('');
}

function iconSvg(size: number, radius: number): string {
  const clip = radius > 0 ? ' clip-path="url(#r)"' : '';
  const defs = radius > 0
    ? `<defs><clipPath id="r"><rect width="${size}" height="${size}" rx="${radius}"/></clipPath></defs>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    // The void underneath matters: a transparent icon on a light tab strip
    // would show the quilt's dark cells as holes.
    `<rect width="${size}" height="${size}" rx="${radius}" fill="#090909"/>` +
    `<g${clip}>${quiltCells(size, size, ICON_QUILT)}</g>${defs}</svg>`
  );
}

/**
 * The social card.
 *
 * Built as HTML rather than SVG so it can use the real faces off Google Fonts
 * and the real type scale, instead of an approximation drawn in paths.
 */
function ogHtml(): string {
  const sky = quiltCells(1200, 630, { ...ICON_QUILT, blocks: 12, focusX: 0.86, focusY: 0.1 });

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Playfair+Display:ital@1&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; position: relative; overflow: hidden;
    background: #090909; color: #f7f9fa;
    font-family: Inter, system-ui, sans-serif; font-weight: 300;
  }
  /* The sky, faded out over the lower half exactly as the site's .atmosphere
     does — a hard edge across the frame reads as a rendering fault. */
  .sky {
    position: absolute; inset: 0;
    -webkit-mask-image: radial-gradient(96% 130% at 92% 0%, black 0%, black 26%, transparent 68%);
    mask-image: radial-gradient(96% 130% at 92% 0%, black 0%, black 26%, transparent 68%);
  }
  .sky svg { width: 100%; height: 100%; display: block; }
  .body { position: relative; padding: 74px 80px; height: 100%; display: flex; flex-direction: column; }
  .stamp {
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 17px;
    letter-spacing: 0.18em; text-transform: uppercase; color: #828384;
  }
  .mark { margin-top: auto; font-size: 40px; letter-spacing: 0.06em; }
  .mark i { font-family: "Playfair Display", Georgia, serif; font-style: italic; font-size: 50px; letter-spacing: 0.01em; }
  h1 { font-size: 82px; line-height: 1.04; letter-spacing: -0.04em; font-weight: 300; margin-top: 20px; max-width: 11ch; }
  h1 em { font-family: "Playfair Display", Georgia, serif; font-style: italic; font-weight: 400; letter-spacing: -0.03em; color: #e1bdff; }
  p { margin-top: 24px; font-size: 23px; line-height: 1.5; color: #828384; max-width: 40ch; }
</style></head>
<body>
  <div class="sky"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">${sky}</svg></div>
  <div class="body">
    <div class="stamp">Built for ETHOnline 2026</div>
    <div class="mark"><i>GRAPE</i> AI</div>
    <h1>Ads that <em>pay for your AI</em></h1>
    <p>A coding assistant denominated in credits, where relevant sponsored content subsidises inference instead of interrupting it.</p>
  </div>
</body></html>`;
}

/* --- rasterising ---------------------------------------------------------- */

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function chrome(): string {
  const found = process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome found to rasterise with. Set CHROME_PATH, or install Chrome.\n' +
        'icon.svg is written either way — only the PNGs need a browser.',
    );
  }
  return found;
}

function shoot(html: string, out: string, width: number, height: number, scale = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'grape-icons-'));
  const page = join(dir, 'page.html');
  writeFileSync(page, html);
  try {
    execFileSync(
      chrome(),
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        `--force-device-scale-factor=${scale}`,
        `--screenshot=${out}`,
        `--window-size=${width},${height}`,
        // Long enough for the webfonts to arrive; the card is unreadable in
        // fallback faces and a silent fallback is worse than a slow script.
        '--virtual-time-budget=9000',
        `file://${page}`,
      ],
      { stdio: 'ignore' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A PNG, wrapped in the smallest legal .ico around it.
 *
 * Everything that reads markup uses `icon.svg`, but a fair amount of software —
 * feed readers, chat unfurlers, the odd crawler — still fetches `/favicon.ico`
 * blind, and a 404 there shows those surfaces a blank page. Since Vista, an ICO
 * entry may be a PNG verbatim, so no encoder is needed: one directory entry
 * pointed at the bytes is the whole file.
 */
function icoFromPng(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // 0 encodes 256
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette size: 0 for truecolour
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
}

/* --- go ------------------------------------------------------------------- */

// 12/64 ≈ the 19.2px card radius the design system uses, at icon scale.
writeFileSync(join(APP, 'icon.svg'), iconSvg(64, 12));
console.log('icon.svg');

// Square: iOS rounds it itself, and rounding it twice leaves grey corners.
shoot(
  `<body style="margin:0">${iconSvg(180, 0)}</body>`,
  join(APP, 'apple-icon.png'),
  180,
  180,
);
console.log('apple-icon.png');

{
  const dir = mkdtempSync(join(tmpdir(), 'grape-ico-'));
  const png = join(dir, 'icon32.png');
  // Rounded, like icon.svg: this one is shown as-is, with nothing masking it.
  shoot(`<body style="margin:0">${iconSvg(32, 6)}</body>`, png, 32, 32);
  writeFileSync(join(APP, 'favicon.ico'), icoFromPng(readFileSync(png), 32));
  rmSync(dir, { recursive: true, force: true });
  console.log('favicon.ico');
}

shoot(ogHtml(), join(APP, 'opengraph-image.png'), 1200, 630);
console.log('opengraph-image.png');
