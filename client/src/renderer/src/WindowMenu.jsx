import { useRef } from 'react';

// Frameless windows have no OS chrome, so each window draws this ⋯ button in
// its top-right corner. Clicking it opens the dropdown's actual content in a
// separate, always-on-top popup window (see ChatMenuView) rather than
// rendering it here - Electron clips all content to a window's own rect, so
// a dropdown needing more room than a (possibly collapsed, thin-bar-sized)
// chat window currently has would otherwise force resizing/moving the chat
// window itself just to show it. `sections` mirrors which optional items the
// popup should include (only the chat window's normal, non-error render
// passes any - error screens pass none, leaving just Exit).
export default function WindowMenu({ sections = {} }) {
  const buttonRef = useRef(null);

  function handleClick() {
    const rect = buttonRef.current.getBoundingClientRect();
    const anchor = {
      x: Math.round(window.screenX + rect.left),
      y: Math.round(window.screenY + rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    window.api.openChatMenu(anchor, sections);
  }

  return (
    <div className="window-menu">
      <button ref={buttonRef} aria-label="Window menu" onClick={handleClick}>
        ⋯
      </button>
    </div>
  );
}
