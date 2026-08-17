import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { choiceId, choiceLabel, choiceMeta } from '@/lib/engines';
import type { TranscriptionChoice } from '@/types';

interface EnginePickerProps {
  choices: TranscriptionChoice[];
  selected: TranscriptionChoice;
  onSelect: (choice: TranscriptionChoice) => void;
  disabled?: boolean;
  label: string;
}

/**
 * Which engine transcribes this recording. Everything in the list is ready to
 * run right now — a downloaded model, or a service with a key — so picking one
 * and pressing the button cannot fail for want of configuration.
 *
 * It mirrors `ModelPicker` and `SourcePicker` down to the CSS classes rather
 * than the three sharing a generic component: each is tied to a different shape
 * with different secondary text, and folding them together would make all three
 * harder to read than the repetition does.
 */
export function EnginePicker({
  choices,
  selected,
  onSelect,
  disabled = false,
  label,
}: EnginePickerProps) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedId = choiceId(selected);

  return (
    <div className="source-picker" ref={containerRef}>
      <button
        type="button"
        className="setting-row setting-row--interactive"
        // A single option is not a choice; showing a dropdown that cannot go
        // anywhere invites the click that proves it.
        disabled={disabled || choices.length < 2}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span className="setting-name">{label}</span>
          <span className="setting-value" style={{ display: 'block' }}>
            {choiceLabel(selected, lang)}
          </span>
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="source-menu" role="listbox">
          {choices.map((choice) => (
            <button
              key={choiceId(choice)}
              type="button"
              role="option"
              aria-selected={choiceId(choice) === selectedId}
              className={`source-option source-option--split${
                choiceId(choice) === selectedId ? ' source-option--selected' : ''
              }`}
              onClick={() => {
                onSelect(choice);
                setOpen(false);
              }}
            >
              <span>{choiceLabel(choice, lang)}</span>
              <span className="source-option-meta">{choiceMeta(choice, lang)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
