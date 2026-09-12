'use client';

import { useMemo, useState } from 'react';

export interface ChipGroup {
  label: string;
  items: readonly string[];
}

/** Values the picker knows about but no group claims. Never silently dropped. */
const UNGROUPED = 'Other';

const humanise = (value: string) => value.replace(/_/g, ' ');

/**
 * Multi-select over a closed vocabulary.
 *
 * Targeting runs on a fixed list, and the original version of this showed the
 * whole list at once on purpose: seeing every option is what tells an advertiser
 * this is the complete set of things they can target on, which a dropdown hides.
 *
 * That argument is right for the developer's dashboard, where the point is to
 * see everything. It is wrong here. On the campaign builder the advertiser is
 * choosing, not auditing, and "show everything" meant 28 intents and 54
 * technologies as two flat walls of chips in a single step — about 111 chips
 * before persona, interests and countries. Nobody reads that; they pick the
 * first thing they recognise and move on, which is worse targeting than if the
 * list had been shorter.
 *
 * So the vocabulary is still complete and still fully reachable — nothing is
 * behind a dropdown — but it arrives in domain groups with a search box, most
 * of them folded shut, and every folded group states its own size so the
 * advertiser can see what they have not opened. The count is the honesty: a
 * collapsed "0 of 14" is not hiding anything, it is saying there are fourteen
 * more here and you have chosen none of them.
 */
export function ChipSelect({
  options,
  groups,
  selected,
  onChange,
  emptyLabel = 'Anyone',
  noun = 'options',
  openGroups = 1,
}: {
  /** The authority on what exists. Groups are intersected with this, so a
      vocabulary trimmed server-side trims the picker too. */
  options: readonly string[];
  /** Domain grouping. Omit for short lists that read fine as one row. */
  groups?: readonly ChipGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  noun?: string;
  /** How many groups start open. The rest fold, unless they hold a selection. */
  openGroups?: number;
}) {
  const [query, setQuery] = useState('');
  /** Only groups the advertiser has actually clicked. Everything else follows
      the default rule, so opening one group does not pin all the others. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const available = useMemo(() => new Set(options), [options]);

  const sections = useMemo<ChipGroup[]>(() => {
    if (!groups) return [{ label: '', items: options }];
    const claimed = new Set<string>();
    const out: ChipGroup[] = [];
    for (const group of groups) {
      const items = group.items.filter((item) => available.has(item));
      items.forEach((item) => claimed.add(item));
      if (items.length > 0) out.push({ label: group.label, items });
    }
    const rest = options.filter((option) => !claimed.has(option));
    if (rest.length > 0) out.push({ label: UNGROUPED, items: rest });
    return out;
  }, [groups, options, available]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return options.filter((option) => humanise(option).toLowerCase().includes(q));
  }, [query, options]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const chosen = selected.filter((value) => available.has(value));
  const searchable = options.length > 12;

  return (
    <div className="space-y-4">
      {/*
       * What is already chosen, before anything else.
       *
       * With most groups folded, the selection would otherwise be scattered
       * across sections the advertiser cannot see. This is the one place that
       * always answers "what have I picked".
       */}
      {chosen.length > 0 ? (
        // A plain row, not a filled panel. It repeats chips that may also be
        // visible in an open group below, so it has to read as a summary the
        // eye can skip rather than as a second control competing with them.
        <div>
          <div className="mb-2.5 flex items-center justify-between gap-4">
            <span className="stamp-sm">Selected · {chosen.length}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-steel hover:text-almost-white text-[11px] underline underline-offset-4 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => toggle(value)}
                aria-label={`Remove ${humanise(value)}`}
                className="border-almost-white bg-almost-white text-near-black focus-visible:ring-ring/70 inline-flex items-center gap-1.5 rounded-4xl border px-3 py-1.5 text-[11px] transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:outline-none"
              >
                {humanise(value)}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-graphite text-xs">
          Nothing selected — this dimension matches {emptyLabel.toLowerCase()}.
        </p>
      )}

      {searchable && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${options.length} ${noun}…`}
          className="border-hairline-strong text-almost-white placeholder:text-graphite focus-visible:border-signal-violet w-full rounded-none border-0 border-b bg-transparent px-0 py-2 text-sm outline-none"
        />
      )}

      {matches ? (
        matches.length === 0 ? (
          <p className="text-graphite py-2 text-xs">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          <Chips values={matches} selected={selected} onToggle={toggle} />
        )
      ) : (
        <div className="space-y-1">
          {sections.map((section, index) => {
            if (!section.label) {
              return (
                <Chips
                  key="flat"
                  values={section.items}
                  selected={selected}
                  onToggle={toggle}
                />
              );
            }

            const count = section.items.filter((item) => selected.includes(item)).length;
            // A group holding a selection always opens: folding away something
            // the advertiser chose is how a wizard loses someone's work.
            const open = toggled[section.label] ?? (index < openGroups || count > 0);

            return (
              <div key={section.label} className="border-hairline border-b last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setToggled((state) => ({ ...state, [section.label]: !open }))
                  }
                  className="group flex w-full items-center gap-3 py-3 text-left"
                >
                  <Chevron open={open} />
                  <span className="text-almost-white flex-1 text-[13px]">{section.label}</span>
                  <span
                    className={`text-[11px] tabular-nums ${count > 0 ? 'text-lavender-mist' : 'text-graphite'}`}
                  >
                    {count} of {section.items.length}
                  </span>
                </button>
                {open && (
                  <div className="pb-4">
                    <Chips values={section.items} selected={selected} onToggle={toggle} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chips({
  values,
  selected,
  onToggle,
}: {
  values: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => {
        const active = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            aria-pressed={active}
            className={`focus-visible:ring-ring/70 rounded-4xl border px-3 py-1.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none ${
              active
                ? 'border-almost-white bg-almost-white text-near-black'
                : 'border-hairline text-steel hover:border-almost-white/40 hover:text-almost-white'
            }`}
          >
            {humanise(value)}
          </button>
        );
      })}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`text-steel size-2.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
    >
      <path d="M1.5 3.75 6 8.25l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
