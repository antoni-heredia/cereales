import { Sidebar } from '@/components/Sidebar';
import { I18nProvider } from '@/i18n';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { RecordScreen } from '@/screens/RecordScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { TranscriptScreen } from '@/screens/TranscriptScreen';
import { AppStateProvider, useApp } from '@/state/store';

function CurrentScreen() {
  const { screen } = useApp();
  switch (screen) {
    case 'record':
      return <RecordScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'transcript':
      return <TranscriptScreen />;
  }
}

export default function App() {
  return (
    // i18n sits above the state provider: the store reads `t` to build default
    // titles and error messages, and it pushes the saved preference back down
    // once the settings have loaded.
    <I18nProvider>
      <AppStateProvider>
        <div className="app">
          <Sidebar />
          <main className="main">
            <CurrentScreen />
          </main>
        </div>
      </AppStateProvider>
    </I18nProvider>
  );
}
