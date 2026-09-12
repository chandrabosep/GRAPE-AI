import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  bannerAspectRatio,
  creativeImageLayout,
  type CreativeImageLayout,
  type SponsoredAd,
} from '@aam/shared';

/**
 * The sponsored card.
 *
 * Three rules are enforced here rather than left to styling. The card is a
 * sibling of the answer and never lives inside an assistant message, the `Ad`
 * badge and advertiser name cannot be dismissed, and the whole thing sits below
 * a rule that separates it from anything the model wrote. The moment an ad can
 * be mistaken for a recommendation the product has broken its promise.
 *
 * The dwell timer is what turns attention into money. The card must be
 * genuinely on screen for a full second before it is acknowledged, so scrolling
 * past earns nothing.
 *
 * Artwork comes in two shapes and the card sorts them out itself: a wide
 * creative is drawn as a banner across the top, anything squarer stays the
 * thumbnail beside the copy. See `creativeImageLayout` for why the image is
 * asked rather than the advertiser.
 */

const DWELL_MS = 1000;

interface Props {
  ad: SponsoredAd;
  rewardMicro: number | null;
  onVisible: (impressionId: string, visibleMs: number) => void;
  /**
   * This card came back from a saved conversation, so its impression was
   * already reported when it was first shown. Without this the observer fires
   * again on every reopen and re-acknowledges attention from days ago.
   */
  alreadyAcknowledged?: boolean;
  onClick: (impressionId: string, url: string) => void;
  onDismiss: (impressionId: string) => void;
}

/** Advertiser mark. A monogram, because no advertiser logo is uploaded yet. */
function AdvertiserMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

  return <span className="ad-avatar">{initials}</span>;
}

export function AdCard({
  ad,
  rewardMicro,
  onVisible,
  onClick,
  onDismiss,
  alreadyAcknowledged,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const acknowledged = useRef(alreadyAcknowledged === true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  /**
   * Null until the artwork has loaded and reported its own proportions. The
   * slot stays out of the layout until then: reserving a 76px square and then
   * growing it into a full-width banner is a visible lurch in a card that has
   * only just animated in.
   */
  const [artwork, setArtwork] = useState<{
    layout: CreativeImageLayout;
    aspect: number;
  } | null>(null);

  // A reused instance must not keep the previous creative's measurements.
  useEffect(() => {
    setArtwork(null);
    setImageFailed(false);
  }, [ad.imageUrl]);

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

  // Clicking anywhere outside closes the menu, including elsewhere in the chat.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const measure = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setArtwork({
      layout: creativeImageLayout(naturalWidth, naturalHeight),
      aspect: bannerAspectRatio(naturalWidth, naturalHeight),
    });
  };

  const showImage = Boolean(ad.imageUrl) && !imageFailed;
  const isBanner = showImage && artwork?.layout === 'banner';

  return (
    <div className="ad-slot" ref={ref}>
      <div className="ad-rule" />

      <div className={isBanner ? 'ad-card ad-card-banner' : 'ad-card'}>
        {showImage ? (
          <div
            className={`ad-media ad-media-${artwork?.layout ?? 'pending'}`}
            style={isBanner ? { aspectRatio: String(artwork?.aspect) } : undefined}
          >
            <img
              src={ad.imageUrl ?? ''}
              alt=""
              onLoad={measure}
              onError={() => setImageFailed(true)}
              onClick={() => onClick(ad.impressionId, ad.ctaUrl)}
            />
          </div>
        ) : (
          <div className="ad-media ad-media-thumbnail">
            <div className="ad-media-fallback" onClick={() => onClick(ad.impressionId, ad.ctaUrl)}>
              <AdvertiserMark name={ad.advertiserName} />
            </div>
          </div>
        )}

        <div className="ad-content">
          <div className="ad-meta">
            <AdvertiserMark name={ad.advertiserName} />
            <span className="ad-advertiser">{ad.advertiserName}</span>
            {/* Non-removable, and never rendered as anything softer than "Ad". */}
            <span className="ad-badge">Ad</span>

            <button
              className="ad-menu-button"
              aria-label="Sponsored content options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              •••
            </button>

            {menuOpen && (
              <div className="ad-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowReasons((open) => !open);
                    setMenuOpen(false);
                  }}
                >
                  Why this ad?
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    onDismiss(ad.impressionId);
                    setMenuOpen(false);
                  }}
                >
                  Hide this ad
                </button>
              </div>
            )}
          </div>

          <button
            className="ad-headline"
            onClick={() => onClick(ad.impressionId, ad.ctaUrl)}
            title={ad.ctaUrl}
          >
            {ad.headline}
          </button>

          <div className="ad-body">{ad.body}</div>

          <div className="ad-foot">
            <button className="ad-cta" onClick={() => onClick(ad.impressionId, ad.ctaUrl)}>
              {ad.ctaText} →
            </button>
            {rewardMicro !== null && rewardMicro > 0 && (
              <span className="ad-reward">
                +${(rewardMicro / 1_000_000).toFixed(4)} credits earned
              </span>
            )}
          </div>
        </div>
      </div>

      {showReasons && (
        <div className="ad-reasons">
          <div className="ad-reasons-title">
            {ad.advertiserName} bid on these signals derived from your question:
          </div>
          <div>
            {ad.reasons.map((reason) => (
              <span className="tag" key={reason}>
                {reason.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <div className="ad-reasons-note">
            Your prompt, your code and your identity were not shared with the advertiser.
          </div>
          <button className="ghost" onClick={() => setShowReasons(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
