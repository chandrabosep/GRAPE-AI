/**
 * Bakes the pixel quilt into the wide creative banners as animated SVG.
 *
 * The quilt lives in the hero as a canvas, but a creative cannot: both
 * renderers draw advertiser artwork through a plain `<img>`, where scripts do
 * not run. So the animation is baked — the quilt is sampled at a handful of
 * clock positions and each cell gets a CSS keyframe walking it through its own
 * colours. CSS rather than SMIL specifically so `prefers-reduced-motion` can
 * switch it off, which `<animate>` cannot be made to respect.
 *
 * Two things keep the output small. Cells whose colour never changes across the
 * sampled window are emitted as a plain fill with no animation at all, which is
 * most of the dark end of every one of these banners. And cells that happen to
 * walk the same sequence share one keyframe rule.
 *
 * The animation runs `alternate`, so the sampled window only has to be a
 * half-cycle: it plays forward, then backward, and joins seamlessly. The quilt's
 * drift is driven by several incommensurate sines and has no natural loop
 * point, so a palindrome is the only way to loop it without a visible jump.
 *
 * Regenerate with:  pnpm --filter @aam/web creatives
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CLOCK_BASE,
  SEAM_LIGHT,
  cellTone,
  quiltGrid,
  sampleRamp,
  seamDark,
  seamWidth,
  type QuiltSettings,
} from '../src/lib/pixel-quilt';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'creatives');

/** How far through the quilt's clock the baked window travels. */
const CLOCK_SPAN = 5;
/** Samples across that window. Six is enough — CSS tweens between them. */
const FRAMES = 6;

interface Creative {
  file: string;
  label: string;
  /** Drawn over the quilt, verbatim. Each advertiser's own motif. */
  motif: string;
  quilt: QuiltSettings;
}

/*
 * Each advertiser keeps their own hue. The quilt is a technique, not a brand —
 * repainting every creative violet would make three advertisers look like one,
 * and the point of the card is that the advertiser is identifiable.
 *
 * Every ramp tops out well below its motif colour. These banners are read at
 * about a third of their drawn size, where a quilt core as bright as the nodes
 * or chips on top of it would swallow them; the quilt has to stay the thing
 * behind. Each ramp's darkest tone is also the creative's original background,
 * so the flat version and the quilt version sit on the same ground.
 */
const CREATIVES: Creative[] = [
  {
    file: 'northwind-rpc-wide',
    label: 'Managed Ethereum RPC nodes',
    // Focus right of centre, balancing the graph's own glow at x≈196.
    quilt: {
      stops: ['#080d16', '#0d1728', '#152a45', '#1b4263', '#24688f'],
      blocks: 8,
      steps: 16,
      weave: 100,
      speed: 36,
      focusX: 0.82,
      focusY: 0.3,
    },
    motif: `  <circle cx="196" cy="120" r="96" fill="#38bdf8" opacity=".07"/>
  <circle cx="196" cy="120" r="58" fill="#38bdf8" opacity=".16"/>
  <g stroke="#38bdf8" stroke-width="3" fill="none" opacity=".5">
    <path d="M196 120 L92 70"/>
    <path d="M196 120 L92 182"/>
    <path d="M196 120 L330 62"/>
    <path d="M196 120 L330 186"/>
    <path d="M330 62 L470 104"/>
    <path d="M330 186 L470 104"/>
    <path d="M330 186 L474 196"/>
    <path d="M470 104 L616 66"/>
    <path d="M470 104 L474 196"/>
    <path d="M474 196 L616 66"/>
    <path d="M92 70 L92 182"/>
  </g>
  <g fill="#38bdf8">
    <circle cx="196" cy="120" r="26"/>
    <circle cx="92" cy="70" r="12"/>
    <circle cx="92" cy="182" r="12"/>
    <circle cx="330" cy="62" r="15"/>
    <circle cx="330" cy="186" r="15"/>
    <circle cx="470" cy="104" r="19"/>
    <circle cx="474" cy="196" r="11"/>
    <circle cx="616" cy="66" r="14"/>
  </g>
  <g fill="#7dd3fc" opacity=".55">
    <circle cx="646" cy="150" r="7"/>
    <circle cx="676" cy="112" r="5"/>
  </g>`,
  },
  {
    file: 'lattice-subgraph-wide',
    label: 'Standardised subgraphs across protocols',
    // Hub at top centre and chips along the bottom, so the core goes top left.
    quilt: {
      stops: ['#0e0a20', '#150f2e', '#201644', '#30225d', '#463184'],
      blocks: 8,
      steps: 16,
      weave: 100,
      speed: 36,
      focusX: 0.2,
      focusY: 0.26,
    },
    motif: `  <g stroke="#a78bfa" stroke-width="3" opacity=".4" fill="none">
    <path d="M360 92 L120 168"/><path d="M360 92 L240 168"/><path d="M360 92 L360 168"/>
    <path d="M360 92 L480 168"/><path d="M360 92 L600 168"/>
  </g>
  <rect x="286" y="60" width="148" height="34" rx="12" fill="#a78bfa"/>
  <g fill="#c4b5fd">
    <rect x="76" y="168" width="88" height="32" rx="10"/>
    <rect x="196" y="168" width="88" height="32" rx="10"/>
    <rect x="316" y="168" width="88" height="32" rx="10"/>
    <rect x="436" y="168" width="88" height="32" rx="10"/>
    <rect x="556" y="168" width="88" height="32" rx="10"/>
  </g>
  <g fill="#2a1d5c" opacity=".55">
    <rect x="92" y="180" width="56" height="8" rx="4"/>
    <rect x="212" y="180" width="56" height="8" rx="4"/>
    <rect x="332" y="180" width="56" height="8" rx="4"/>
    <rect x="452" y="180" width="56" height="8" rx="4"/>
    <rect x="572" y="180" width="56" height="8" rx="4"/>
  </g>`,
  },
  {
    file: 'meridian-deploy-wide',
    label: 'Container hosting with preview environments',
    // The bars climb the right half, so the core sits low and left of them.
    quilt: {
      stops: ['#03201d', '#042f2a', '#073e38', '#0a544c', '#0e7469'],
      blocks: 8,
      steps: 16,
      weave: 100,
      speed: 36,
      focusX: 0.26,
      focusY: 0.7,
    },
    motif: `  <path d="M64 66 L172 66 M64 98 L264 98" stroke="#5eead4" stroke-width="10" stroke-linecap="round" opacity=".75"/>
  <path d="M64 130 L136 130" stroke="#5eead4" stroke-width="10" stroke-linecap="round" opacity=".4"/>
  <g fill="#2dd4bf">
    <rect x="344" y="140" width="52" height="62" rx="10" opacity=".95"/>
    <rect x="412" y="116" width="52" height="86" rx="10" opacity=".8"/>
    <rect x="480" y="88" width="52" height="114" rx="10" opacity=".65"/>
    <rect x="548" y="62" width="52" height="140" rx="10" opacity=".5"/>
    <rect x="616" y="40" width="40" height="162" rx="10" opacity=".3"/>
  </g>
  <circle cx="112" cy="184" r="15" fill="#2dd4bf"/>
  <path d="M104 184 L110 191 L122 177" stroke="#042f2a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

const W = 720;
const H = 240;

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/*
 * Hex, not the `rgb()` the canvas path uses. Colour literals are most of these
 * files, and `#080d16` against `rgb(8,13,22)` is six bytes a cell across a
 * couple of hundred cells and six frames each.
 */
function cellHex(
  grid: ReturnType<typeof quiltGrid>,
  row: number,
  col: number,
  t: number,
  quilt: QuiltSettings,
) {
  const [r, g, b] = sampleRamp(quilt.stops, cellTone(grid, row, col, t, quilt));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function build({ file, label, motif, quilt }: Creative) {
  const grid = quiltGrid(W, H, quilt.blocks);
  const clocks = Array.from({ length: FRAMES }, (_, i) => CLOCK_BASE + (CLOCK_SPAN * i) / (FRAMES - 1));
  // A half-cycle in real seconds, at the quilt's own speed.
  const duration = round(CLOCK_SPAN / ((quilt.speed / 100) * 1.2));

  const rects: string[] = [];
  /** sequence -> the class name that animates it. */
  const sequences = new Map<string, string>();
  const keyframes: string[] = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const seq = clocks.map((t) => cellHex(grid, row, col, t, quilt));
      // Overdraw by a pixel, as the canvas does, so no hairline gaps open up
      // between cells when the banner is scaled to an odd width.
      const geom =
        `x="${round(col * grid.cw)}" y="${round(row * grid.ch)}"` +
        ` width="${round(grid.cw) + 1}" height="${round(grid.ch) + 1}"`;

      if (seq.every((c) => c === seq[0])) {
        rects.push(`<rect ${geom} fill="${seq[0]}"/>`);
        continue;
      }

      const key = seq.join('|');
      let cls = sequences.get(key);
      if (!cls) {
        cls = `q${sequences.size}`;
        sequences.set(key, cls);
        const steps = seq
          .map((c, i) => `${round((i / (seq.length - 1)) * 100)}%{fill:${c}}`)
          .join('');
        keyframes.push(`@keyframes ${cls}{${steps}}`);
      }
      rects.push(`<rect ${geom} fill="${seq[0]}" class="q ${cls}"/>`);
    }
  }

  const seam = round(seamWidth(grid));
  const seams: string[] = [];
  for (let col = 1; col < grid.cols; col++) {
    const x = Math.round(col * grid.cw);
    seams.push(`<rect x="${round(x - seam)}" y="0" width="${seam}" height="${H}" fill="${SEAM_LIGHT}"/>`);
    seams.push(`<rect x="${x}" y="0" width="${seam}" height="${H}" fill="${seamDark(quilt.stops)}"/>`);
  }
  for (let row = 1; row < grid.rows; row++) {
    const y = Math.round(row * grid.ch);
    seams.push(`<rect x="0" y="${round(y - seam)}" width="${W}" height="${seam}" fill="${SEAM_LIGHT}"/>`);
    seams.push(`<rect x="0" y="${y}" width="${W}" height="${seam}" fill="${seamDark(quilt.stops)}"/>`);
  }

  const css = [
    `.q{animation-duration:${duration}s;animation-iteration-count:infinite;`,
    `animation-direction:alternate;animation-timing-function:ease-in-out}`,
    ...Array.from(sequences.values(), (cls) => `.${cls}{animation-name:${cls}}`),
    keyframes.join(''),
    // Every cell already carries its first frame as a plain fill, so switching
    // the animation off leaves the correct still rather than an empty box.
    '@media(prefers-reduced-motion:reduce){.q{animation:none}}',
  ].join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
  <style>${css}</style>
  <g>${rects.join('')}</g>
  <g>${seams.join('')}</g>
${motif}
</svg>
`;

  const path = join(OUT, `${file}.svg`);
  writeFileSync(path, svg);
  const animated = rects.filter((r) => r.includes('class=')).length;
  console.log(
    `${file}.svg  ${(svg.length / 1024).toFixed(1)}kB  ` +
      `${grid.cols}x${grid.rows} cells, ${animated} animated, ${sequences.size} keyframes`,
  );
}

for (const creative of CREATIVES) build(creative);
