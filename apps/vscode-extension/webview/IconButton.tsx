/**
 * Icon-only buttons for the answer and code-block action bars.
 *
 * A sidebar is narrow, and `Copy Insert Regenerate` spelled out ate the width
 * an answer needs. Dropping to glyphs costs the label, so every button carries
 * the same text as `title` and `aria-label`: hover still explains it, and a
 * screen reader still hears a verb rather than "button".
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

type Props = {
  label: string;
  onClick: () => void;
  children: ReactNode;
};

export function IconButton({ label, onClick, children }: Props) {
  return (
    <button className="ghost action" title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Copy is the one action with no visible consequence — nothing in the panel
 * changes, and without the word "Copy" there is nothing left to confirm it
 * worked. The icon becomes a tick for a moment instead.
 */
export function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      className={copied ? 'ghost action copied' : 'ghost action'}
      title={copied ? 'Copied' : label}
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        onCopy();
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
