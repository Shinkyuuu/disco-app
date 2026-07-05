import { useEffect, useState } from 'react';

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
    </svg>
  );
}

function RestoreIcon() {
  // Two outline squares (no fill mask) so it reads correctly against any
  // button background — hover, non-hover, or the close button's red.
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" />
    </svg>
  );
}

// VS Code-style custom title bar: replaces the OS chrome on this frameless
// window with a drag region, a title, and minimize/maximize/close buttons
// wired to the window that hosts this renderer (not a hardcoded target).
export default function TitleBar({ title }) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.api.isWindowMaximized().then(setIsMaximized);
    return window.api.onWindowMaximizedChange(setIsMaximized);
  }, []);

  return (
    <div className="title-bar" onDoubleClick={() => window.api.windowToggleMaximize()}>
      <span className="title-bar-text">{title}</span>
      <div className="title-bar-controls">
        <button aria-label="Minimize" className="title-bar-button" onClick={() => window.api.windowMinimize()}>
          <MinimizeIcon />
        </button>
        <button
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          className="title-bar-button"
          onClick={() => window.api.windowToggleMaximize()}
        >
          {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button aria-label="Close" className="title-bar-button title-bar-button--close" onClick={() => window.api.windowClose()}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
