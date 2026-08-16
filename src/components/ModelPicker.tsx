import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { modelLabel } from '@/lib/models';
import type { ModelStatus } from '@/types';

interface ModelPickerProps {
  models: ModelStatus[];
  selectedId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  label: string;
}

/**
 * Dropdown over the local whisper.cpp catalogue. Picking a model only records
 * the choice: downloading is a separate, explicit step in the row below, so
 * changing the setting never starts a gigabyte-sized transfer by surprise.
 *
 * It mirrors `SourcePicker` down to the CSS classes rather than sharing code
 * with it: that one is tied to `AudioSource` and its group headings, and making
 * it generic would complicate the only place it is used today.
 */
export function ModelPicker({
  models,
  selectedId,
  onSelect,
  disabled = false,
  label,
}: ModelPickerProps) {
  const { lang, t } = useI18n();
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

  return (
    <div className="source-picker" ref={containerRef}>
      <button
        type="button"
        className="setting-row setting-row--interactive"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <span className="setting-name">{label}</span>
          <span className="setting-value" style={{ display: 'block' }}>
            {modelLabel(selectedId, lang)}
          </span>
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="source-menu" role="listbox">
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={model.id === selectedId}
              className={`source-option source-option--split${
                model.id === selectedId ? ' source-option--selected' : ''
              }`}
              onClick={() => {
                onSelect(model.id);
                setOpen(false);
              }}
            >
              <span>{modelLabel(model.id, lang)}</span>
              <span className="source-option-meta">
                {model.installed
                  ? `${t('settings.modelInstalled')} · ${formatBytes(model.bytes)}`
                  : formatBytes(model.approxBytes)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
