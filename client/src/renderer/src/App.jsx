import LauncherView from './LauncherView';
import ChatView from './ChatView';
import UpdaterView from './UpdaterView';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'chat') return <ChatView />;
  if (view === 'updater') return <UpdaterView />;
  return <LauncherView />;
}
