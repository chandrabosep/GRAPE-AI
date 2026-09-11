import { useEffect, useRef, useState } from 'react';
import type { ModelChoice } from '../src/protocol';

/**
 * The model picker.
 *
 * Sits in the composer rather than the top bar, because choosing a model is
 * part of asking a question, not a setting. Each option carries its output
 * price, since the whole product is denominated in credits the developer earns
 * — "which model" and "what will this cost me" are the same decision here.
 */

interface Props {
  models: ModelChoice[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (modelId: string) => void;
}

/**
 * Output price per million tokens — the unit model pricing is quoted in
 * everywhere else, so it is the one a developer can compare without arithmetic.
 *
 * A million tokens at N micro-USD each is N million micro-USD, which is exactly
 * N dollars. The conversion really is the identity; it is spelled out because
 * the coincidence is not obvious from the units.
 */
function pricePerMillion(microPerToken: number): string {
  return `$${microPerToken.toFixed(2)}/M out`;
}

export function ModelMenu({ models, selectedId, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (models.length === 0) return null;

  const selected = models.find((model) => model.id === selectedId) ?? models[0]!;

  return (
    <div className="model-menu" ref={ref}>
      <button
        className="model-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title={selected.description}
      >
        <span className={`model-dot ${selected.tier}`} aria-hidden="true" />
        {selected.label}
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="model-dropdown" role="menu">
          {models.map((model) => (
            <button
              key={model.id}
              className={`model-option${model.id === selected.id ? ' active' : ''}`}
              role="menuitemradio"
              aria-checked={model.id === selected.id}
              onClick={() => {
                onSelect(model.id);
                setOpen(false);
              }}
            >
              <span className="model-option-head">
                <span className={`model-dot ${model.tier}`} aria-hidden="true" />
                <span className="model-option-label">{model.label}</span>
                <span className="model-option-price">
                  {pricePerMillion(model.outputMicroPerToken)}
                </span>
              </span>
              <span className="model-option-description">{model.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
