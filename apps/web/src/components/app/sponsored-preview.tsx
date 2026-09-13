'use client';

import { useEffect, useRef, useState } from 'react';
import { creativeImageFit, type CreativeImageFit } from '@aam/shared';

/**
 * The sponsored card as the developer actually sees it in VS Code.
 *
 * It exists so an advertiser is never shown a flattering mock-up: the structure
 * here — separator, artwork, advertiser name, permanent `Ad` badge, headline,
 * body, call to action — mirrors `apps/vscode-extension/webview/AdCard.tsx`. If
 * one changes, the other should change with it, because a preview that lies is
 * worse than no preview.
 *
 * What is mirrored is the structure and the proportions, not the palette. The
 * real card is painted in the developer's own editor theme, so it is a
 * different colour for every reader; there is no honest way to preview that,
 * and pretending otherwise by picking one theme would be its own kind of lie.
 * What the advertiser needs from this is how little room their copy gets and
 * what sits in front of it, and both survive the recolouring.
 *
 * The artwork framing is not mirrored by hand either: the same
 * `creativeImageFit` the card uses decides here whether the image they pasted
 * fills the square or is letterboxed into it, so the preview cannot promise a
 * framing the editor would not draw.
 */

/**
 * Mirrors `ARTWORK_TIMEOUT_MS` in the card. An image that neither loads nor
 * errors would otherwise leave the slot hidden forever, and the preview would
 * quietly disagree with the editor about whether the artwork works at all.
 */
const ARTWORK_TIMEOUT_MS = 4000;

interface Props {
  headline: string;
  body: string;
  ctaText: string;
  imageUrl?: string | null;
  advertiserName: string;
  /** Set once the card has been shown; the extension shows what was earned. */
  rewardMicro?: number | null;
}

function monogram(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export function SponsoredPreview({
  headline,
  body,
  ctaText,
  imageUrl,
  advertiserName,
  rewardMicro,
}: Props) {
  const mark = monogram(advertiserName || 'Advertiser');

  const [fit, setFit] = useState<CreativeImageFit | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  /** Set the moment the artwork reports dimensions, so the timeout can stand down. */
  const measured = useRef(false);

  // The advertiser is typing this URL, so every keystroke is a different image.
  useEffect(() => {
    measured.current = false;
    setFit(null);
    setImageFailed(false);
    if (!imageUrl) return;

    const timer = setTimeout(() => {
      if (!measured.current) setImageFailed(true);
    }, ARTWORK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [imageUrl]);

  const measure = (image: HTMLImageElement) => {
    measured.current = true;
    setFit(creativeImageFit(image.naturalWidth, image.naturalHeight));
  };

  /**
   * Measures artwork the browser had already finished with.
   *
   * `onLoad` only fires for a load React was attached in time to see, and a
   * cached image is already `complete` when the element mounts — so re-showing
   * a URL that has been rendered once leaves the slot pending forever, and
   * pending is hidden. A ref callback is the only place that finished state is
   * still observable.
   */
  const attachImage = (image: HTMLImageElement | null) => {
    if (!image || measured.current) return;
    // `complete` is true for a failed load too; naturalWidth separates the two.
    if (!image.complete) return;
    if (image.naturalWidth > 0) measure(image);
    else setImageFailed(true);
  };

  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div className="max-w-md space-y-3">
      <div className="bg-hairline h-px" />

      <div className="border-hairline bg-wash flex items-start gap-3 rounded-[10.8px] border p-3">
        {showImage ? (
          // Kept out of the layout until the image has reported its
          // proportions, so artwork does not snap from cropped to letterboxed
          // the moment it is measured.
          <div
            className={`bg-wash-strong size-19 shrink-0 overflow-hidden rounded-lg ${
              fit ? '' : 'hidden'
            }`}
          >
            {/* Creative artwork is advertiser-supplied, so it stays a plain img
                rather than going through the image optimiser. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={attachImage}
              src={imageUrl ?? ''}
              alt=""
              onLoad={(event) => measure(event.currentTarget)}
              onError={() => setImageFailed(true)}
              className={
                fit === 'contain' ? 'size-full object-contain p-2' : 'size-full object-cover'
              }
            />
          </div>
        ) : (
          <div className="bg-wash-strong flex size-19 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <span className="bg-wash-strong text-steel flex size-8 items-center justify-center rounded-full text-[11px]">
              {mark}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="bg-wash-strong text-steel flex size-4.5 items-center justify-center rounded-full text-[9px]">
              {mark}
            </span>
            <span className="text-almost-white truncate text-xs">
              {advertiserName || 'Your company'}
            </span>
            <span className="border-hairline-strong text-steel rounded border px-1.5 py-0.5 text-[10px] leading-none">
              Ad
            </span>
            <span className="text-graphite ml-auto text-[11px] tracking-wider">•••</span>
          </div>

          <div className="text-almost-white text-[13px] leading-snug font-medium">
            {headline || 'Your headline'}
          </div>
          <div className="text-steel text-xs leading-relaxed">{body || 'Your body copy.'}</div>

          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            <span className="text-lavender-mist text-xs">{ctaText || 'Learn more'} →</span>
            {rewardMicro ? (
              <span className="text-signal-violet text-[11px] tabular-nums">
                +${(rewardMicro / 1_000_000).toFixed(4)} credits earned
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface InlineProps {
  headline: string;
  ctaText: string;
  advertiserName: string;
}

/**
 * The single-line sponsored slot, as it appears while an answer streams.
 *
 * Mirrors `apps/vscode-extension/webview/InlineAd.tsx` for the same reason the
 * card preview mirrors the card: an advertiser writing one line needs to see
 * how little room it actually gets, including the marker and the `Ad` badge
 * that sit in front of their copy and are not theirs to remove.
 */
export function InlineSponsoredPreview({ headline, ctaText, advertiserName }: InlineProps) {
  return (
    <div className="max-w-md space-y-2">
      {/* The thinking indicator is shown too: the line's whole argument is that
          it occupies time the developer was already spending waiting. */}
      <div className="text-graphite text-[13px] italic">Thinking…</div>

      <div className="flex items-center gap-2 rounded-md py-1">
        <span aria-hidden="true" className="bg-signal-violet h-4 w-0.5 shrink-0 rounded-full" />
        <span className="border-signal-violet/45 text-lavender-mist shrink-0 rounded border px-1.5 py-px text-[9px] tracking-wider uppercase">
          Ad
        </span>
        <span className="text-steel min-w-0 truncate text-[13px]">
          {headline || 'Your one-line message'}
        </span>
        <span className="text-lavender-mist shrink-0 text-xs">{ctaText || 'Learn more'} →</span>
      </div>

      <div className="text-graphite text-[11px]">
        Shown as {advertiserName || 'your company'} · links to your destination
      </div>
    </div>
  );
}
