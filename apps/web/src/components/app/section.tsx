import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The stamped section heading.
 *
 * This is the system's replacement for an H2, and the only decoration it gets
 * is the 0.2em tracking — no rule, no colour, no weight change. Rendered as a
 * single line that fills its container, which is why the size is fluid rather
 * than fixed at the spec'd 74px: at 0.2em, 74px needs roughly 900px of run
 * before it wraps, and a stamp that wraps is not a stamp.
 *
 * `sub` is deliberately not part of the stamp. The mono voice and the humanist
 * voice must not share a line, so the subtitle sits under it in Whyte.
 */
export function Stamp({
  children,
  sub,
  className,
  size = 'page',
  as: Tag = 'h2',
}: {
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
  /**
   * `page` is the full 74px signpost — one per screen, on the thing the screen
   * is. `section` is the same voice two thirds down, for the headings inside
   * it. Without the second scale a dashboard is four identical 74px shouts and
   * the reader has no way to tell the page title from a subsection.
   */
  size?: 'page' | 'section';
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className={cn(size === 'page' ? 'space-y-4' : 'space-y-3', className)}>
      <Tag className={cn(size === 'page' ? 'stamp' : 'stamp-md', 'text-balance')}>{children}</Tag>
      {sub && <p className="text-steel max-w-2xl text-[15px] leading-relaxed">{sub}</p>}
    </div>
  );
}

/**
 * A page section.
 *
 * Sections are separated by space and by the stamp above them, never by a
 * background change — the whole page sits on one uninterrupted void. `divide`
 * adds the single hairline for the few places where two adjacent sections
 * would otherwise run together.
 *
 * The padding is half the 120px section gap, because the gap is between two
 * sections and both of them pay into it. Setting the full 120px on each side
 * is the obvious mistake and it puts 240px of nothing between every block,
 * which stops reading as breathing room and starts reading as a broken page.
 */
export function Section({
  children,
  className,
  divide = false,
}: {
  children: ReactNode;
  className?: string;
  divide?: boolean;
}) {
  return (
    <section
      className={cn('py-14 md:py-[60px]', divide && 'border-hairline border-t', className)}
    >
      {children}
    </section>
  );
}

/** The 1200px column everything on the marketing pages sits inside. */
export function Shell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1200px] px-6 md:px-10', className)}>{children}</div>;
}

/**
 * The eyebrow: a tiny stamped label naming what follows.
 *
 * Borrowed straight from the boarding pass — it is how the source signposts a
 * block without spending a heading on it.
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('stamp-sm', className)}>{children}</div>;
}
