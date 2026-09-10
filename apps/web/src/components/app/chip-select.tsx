'use client';

/**
 * Multi-select as toggleable chips.
 *
 * Targeting is a closed vocabulary, so the whole option set is small enough to
 * show at once. Seeing every choice laid out communicates something a dropdown
 * hides: this list is the complete set of things an advertiser can target on.
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
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              {option.replace(/_/g, ' ')}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Nothing selected — this dimension matches {emptyLabel.toLowerCase()}.
        </p>
      )}
    </div>
  );
}
