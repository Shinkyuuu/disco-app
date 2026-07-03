import LauncherView from './LauncherView';
import ChatView from './ChatView';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'chat') return <ChatView />;
  return <LauncherView />;
}
