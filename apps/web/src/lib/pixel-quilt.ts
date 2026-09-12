/**
 * The pixel quilt.
 *
 * A port of the PIXEL / "quilt" generator from feralui.dev/gradients, which is
 * where this hero's look was chosen. Everything here is deliberately pure and
 * DOM-free so the same code paints the animated canvas in the browser and the
 * static SVG poster at build time — the poster has to be pixel-identical to the
 * canvas's first frame, or the hero visibly jumps when the canvas takes over.
 *
 * The idea of the thing: quantise a soft radial falloff into a handful of flat
 * tones, then lay those tones out on a coarse grid of square cells. Because the
 * falloff is measured with a Chebyshev (max) distance rather than a Euclidean
 * one, the bands come out as nested rectangles instead of circles, and a small
 * shear plus a per-cell hash keeps them from reading as concentric boxes. The
 * result terraces like a quilt rather than blurring like a mesh gradient.
 *
 * The magic numbers are the source's, kept as named constants rather than
 * inlined so the shape of the maths stays readable. Don't tune them piecemeal:
 * they are balanced against each other, and the ones that matter for art
 * direction (blocks, steps, weave, focus) are already exposed as settings.
 */

/* --- the source's constants ---------------------------------------------- */

const RADIUS_X = 0.86; // half-width of the falloff, in grid space
const RADIUS_Y = 0.64; // and its half-height — wider than tall, so bands are landscape
const SHEAR = 0.14; // leans the bands, so they don't read as concentric boxes
const RAMP_MIX = 0.22; // how much of a plain left-to-right ramp is mixed into the falloff
const JITTER_AMP = 0.09; // per-cell tone wobble, scaled by weave below the knee
const WEAVE_KNEE = 30; // weave up to here wobbles tone; past here it starts jumping whole steps
const BUMP_SCALE = 0.5; // at weave 100, half the cells jump a step
const BREATH_AMP = 0.032;
const BREATH_FREQ = 2.4;
const SHIMMER_AMP = 0.018;
const SHIMMER_FREQ = 1.1;
const SEAM_WIDTH_FACTOR = 0.014;
const SEAM_LIGHT_ALPHA = 0.12;
const SEAM_DARK_ALPHA = 0.075;

/** The clock the source starts every gradient at. Frame zero is not t=0. */
export const CLOCK_BASE = 20.75;
/** Clock units per second at speed 100. */
const CLOCK_RATE = 1.2;

export function clockAdvance(speed: number, elapsedSeconds: number) {
  // The source clamps each step to 50ms so a backgrounded tab that wakes up
  // after ten seconds resumes rather than teleporting.
  return (speed / 100) * CLOCK_RATE * Math.min(0.05, elapsedSeconds);
}

/* --- settings ------------------------------------------------------------ */

export interface QuiltSettings {
  /** Darkest first. Position is the midpoint of each stop's band. */
  stops: readonly string[];
  /** The BLOCKS control, 8–18: cells across the short edge. */
  blocks: number;
  /** The STEPS control, 2–16: how many flat tones the ramp is quantised to. */
  steps: number;
  /** The WEAVE control, 0–100: tone wobble, then whole-step jumps past 30. */
  weave: number;
  /** The SPEED control, 0–100. */
  speed: number;
  /** Where the hot core sits, in 0–1 of the canvas. */
  focusX: number;
  focusY: number;
}

/**
 * The hero's setting.
 *
 * feralui's own controls, at the values the look was picked at — blocks 18,
 * steps 16, weave 100, speed 36 — with two deliberate departures.
 *
 * The palette is ours, not theirs. Their "Pixel wisteria" ramps violet up to a
 * near-white, which on this site would put a light fill behind the hero copy;
 * the system's rule is that atmosphere is only ever a wash. So the ramp runs
 * from the void itself through the two cosmic tones and tops out at
 * signal-violet, which keeps the brightest thing on the page the same violet
 * that is rationed everywhere else.
 *
 * And the focus moves. Theirs sits at (0.82, 0.52), which is exactly where the
 * boarding pass lands — a hot core behind frosted glass with white type on it.
 * Lifting it to (0.84, 0.12) puts the dawn in the top-right sky, leaves the
 * pass over the mid-violet band where white still holds, and leaves the whole
 * bottom-left quadrant at void black, which is where the headline sits.
 */
export const HERO_QUILT: QuiltSettings = {
  stops: ['#090909', '#2A0F45', '#401860', '#6C4BD6', '#AF50FF'],
  blocks: 18,
  steps: 16,
  weave: 100,
  speed: 36,
  focusX: 0.84,
  focusY: 0.12,
};

/* --- grid ---------------------------------------------------------------- */

export interface QuiltGrid {
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

/** Square cells sized off the short edge, so the grid never stretches. */
export function quiltGrid(width: number, height: number, blocks: number): QuiltGrid {
  const cell = Math.min(width, height) / blocks;
  const cols = Math.max(4, Math.round(width / cell));
  const rows = Math.max(4, Math.round(height / cell));
  return { cols, rows, cw: width / cols, ch: height / rows };
}

/** The seam between cells, in px. Never thinner than a hairline. */
export function seamWidth(grid: QuiltGrid) {
  return Math.max(0.65, Math.min(grid.cw, grid.ch) * SEAM_WIDTH_FACTOR);
}

export const SEAM_LIGHT = `rgba(255,255,255,${SEAM_LIGHT_ALPHA})`;
export function seamDark(stops: readonly string[]) {
  const [r, g, b] = sampleRamp(stops, 0);
  return `rgba(${r},${g},${b},${SEAM_DARK_ALPHA})`;
}

/* --- colour, in OKLab ---------------------------------------------------- */

/*
 * The ramp is interpolated in OKLab rather than sRGB. It matters more here than
 * it usually does: quantising to flat steps means every interpolation artefact
 * becomes a visible band edge, and an sRGB blend from near-black to violet
 * detours through a muddy grey-purple that shows up as one dead tone in the
 * middle of the ramp.
 */

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function srgbToLinear(channel: number) {
  const u = channel / 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function toOklab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((d) => {
    const v = d <= 0.0031308 ? d * 12.92 : 1.055 * Math.pow(Math.max(0, d), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(v * 255)));
  }) as Rgb;
}

/** Each stop owns a band; its position is that band's midpoint. */
function stopPositions(count: number) {
  if (count <= 1) return [0.5];
  const edges = [0, ...Array.from({ length: count - 1 }, (_, i) => (i + 1) / count), 1];
  return Array.from({ length: count }, (_, i) => (edges[i] + edges[i + 1]) / 2);
}

export function sampleRamp(stops: readonly string[], x: number): Rgb {
  const pos = stopPositions(stops.length);
  if (x <= pos[0]) return hexToRgb(stops[0]);
  if (x >= pos[pos.length - 1]) return hexToRgb(stops[stops.length - 1]);
  for (let i = 0; i < pos.length - 1; i++) {
    if (x >= pos[i] && x <= pos[i + 1]) {
      const t = (x - pos[i]) / Math.max(1e-6, pos[i + 1] - pos[i]);
      const a = toOklab(stops[i]);
      const b = toOklab(stops[i + 1]);
      return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return hexToRgb(stops[stops.length - 1]);
}

/* --- the cell ------------------------------------------------------------ */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The source's hash. Deterministic per cell, so server and client agree. */
function hash(a: number, b: number) {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * The tone of one cell, 0–1, as a position along the ramp.
 *
 * Reads as: measure how far the cell is from the focus, quantise that to
 * `steps` flat tones, then let weave knock some cells off their step.
 */
export function cellTone(grid: QuiltGrid, row: number, col: number, t: number, s: QuiltSettings) {
  const steps = Math.max(2, Math.round(s.steps));
  const u = (col + 0.5) / grid.cols;
  const v = (row + 0.5) / grid.rows;

  // The focus drifts, and the whole falloff breathes. Both are tiny — this is
  // what keeps the quilt from looking like a still image with noise on top.
  const fx = s.focusX + 0.014 * Math.sin(t * 0.72);
  const fy = s.focusY + 0.01 * Math.cos(t * 0.58);
  const breath = 1 + BREATH_AMP * Math.sin(t * BREATH_FREQ);

  const sheared = u + (v - fy) * SHEAR + 0.028 * Math.sin(v * Math.PI * 1.15 + 0.35);
  const dx = Math.abs(sheared - fx) / (RADIUS_X * breath);
  const dy = Math.abs(v - fy) / (RADIUS_Y * breath);

  // Chebyshev, not Euclidean — this is what makes the bands rectangular.
  const core = 1 - clamp01(Math.max(dx, dy));
  const ramp = clamp01(u * 0.86 + (1 - Math.abs(v - fy) * 2) * 0.14);
  const mix = clamp01(core * (1 - RAMP_MIX) + ramp * RAMP_MIX);

  const h = hash(row, col);
  let step = Math.round(mix * steps);

  // Past the knee, weave stops wobbling tone and starts throwing whole cells a
  // step out of line. That scatter is the difference between a smooth terrace
  // and something that reads as stitched.
  const bump = (Math.max(0, s.weave - WEAVE_KNEE) / (100 - WEAVE_KNEE)) * BUMP_SCALE;
  if (bump > 0) {
    const j = hash(row * 3 + 17, col * 7 + 5);
    if (j < bump) step += j < bump / 2 ? -1 : 1;
  }

  const jitter = (h - 0.5) * JITTER_AMP * (Math.min(s.weave, WEAVE_KNEE) / 100);
  const shimmer = SHIMMER_AMP * Math.sin(t * SHIMMER_FREQ + h * Math.PI * 2);
  return clamp01(step / steps + jitter + shimmer);
}

export function cellColor(grid: QuiltGrid, row: number, col: number, t: number, s: QuiltSettings) {
  const [r, g, b] = sampleRamp(s.stops, cellTone(grid, row, col, t, s));
  return `rgb(${r},${g},${b})`;
}

/* --- painting ------------------------------------------------------------ */

/**
 * Paint one frame. Cells first, then the seams in two passes: a light stroke on
 * the near side of every gridline and a dark one on the far side. That pairing
 * is what gives each cell a lit edge and a shadowed edge, so the grid reads as
 * woven cloth rather than as a wireframe drawn over a gradient.
 */
export function paintQuilt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  s: QuiltSettings,
) {
  const grid = quiltGrid(width, height, s.blocks);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      ctx.fillStyle = cellColor(grid, row, col, t, s);
      // Cells are over-drawn by a pixel: at fractional cell sizes, flooring the
      // origin and ceiling the size is what stops hairline gaps appearing
      // between them on non-integer device pixel ratios.
      ctx.fillRect(
        Math.floor(col * grid.cw),
        Math.floor(row * grid.ch),
        Math.ceil(grid.cw) + 1,
        Math.ceil(grid.ch) + 1,
      );
    }
  }

  const seam = seamWidth(grid);

  ctx.fillStyle = SEAM_LIGHT;
  for (let col = 1; col < grid.cols; col++) ctx.fillRect(Math.round(col * grid.cw) - seam, 0, seam, height);
  for (let row = 1; row < grid.rows; row++) ctx.fillRect(0, Math.round(row * grid.ch) - seam, width, seam);

  ctx.fillStyle = seamDark(s.stops);
  for (let col = 1; col < grid.cols; col++) ctx.fillRect(Math.round(col * grid.cw), 0, seam, height);
  for (let row = 1; row < grid.rows; row++) ctx.fillRect(0, Math.round(row * grid.ch), width, seam);
}
