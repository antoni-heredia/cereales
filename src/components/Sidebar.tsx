import { useApp } from '@/state/store';
import { folderLeaf } from '@/lib/format';
import type { ScreenKey } from '@/types';

const NAV: { key: ScreenKey; label: string }[] = [
  { key: 'record', label: 'Grabar' },
  { key: 'history', label: 'Historial' },
  { key: 'settings', label: 'Ajustes' },
];

export function Sidebar() {
  const { screen, settings, actions } = useApp();
  // The transcript screen is reached from the history list, so it keeps
  // "Historial" lit rather than leaving no nav item active.
  const activeKey: ScreenKey = screen === 'transcript' ? 'history' : screen;

  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true" />
        <div className="brand-name">cereales</div>
      </div>

      <div className="nav">
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`nav-item${activeKey === item.key ? ' nav-item--active' : ''}`}
            aria-current={activeKey === item.key ? 'page' : undefined}
            onClick={() => actions.goScreen(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="folder-badge">
        Grabaciones: <strong>{folderLeaf(settings.recordingFolder)}</strong>
        <br />
        Transcripciones: <strong>{folderLeaf(settings.transcriptFolder)}</strong>
      </div>
    </nav>
  );
}
