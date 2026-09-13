/**
 * How a creative's artwork sits in the sponsored card's thumbnail.
 *
 * A campaign carries one `imageUrl`, and the card always draws it in the same
 * place: a 76px square beside the copy. The card never reshapes itself around
 * the artwork. A creative that spans the full width of the panel reads as a
 * display ad dropped into an editor, and the slot's whole argument is that it
 * is the size of a chat message rather than the size of a billboard.
 *
 * What the artwork's proportions still decide is how it is fitted into that
 * square, because the square is fixed and the artwork is not. Near-square art
 * fills it and is cropped a little at the edges; anything longer than that is
 * letterboxed whole, so a wide wordmark keeps both of its ends. The advertiser
 * is not asked to declare which — a declared shape is a promise about a file
 * they can swap at any time, and the pixels cannot lie about their own shape.
 *
 * Both renderers — `apps/vscode-extension/webview/AdCard.tsx` and the
 * advertiser-facing `apps/web/src/components/app/sponsored-preview.tsx` —
 * import this, so the preview cannot promise a framing the editor would not
 * draw.
 */

/**
 * How far from square artwork may be and still be cropped to fill the slot.
 *
 * At 1.25 the crop takes a fifth off the long side, which is the margin most
 * logo art carries anyway. Past it the loss starts eating content — the point
 * where a 2:1 wordmark would lose half of itself — so the artwork is
 * letterboxed instead.
 */
export const SQUARE_FIT_MAX_ASPECT = 1.25;

export type CreativeImageFit = 'cover' | 'contain';

/**
 * Decided from an image's `naturalWidth`/`naturalHeight` once it has loaded.
 *
 * Unmeasurable artwork gets `contain`, which is the lossless answer: showing
 * all of an image in the wrong proportions is recoverable, cropping away a
 * brand's name is not.
 */
export function creativeImageFit(naturalWidth: number, naturalHeight: number): CreativeImageFit {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 'contain';
  const longest = Math.max(naturalWidth, naturalHeight);
  const shortest = Math.min(naturalWidth, naturalHeight);
  return longest / shortest <= SQUARE_FIT_MAX_ASPECT ? 'cover' : 'contain';
}

/**
 * Whether a string is something the card could draw as artwork.
 *
 * Two forms are accepted, and the distinction matters more than it looks. An
 * absolute `http(s)` URL is artwork the advertiser hosts themselves. A
 * root-relative path is artwork *we* host, and it stays relative in the
 * database on purpose: an advertiser writing a campaign against localhost and
 * an advertiser writing one against production are describing the same file,
 * and baking whichever origin their browser happened to be on into a stored
 * row is how a creative ends up pointing at a machine nobody else can reach.
 */
export function isCreativeImageRef(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Turns a stored image reference into something a client can actually fetch.
 *
 * Called at delivery rather than at authoring, so a relative creative follows
 * whichever origin is serving it. Anything unparseable resolves to null: a card
 * with no artwork draws the advertiser's monogram, which is a better outcome
 * than an image element that hangs.
 */
export function resolveCreativeImageUrl(
  value: string | null | undefined,
  origin: string,
): string | null {
  if (!value) return null;
  try {
    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}
