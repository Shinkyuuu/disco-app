import { useEffect, useState } from 'react';

const SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Shared shape for the "Avatar size" and "Chat size" submenus below - a
// hover-to-open list of small/medium/large picking a persisted setting.
function SizeSubmenu({ label, name, value, onChange, openSubmenu, setOpenSubmenu }) {
  return (
    <div
      className="window-menu-hoverable"
      onMouseEnter={() => setOpenSubmenu(name)}
      onMouseLeave={() => setOpenSubmenu(null)}
    >
      <button className="window-menu-item">
        <span>{label}</span>
        <span className="window-menu-item-arrow">›</span>
      </button>
      {openSubmenu === name && (
        <div className="window-menu-submenu">
          {SIZES.map(({ value: v, label: l }) => (
            <button
              key={v}
              className={v === value ? 'window-menu-item window-menu-item--active' : 'window-menu-item'}
              onClick={() => onChange(v)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The ⋯ menu's actual content, rendered in its own small always-on-top popup
// window (see createChatMenuWindow in main/index.js) instead of inside the
// chat window - this reads/writes the same store-backed settings and pin
// state as ChatView, just over IPC from a separate renderer process, since
// there's no React tree to share props through across windows. `sections`
// (from the URL, set by WindowMenu when it opened this window) mirrors which
// items ChatView's current render supports - error screens open this with no
// sections at all, leaving just Exit.
export default function ChatMenuView({ params }) {
  const sections = {
    avatarSize: params.has('avatarSize'),
    chatSize: params.has('chatSize'),
    opacity: params.has('opacity'),
    pin: params.has('pin'),
    collapse: params.has('collapse'),
    lock: params.has('lock'),
    autoWidth: params.has('autoWidth'),
  };
  const openDirection = params.get('openDirection') === 'up' ? 'up' : 'down';

  const [settings, setSettings] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.isAlwaysOnTop().then(setPinned);
    return window.api.onSettingsChanged((partial) => {
      setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
    });
  }, []);

  if (!settings) return null;

  function changeSetting(partial) {
    setSettings((prev) => ({ ...prev, ...partial }));
    window.api.setSettings(partial);
    window.close();
  }

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    window.api.setAlwaysOnTop(next);
    window.close();
  }

  return (
    <div className={`chat-menu-popup chat-menu-popup--${openDirection}`}>
      <div className="window-menu-dropdown">
        {sections.avatarSize && (
          <SizeSubmenu
            label="Avatar size"
            name="avatarSize"
            value={settings.avatarSize}
            onChange={(avatarSize) => changeSetting({ avatarSize })}
            openSubmenu={openSubmenu}
            setOpenSubmenu={setOpenSubmenu}
          />
        )}
        {sections.chatSize && (
          <SizeSubmenu
            label="Chat size"
            name="chatSize"
            value={settings.chatSize}
            onChange={(chatSize) => changeSetting({ chatSize })}
            openSubmenu={openSubmenu}
            setOpenSubmenu={setOpenSubmenu}
          />
        )}
        {sections.opacity && (
          <div className="window-menu-slider-item">
            <span>Opacity</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.chatOpacity ?? 1}
              onChange={(e) => {
                const chatOpacity = parseFloat(e.target.value);
                setSettings((prev) => ({ ...prev, chatOpacity }));
                window.api.setSettings({ chatOpacity });
              }}
            />
          </div>
        )}
        {sections.pin && (
          <button className="window-menu-item" onClick={togglePin}>
            {pinned ? 'Unpin window' : 'Pin window'}
          </button>
        )}
        {sections.collapse && (
          <button className="window-menu-item" onClick={() => changeSetting({ chatCollapsed: !settings.chatCollapsed })}>
            {settings.chatCollapsed ? 'Show chat box' : 'Hide chat box'}
          </button>
        )}
        {sections.lock && (
          <button className="window-menu-item" onClick={() => changeSetting({ chatLocked: !settings.chatLocked })}>
            {settings.chatLocked ? 'Unlock window' : 'Lock window'}
          </button>
        )}
        {sections.autoWidth && (
          <button className="window-menu-item" onClick={() => changeSetting({ chatAutoWidth: !settings.chatAutoWidth })}>
            {settings.chatAutoWidth ? 'Disable auto width' : 'Enable auto width'}
          </button>
        )}
        <button className="window-menu-item" onClick={() => window.api.closeChatWindow()}>
          Exit
        </button>
      </div>
    </div>
  );
}
