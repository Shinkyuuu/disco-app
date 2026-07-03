import { useEffect, useRef, useState } from 'react';

// Frameless windows have no OS chrome, so each window draws this ⋯ button in
// its top-right corner; the dropdown's Exit closes the window it lives in.
export default function WindowMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
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
          <button onClick={() => window.close()}>Exit</button>
        </div>
      )}
    </div>
  );
}
