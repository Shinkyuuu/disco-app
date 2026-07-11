import { useEffect, useRef, useState } from 'react';

const SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Shared shape for the "Avatar size" and "Chat size" submenus below -
// a hover-to-open list of small/medium/large picking a persisted setting.
function SizeSubmenu({ label, name, value, onChange, openSubmenu, setOpenSubmenu, closeMenu }) {
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
              onClick={() => {
                onChange(v);
                closeMenu();
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Frameless windows have no OS chrome, so each window draws this ⋯ button in
// its top-right corner; the dropdown's Exit closes the window it lives in.
// `avatarSize`/`onAvatarSizeChange` and `chatSize`/`onChatSizeChange` are
// optional - only the chat window passes them, so only its menu gets those
// items. `pinned`/`onPinToggle` and `collapsed`/`onCollapsedToggle` are
// likewise chat-window-only.
export default function WindowMenu({
  avatarSize,
  onAvatarSizeChange,
  chatSize,
  onChatSizeChange,
  pinned,
  onPinToggle,
  collapsed,
  onCollapsedToggle,
  opacity,
  onOpacityChange,
}) {
  const [open, setOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const menuRef = useRef(null);

  // While collapsed, the chat window is locked to a 28px thin bar - the
  // dropdown needs the same room it gets in expanded mode, so tell the main
  // process to temporarily grow the window whenever this menu opens/closes
  // (a no-op when not collapsed, since there's already room). Covers every
  // path that changes `open` (button click, item selection, click-outside)
  // from one place instead of duplicating the call at each call site.
  useEffect(() => {
    window.api.setChatMenuOpen(open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
        setOpenSubmenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    setOpenSubmenu(null);
  }

  return (
    <div className="window-menu" ref={menuRef}>
      <button aria-label="Window menu" onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="window-menu-dropdown">
          {avatarSize && (
            <SizeSubmenu
              label="Avatar size"
              name="avatarSize"
              value={avatarSize}
              onChange={onAvatarSizeChange}
              openSubmenu={openSubmenu}
              setOpenSubmenu={setOpenSubmenu}
              closeMenu={closeMenu}
            />
          )}
          {chatSize && (
            <SizeSubmenu
              label="Chat size"
              name="chatSize"
              value={chatSize}
              onChange={onChatSizeChange}
              openSubmenu={openSubmenu}
              setOpenSubmenu={setOpenSubmenu}
              closeMenu={closeMenu}
            />
          )}
          {onOpacityChange && (
            <div className="window-menu-slider-item" onMouseDown={(e) => e.stopPropagation()}>
              <span>Opacity</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={opacity ?? 1}
                onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              />
            </div>
          )}
          {onPinToggle && (
            <button
              className="window-menu-item"
              onClick={() => {
                onPinToggle(!pinned);
                setOpen(false);
              }}
            >
              {pinned ? 'Unpin window' : 'Pin window'}
            </button>
          )}
          {onCollapsedToggle && (
            <button
              className="window-menu-item"
              onClick={() => {
                onCollapsedToggle(!collapsed);
                setOpen(false);
              }}
            >
              {collapsed ? 'Show chat box' : 'Hide chat box'}
            </button>
          )}
          <button className="window-menu-item" onClick={() => window.close()}>
            Exit
          </button>
        </div>
      )}
    </div>
  );
}
