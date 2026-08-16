import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { groupLabel, sourceLabel } from '@/lib/sources';
import { SOURCE_GROUPS, type AudioSource, type SourceGroup } from '@/types';

interface SourcePickerProps {
  sources: AudioSource[];
  selectedId: string;
  onSelect: (sourceId: string) => void;
  disabled?: boolean;
  /** `field` is the bordered control on the record screen; `row` is the settings row. */
  variant?: 'field' | 'row';
  label: string;
  value: string;
}

function groupSources(sources: AudioSource[]): [SourceGroup, AudioSource[]][] {
  return SOURCE_GROUPS.map((group): [SourceGroup, AudioSource[]] => [
    group,
    sources.filter((s) => s.group === group),
  ]).filter(([, items]) => items.length > 0);
}

export function SourcePicker({
  sources,
  selectedId,
  onSelect,
  disabled = false,
  variant = 'field',
  label,
  value,
}: SourcePickerProps) {
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

  const groups = groupSources(sources);

  return (
    <div className="source-picker" ref={containerRef}>
      {variant === 'field' ? (
        <button
          type="button"
          className="source-trigger"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
        >
          <span>
            <span className="source-trigger-label">{label}: </span>
            {value}
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      ) : (
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
              {value}
            </span>
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      )}

      {open && (
        <div className="source-menu" role="listbox">
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="source-group">{groupLabel(group, lang)}</div>
              {items.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  role="option"
                  aria-selected={source.id === selectedId}
                  className={`source-option${
                    source.id === selectedId ? ' source-option--selected' : ''
                  }`}
                  onClick={() => {
                    onSelect(source.id);
                    setOpen(false);
                  }}
                >
                  {sourceLabel(source, lang)}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="source-group">{t('source.empty')}</div>}
        </div>
      )}
    </div>
  );
}
