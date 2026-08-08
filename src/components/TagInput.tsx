import { useRef, useState } from 'react';

/**
 * Obsidian no admite espacios dentro de una etiqueta, así que se cierran con
 * guion. Se normaliza al escribir, no al exportar, para que la ficha enseñe
 * exactamente lo que va a acabar en la nota.
 */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, '-');
}

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Campo de etiquetas por fichas: la coma (o Enter) cierra la que se está
 * escribiendo. Cada cambio sale por `onChange`, no hay botón de guardar: añadir
 * o quitar una ficha ya es un gesto deliberado.
 */
export function TagInput({ tags, onChange }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);

  /** Acepta varias de golpe: pegar `a, b, c` mete tres fichas. */
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

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  return (
    // Pinchar en el hueco de al lado enfoca el campo, como en cualquier caja
    // de texto: la caja es todo el recuadro, no solo el input.
    <div className="tag-input" onClick={() => fieldRef.current?.focus()}>
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={`Quitar la etiqueta ${tag}`}
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
        placeholder={tags.length === 0 ? 'reunión, cliente' : ''}
        aria-label="Añadir etiqueta"
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
            // Con el campo vacío, borrar retrocede sobre la última ficha.
            onChange(tags.slice(0, -1));
          }
        }}
        // Lo escrito a medias no se pierde al salir del campo.
        onBlur={commitDraft}
      />
    </div>
  );
}
