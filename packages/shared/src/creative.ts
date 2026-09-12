/**
 * Where a creative's artwork sits on the sponsored card.
 *
 * A campaign carries one `imageUrl`, and the card works out from the artwork's
 * own proportions how to show it: art drawn as a wide strip becomes a banner
 * across the top of the card, and anything squarer stays the small thumbnail
 * beside the copy. The advertiser is not asked to declare a layout, because a
 * declared layout is a promise about a file they can swap at any time — the
 * pixels cannot lie about their own shape, so the pixels decide.
 *
 * Both renderers — `apps/vscode-extension/webview/AdCard.tsx` and the
 * advertiser-facing `apps/web/src/components/app/sponsored-preview.tsx` —
 * import this, so the preview cannot promise a banner the editor would draw as
 * a thumbnail.
 */

/** At least twice as wide as it is tall was drawn as a banner. */
export const BANNER_MIN_ASPECT = 2;

/**
 * The widest the banner is drawn. Past this the artwork is cropped at the
 * sides instead of being allowed to become a letterbox sliver, which keeps one
 * unusually long creative from deciding how tall every card is.
 */
export const BANNER_MAX_ASPECT = 4;

export type CreativeImageLayout = 'thumbnail' | 'banner';

/** Decided from an image's `naturalWidth`/`naturalHeight` once it has loaded. */
export function creativeImageLayout(
  naturalWidth: number,
  naturalHeight: number,
): CreativeImageLayout {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 'thumbnail';
  return naturalWidth / naturalHeight >= BANNER_MIN_ASPECT ? 'banner' : 'thumbnail';
}

/**
 * The aspect the banner slot is drawn at: the artwork's own, clamped. Applied
 * to the slot rather than the image so the image can `object-fit: cover` into
 * it, which crops only in the clamped case and leaves every ordinary banner
 * uncropped.
 */
export function bannerAspectRatio(naturalWidth: number, naturalHeight: number): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return BANNER_MIN_ASPECT;
  const aspect = naturalWidth / naturalHeight;
  return Math.min(Math.max(aspect, BANNER_MIN_ASPECT), BANNER_MAX_ASPECT);
}
