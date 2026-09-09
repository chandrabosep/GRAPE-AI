import { useEffect, useRef, useState } from 'react';
import type { SponsoredAd } from '@aam/shared';

/**
 * The sponsored card.
 *
 * Two rules are enforced here rather than left to styling. The SPONSORED label
 * cannot be dismissed, and the card is never rendered inside an assistant
 * message. It is a sibling of the answer, because the moment an ad can be
 * mistaken for a recommendation the product has broken its promise.
 *
 * The dwell timer is what turns attention into money. The card must be genuinely
 * on screen for a full second before it is acknowledged, so scrolling past
 * earns nothing.
 */

const DWELL_MS = 1000;

interface Props {
  ad: SponsoredAd;
  rewardMicro: number | null;
  onVisible: (impressionId: string, visibleMs: number) => void;
  onClick: (impressionId: string, url: string) => void;
  onDismiss: (impressionId: string) => void;
}

export function AdCard({ ad, rewardMicro, onVisible, onClick, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const acknowledged = useRef(false);
  const [showReasons, setShowReasons] = useState(false);

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
      { threshold: 0.6 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ad.impressionId, onVisible]);

  return (
    <div className="ad" ref={ref}>
      <div className="ad-label">
        <span>Sponsored · relevant to your task</span>
        <button
          className="link"
          onClick={() => onDismiss(ad.impressionId)}
          aria-label="Dismiss sponsored content"
        >
          Dismiss
        </button>
      </div>

      <div className="ad-headline">{ad.headline}</div>
      <div className="ad-body">{ad.body}</div>

      <div className="ad-actions">
        <button onClick={() => onClick(ad.impressionId, ad.ctaUrl)}>{ad.ctaText} →</button>
        <button className="link" onClick={() => setShowReasons((open) => !open)}>
          {showReasons ? 'Hide' : 'Why this ad?'}
        </button>
        {rewardMicro !== null && rewardMicro > 0 && (
          <span className="reward">+${(rewardMicro / 1_000_000).toFixed(4)} credits</span>
        )}
      </div>

      {showReasons && (
        <div className="ad-reasons">
          <div style={{ marginBottom: 6 }}>
            {ad.advertiserName} targeted these signals derived from your question:
          </div>
          {ad.reasons.map((reason) => (
            <span className="tag" key={reason}>
              {reason.replace(/_/g, ' ')}
            </span>
          ))}
          <div style={{ marginTop: 6 }}>
            Your prompt, your code and your identity were not shared.
          </div>
        </div>
      )}
    </div>
  );
}
