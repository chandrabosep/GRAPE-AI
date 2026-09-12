import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Numbers, in a seamless hairline grid.
 *
 * The previous version of this was four separate cards with gaps between them,
 * which is the shape every dashboard defaults to and the one thing this design
 * system rules out — it is shadowless and borderless, and a row of bordered
 * boxes reads as four objects rather than one instrument.
 *
 * So the tiles share their strokes. `.frame` paints a hairline background and
 * lets a 1px grid gap show through as the interior rules, and the tiles paint
 * the canvas back over everything else. The result is one panel with four
 * readings, which is what it actually is.
 *
 * Figures are tabular so a balance that changes does not shift the label
 * beneath it, and the hint carries the meaning the number cannot.
 */
export function MetricGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  /** Desktop column count. Tiles always stack to one column on a phone. */
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'frame grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'lg:grid-cols-3',
        columns === 4 && 'lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  accent = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /**
   * Marks the one figure in a panel that is the answer to the question the
   * panel was opened to ask — the earnings, the payout. It gets the violet,
   * and because a panel has at most one of these the ration holds.
   */
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5 p-5 md:p-6">
      <div className="stamp-sm">{label}</div>
      <div
        className={cn(
          'text-[28px] leading-none font-light tracking-[-0.02em] tabular-nums',
          accent ? 'text-signal-violet' : 'text-almost-white',
        )}
      >
        {value}
      </div>
      {hint && <div className="text-steel text-xs leading-relaxed text-pretty">{hint}</div>}
    </div>
  );
}
