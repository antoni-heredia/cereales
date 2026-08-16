import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';

interface ScreenshotViewerProps {
  src: string;
  timeSec: number;
  /** The note the screenshot belongs to; empty for an uncaptioned one. */
  caption: string;
  onEdit: () => void;
  onClose: () => void;
}

/**
 * A saved screenshot at full size.
 *
 * It shows what is on disk rather than re-rendering anything, so what is on
 * screen here is exactly what the Obsidian note embeds — including the edits of
 * a screenshot that has been annotated more than once.
 */
export function ScreenshotViewer({ src, timeSec, caption, onEdit, onClose }: ScreenshotViewerProps) {
  const { t } = useI18n();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    // Clicking the backdrop closes, the way a lightbox is expected to. The
    // panel stops the click so a stray one on the image does not dismiss it.
    <div
      className="shot-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('shot.viewTitle')}
      onClick={onClose}
    >
      <div className="shot-panel shot-panel--view" onClick={(event) => event.stopPropagation()}>
        <header className="shot-header">
          <h2 className="shot-title">{caption || t('shot.viewTitle')}</h2>
          <span className="shot-time">{t('shot.at', { time: formatTime(timeSec) })}</span>
        </header>

        <div className="shot-stage">
          <img
            className="shot-full"
            src={src}
            alt={t('transcript.shotAlt', { time: formatTime(timeSec) })}
          />
        </div>

        <footer className="shot-actions">
          <button type="button" className="btn-outline" onClick={onEdit}>
            {t('shot.edit')}
          </button>
          <button type="button" className="btn-solid" onClick={onClose}>
            {t('shot.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
