/**
 * Inline SVG icons.
 *
 * The webview's CSP allows no external fonts or stylesheets, so VS Code's own
 * codicon font is unavailable here — these are drawn to match it: a 16px grid,
 * 1.25 stroke, `currentColor`, so a button's hover and disabled colours carry
 * straight through without any icon-specific rules.
 */

import type { ReactNode } from 'react';

type Props = { className?: string };

function Svg({ children, className }: Props & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CopyIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="5.75" y="5.75" width="8" height="8" rx="1.5" />
      <path d="M10.25 3.25A1.5 1.5 0 0 0 8.75 2.25H3.75a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1 1.41" />
    </Svg>
  );
}

export function CheckIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="m3 8.5 3.25 3.25L13 5" />
    </Svg>
  );
}

/** An arrow moving text toward the editor's caret, which the bar on the right is. */
export function InsertIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M2 8h8" />
      <path d="m7 5 3 3-3 3" />
      <path d="M13.25 2.75v10.5" />
    </Svg>
  );
}

export function RegenerateIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.78" />
      <path d="M13.4 2.4v3.2h-3.2" />
    </Svg>
  );
}

/** The composer's context button. A plus is the one glyph every chat app uses for "add". */
export function PlusIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  );
}

/** Marks the chip naming the file a question will be asked about. */
export function FileIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M9 2.25H4.75a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5V5.75z" />
      <path d="M9 2.25v3.5h3.75" />
    </Svg>
  );
}

/** Marks the chip for an attached editor selection. */
export function SelectionIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M4.75 2.75h-2v10.5h2M11.25 2.75h2v10.5h-2" />
      <path d="M6.5 5.75h3M6.5 8h3M6.5 10.25h3" />
    </Svg>
  );
}
