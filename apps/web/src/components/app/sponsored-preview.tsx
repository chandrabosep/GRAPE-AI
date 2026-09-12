/**
 * The sponsored card as the developer actually sees it in VS Code.
 *
 * It exists so an advertiser is never shown a flattering mock-up: the structure
 * here — separator, thumbnail, advertiser name, permanent `Ad` badge, headline,
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
 */

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

  return (
    <div className="max-w-md space-y-3">
      <div className="bg-hairline h-px" />

      <div className="border-hairline bg-wash flex items-start gap-3 rounded-[10.8px] border p-3">
        <div className="bg-wash-strong flex size-19 shrink-0 items-center justify-center overflow-hidden rounded-lg">
          {imageUrl ? (
            // Creative artwork is advertiser-supplied, so it stays a plain img
            // rather than going through the image optimiser.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="bg-wash-strong text-steel flex size-8 items-center justify-center rounded-full text-[11px]">
              {mark}
            </span>
          )}
        </div>

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
