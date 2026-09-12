'use client';

/**
 * Multi-select as toggleable chips.
 *
 * Targeting is a closed vocabulary, so the whole option set is small enough to
 * show at once. Seeing every choice laid out communicates something a dropdown
 * hides: this list is the complete set of things an advertiser can target on.
 *
 * A selected chip inverts to paper-white rather than filling with the accent.
 * A targeting panel routinely has a dozen of these on at once, and a dozen
 * violet chips would spend the page's whole colour ration on a filter.
 */
export function ChipSelect({
  options,
  selected,
  onChange,
  emptyLabel = 'Anyone',
}: {
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              aria-pressed={active}
              className={`focus-visible:ring-ring/70 rounded-4xl border px-3 py-1.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                active
                  ? 'border-almost-white bg-almost-white text-near-black'
                  : 'border-hairline text-steel hover:border-almost-white/40 hover:text-almost-white'
              }`}
            >
              {option.replace(/_/g, ' ')}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-graphite text-xs">
          Nothing selected — this dimension matches {emptyLabel.toLowerCase()}.
        </p>
      )}
    </div>
  );
}
