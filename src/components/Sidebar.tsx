import { useI18n } from '@/i18n';
import { useApp } from '@/state/store';
import { folderLeaf } from '@/lib/format';
import type { MessageKey } from '@/i18n';
import type { ScreenKey } from '@/types';

const NAV: { key: ScreenKey; label: MessageKey }[] = [
  { key: 'record', label: 'nav.record' },
  { key: 'history', label: 'nav.history' },
  { key: 'settings', label: 'nav.settings' },
];

export function Sidebar() {
  const { screen, settings, actions } = useApp();
  const { t } = useI18n();
  // The transcript screen is reached from the history list, so it keeps
  // "History" lit rather than leaving no nav item active.
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
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="folder-badge" title={settings.storageRoot}>
        {settings.obsidianVaultPath ? t('sidebar.obsidian') : t('sidebar.savingTo')}:{' '}
        <strong>{folderLeaf(settings.obsidianVaultPath ?? settings.storageRoot)}</strong>
      </div>
    </nav>
  );
}
