import { useEffect, useState } from 'react';
import icon from './assets/icon.png';

export default function UpdaterView() {
  const [status, setStatus] = useState({ phase: 'checking' });

  useEffect(() => {
    return window.api.onUpdaterStatus((s) => setStatus(s));
  }, []);

  return (
    <div className="updater-root">
      <img className="updater-icon" src={icon} alt="" />
      <h1 className="updater-title">Disco</h1>
      <p className="updater-text">
        {status.phase === 'checking' ? 'Checking for updates\u2026' : `Downloading update v${status.version}\u2026`}
      </p>
      {status.phase === 'downloading' && (
        <div className="updater-progress">
          <div className="updater-progress-fill" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}
