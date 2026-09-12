import { useEffect, useRef, useState } from 'react';
import type { SponsoredAd } from '@aam/shared';

/**
 * The single-line sponsored slot.
 *
 * Shown at the tail of the answer while it is still streaming, in the spot the
 * blinking caret would otherwise occupy — the moment the developer is waiting
 * and has nothing to read, at the one point on screen they are already looking
 * at. That is the whole reason this format exists: it fills dead time instead
 * of competing with a finished answer for attention.
 *
 * Standing in for the caret means it also has to carry what the caret was
 * saying: while `streaming` the marker keeps the same blink, so the line reads
 * as "still writing" and not as the answer having stopped early.
 *
 * It is still an ad, and is labelled like one. The `Ad` badge is permanent, the
 * advertiser is named, and the line sits on its own row with a marker that
 * visually separates it from the answer above it. What changes relative to the
 * banner is how much room it takes, never how honestly it is presented.
 *
 * The same dwell rule applies: a full second genuinely on screen before the
 * impression is acknowledged, so an ad that flashes past during a fast answer
 * earns nothing.
 */

const DWELL_MS = 1000;

interface Props {
  ad: SponsoredAd;
  onVisible: (impressionId: string, visibleMs: number) => void;
  /**
   * This card came back from a saved conversation, so its impression was
   * already reported when it was first shown. Without this the observer fires
   * again on every reopen and re-acknowledges attention from days ago.
   */
  alreadyAcknowledged?: boolean;
  onClick: (impressionId: string, url: string) => void;
  onDismiss: (impressionId: string) => void;
  /**
   * The answer is still being written, so this line is standing in for the
   * caret and blinks like it. False once the turn is done and the line is only
   * still here because no banner was won.
   */
  streaming?: boolean;
}

export function InlineAd({
  ad,
  onVisible,
  onClick,
  onDismiss,
  alreadyAcknowledged,
  streaming,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const acknowledged = useRef(alreadyAcknowledged === true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !acknowledged.current) {
          timer = setTimeout(() => {
            acknowledged.current = true;
            onVisible(ad.impressionId, DWELL_MS);
          }, DWELL_MS);
        } else if (timer) {
          // Scrolled away before the dwell completed: no reward.
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.9 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ad.impressionId, onVisible]);

  return (
    <div
      className={`inline-ad${streaming ? ' streaming' : ''}${dismissing ? ' leaving' : ''}`}
      ref={ref}
    >
      <span className="inline-ad-marker" aria-hidden="true" />

      <span className="inline-ad-badge">Ad</span>

      <button
        className="inline-ad-text"
        onClick={() => onClick(ad.impressionId, ad.ctaUrl)}
        title={`${ad.advertiserName} — ${ad.ctaUrl}`}
      >
        {ad.headline}
        <span className="inline-ad-cta">{ad.ctaText} →</span>
      </button>

      <button
        className="inline-ad-dismiss"
        aria-label={`Hide this sponsored line from ${ad.advertiserName}`}
        onClick={() => {
          setDismissing(true);
          // Let the line fade before it is pulled, so it does not simply vanish
          // and leave the answer jumping up the panel.
          setTimeout(() => onDismiss(ad.impressionId), 140);
        }}
      >
        ✕
      </button>
    </div>
  );
}
