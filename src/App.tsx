import { Sidebar } from '@/components/Sidebar';
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
    <AppStateProvider>
      <div className="app">
        <Sidebar />
        <main className="main">
          <CurrentScreen />
        </main>
      </div>
    </AppStateProvider>
  );
}
