import { useRef, useState } from 'react';
import { useI18n } from '@/i18n';

/**
 * Obsidian does not allow spaces inside a tag, so they are closed up with a
 * hyphen. Normalising happens while typing, not on export, so the chip shows
 * exactly what will end up in the note.
 */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, '-');
}

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Chip-based tag field: a comma (or Enter) closes the tag being typed. Every
 * change goes out through `onChange`; there is no save button, since adding or
 * removing a chip is already a deliberate gesture.
 */
export function TagInput({ tags, onChange }: TagInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);

  /** Accepts several at once: pasting `a, b, c` adds three chips. */
  const add = (raw: string) => {
    const added = raw
      .split(',')
      .map(normalize)
      .filter((tag) => tag && !tags.includes(tag));
    if (added.length > 0) onChange([...tags, ...added]);
  };

  const commitDraft = () => {
    if (draft.trim()) add(draft);
    setDraft('');
  };

  const remove = (tag: string) => onChange(tags.filter((existing) => existing !== tag));

  return (
    // Clicking the empty space focuses the field, like any text box: the box is
    // the whole frame, not just the input.
    <div className="tag-input" onClick={() => fieldRef.current?.focus()}>
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={t('tags.remove', { tag })}
            onClick={(e) => {
              e.stopPropagation();
              remove(tag);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={fieldRef}
        type="text"
        className="tag-field"
        value={draft}
        placeholder={tags.length === 0 ? t('tags.placeholder') : ''}
        aria-label={t('tags.add')}
        onChange={(e) => {
          const value = e.target.value;
          if (value.includes(',')) {
            add(value);
            setDraft('');
          } else {
            setDraft(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          } else if (e.key === 'Escape') {
            setDraft('');
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            // With the field empty, backspace walks back over the last chip.
            onChange(tags.slice(0, -1));
          }
        }}
        // A half-typed tag is not lost when the field loses focus.
        onBlur={commitDraft}
      />
    </div>
  );
}
