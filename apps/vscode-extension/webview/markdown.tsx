import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately small markdown renderer.
 *
 * The assistant answers in markdown and a wall of asterisks reads badly next to
 * a designed sponsored card, so headings, lists, code and emphasis are rendered
 * properly. It builds React elements rather than HTML strings: nothing the
 * model writes can become markup, which matters more here than completeness,
 * because a webview that renders model output as HTML is an injection surface.
 *
 * Unsupported syntax degrades to plain text rather than disappearing.
 */

export interface CodeBlock {
  language: string | null;
  code: string;
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' }
  | { kind: 'code'; language: string | null; code: string; closed: boolean };

const FENCE = /^\s*```(\w+)?\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:---|\*\*\*|___)\s*$/;

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] ?? null;
      const code: string[] = [];
      index += 1;
      let closed = false;
      while (index < lines.length) {
        if (FENCE.test(lines[index] ?? '')) {
          closed = true;
          index += 1;
          break;
        }
        code.push(lines[index] ?? '');
        index += 1;
      }
      // An unclosed fence is the normal state mid-stream, not an error.
      blocks.push({ kind: 'code', language, code: code.join('\n'), closed });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2] ?? '' });
      index += 1;
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (match) {
          items.push(match[1] ?? '');
          index += 1;
          continue;
        }
        // An indented continuation belongs to the item above it.
        if (items.length > 0 && /^\s{2,}\S/.test(current)) {
          items[items.length - 1] += ` ${current.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = QUOTE.exec(lines[index] ?? '');
        if (!match) break;
        quoted.push(match[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        !current.trim() ||
        FENCE.test(current) ||
        HEADING.test(current) ||
        BULLET.test(current) ||
        NUMBERED.test(current) ||
        QUOTE.test(current) ||
        RULE.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
}

/** Inline emphasis, code and links. Links render as text plus their href. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const id = `${keyPrefix}-${key++}`;

    if (token.startsWith('`')) {
      nodes.push(
        <code className="inline-code" key={id}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      const href = token.slice(token.indexOf('(') + 1, -1);
      nodes.push(
        <span className="md-link" key={id} title={href}>
          {label}
        </span>,
      );
    } else {
      nodes.push(<em key={id}>{token.slice(1, -1)}</em>);
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

interface Props {
  text: string;
  onCopyCode: (code: string) => void;
  onInsertCode: (code: string) => void;
}

export function Markdown({ text, onCopyCode, onInsertCode }: Props) {
  const blocks = parseBlocks(text);

  return (
    <div className="md">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;

        switch (block.kind) {
          case 'heading': {
            const Tag = (block.level <= 2 ? 'h3' : 'h4') as 'h3' | 'h4';
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }

          case 'list':
            return block.ordered ? (
              <ol key={key}>
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key}>
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
                ))}
              </ul>
            );

          case 'quote':
            return (
              <blockquote key={key}>
                {block.lines.map((line, i) => (
                  <Fragment key={`${key}-${i}`}>
                    {renderInline(line, `${key}-${i}`)}
                    {i < block.lines.length - 1 && <br />}
                  </Fragment>
                ))}
              </blockquote>
            );

          case 'rule':
            return <hr key={key} />;

          case 'code':
            return (
              <div className="code-block" key={key}>
                <div className="code-head">
                  <span>{block.language ?? 'code'}</span>
                  {/* Only offered once the block is complete: inserting half a
                      function into someone's file is worse than waiting. */}
                  {block.closed && (
                    <span className="code-actions">
                      <button className="ghost" onClick={() => onCopyCode(block.code)}>
                        Copy
                      </button>
                      <button className="ghost" onClick={() => onInsertCode(block.code)}>
                        Insert
                      </button>
                    </span>
                  )}
                </div>
                <pre>
                  <code>{block.code}</code>
                </pre>
              </div>
            );

          default:
            return (
              <p key={key}>
                {block.lines.map((line, i) => (
                  <Fragment key={`${key}-${i}`}>
                    {renderInline(line, `${key}-${i}`)}
                    {i < block.lines.length - 1 && <br />}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
