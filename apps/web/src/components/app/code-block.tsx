'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A copyable code sample.
 *
 * Documentation is the one place in this product where a reader is expected to
 * take something away with them, so the copy button is not a convenience — it
 * is the block's purpose, and it sits in a stamped header rather than floating
 * over the code where it would cover the first line.
 *
 * Deliberately unhighlighted. Syntax colour would spend four or five hues on a
 * palette that has two, and the system separates things by line weight rather
 * than by fill everywhere else; a rainbow inside one hairline box would be the
 * loudest thing on a page whose loudest thing is meant to be the price.
 */
export function CodeBlock({
  label,
  code,
  className,
}: {
  /** Stamped caption naming the block — a filename, a shell, a verb. */
  label: string;
  code: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={cn('border-hairline rounded-card overflow-hidden border', className)}>
      <div className="border-hairline flex items-center gap-4 border-b px-5 py-2.5">
        <span className="stamp-sm min-w-0 truncate">{label}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => {
                setCopied(true);
                // Long enough to read, short enough that the button is ready
                // again before a reader who copied the wrong block looks back.
                setTimeout(() => setCopied(false), 2000);
              },
              () => undefined,
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {/*
       * The only element on these pages allowed to scroll sideways. Code has a
       * natural width and wrapping it at a phone's 360px turns every sample
       * into an unreadable staircase, so the block scrolls and the page does
       * not.
       */}
      <pre className="text-soft-white overflow-x-auto px-5 py-4 font-mono text-[13px] leading-[1.7]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline code, at the weight the surrounding prose is set in. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="border-hairline text-lavender-mist rounded border px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  );
}
