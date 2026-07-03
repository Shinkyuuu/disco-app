import { useEffect, useRef, useState } from 'react';

const AVATAR_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Frameless windows have no OS chrome, so each window draws this ⋯ button in
// its top-right corner; the dropdown's Exit closes the window it lives in.
// `avatarSize`/`onAvatarSizeChange` are optional — only the chat window (the
// only place avatars render) passes them, so only its menu gets that item.
export default function WindowMenu({ avatarSize, onAvatarSizeChange }) {
  const [open, setOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
        setSubmenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="window-menu" ref={menuRef}>
      <button aria-label="Window menu" onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="window-menu-dropdown">
          {avatarSize && (
            <div
              className="window-menu-hoverable"
              onMouseEnter={() => setSubmenuOpen(true)}
              onMouseLeave={() => setSubmenuOpen(false)}
            >
              <button className="window-menu-item">
                <span>Avatar size</span>
                <span className="window-menu-item-arrow">›</span>
              </button>
              {submenuOpen && (
                <div className="window-menu-submenu">
                  {AVATAR_SIZES.map(({ value, label }) => (
                    <button
                      key={value}
                      className={
                        value === avatarSize ? 'window-menu-item window-menu-item--active' : 'window-menu-item'
                      }
                      onClick={() => {
                        onAvatarSizeChange(value);
                        setOpen(false);
                        setSubmenuOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="window-menu-item" onClick={() => window.close()}>
            Exit
          </button>
        </div>
      )}
    </div>
  );
}
