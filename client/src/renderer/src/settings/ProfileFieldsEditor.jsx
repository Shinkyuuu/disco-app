import { useEffect, useRef, useState } from 'react';

// One editor, three call sites (Your Profile card, each Default Slot row, each
// Friend card). Avatar fields: thumbnail (or dashed "+" placeholder) with
// Change and Clear. Color fields: swatch (or dashed placeholder) with a native
// color input and Clear. "Clear" nulls that one field → universal fallback.
function AvatarField({ label, src, onPick, onClear }) {
  return (
    <div className="pf-field">
      <span className="pf-label">{label}</span>
      {src ? (
        <img className="pf-avatar" src={src} alt={label} />
      ) : (
        <div className="pf-avatar pf-avatar--empty" aria-hidden="true">
          +
        </div>
      )}
      <div className="pf-actions">
        <button className="pf-btn" onClick={onPick}>
          {src ? 'Change' : 'Add'}
        </button>
        {src && (
          <button className="pf-btn pf-btn--muted" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// A native color input fires onChange continuously while the user drags within
// the picker, not just once on commit - onSet triggers an IPC write plus a full
// settings reload (see SettingsView's reload()), so calling it on every tick
// would fire many of those per second. Local state keeps the swatch preview
// instant while debouncing which value actually gets committed upstream.
const COLOR_COMMIT_DEBOUNCE_MS = 200;

function ColorField({ label, value, onSet, onClear, exampleText, exampleClassName }) {
  const [localValue, setLocalValue] = useState(value);
  // Render-phase state adjustment (not an effect) for "local state should reset
  // when this prop changes" - see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalValue(value);
  }
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function handleChange(next) {
    setLocalValue(next);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onSet(next), COLOR_COMMIT_DEBOUNCE_MS);
  }

  return (
    <div className="pf-color-row">
      <span className="pf-label pf-color-row-label">{label}</span>
      <label
        className={`pf-swatch ${localValue ? '' : 'pf-swatch--empty'}`.trim()}
        style={localValue ? { background: localValue } : undefined}
      >
        {!localValue && <span aria-hidden="true">+</span>}
        <input
          className="pf-color-input"
          type="color"
          value={localValue ?? '#ffffff'}
          onChange={(e) => handleChange(e.target.value)}
        />
      </label>
      <span className={`${exampleClassName} pf-color-example`} style={localValue ? { color: localValue } : undefined}>
        {exampleText}
      </span>
      <div className="pf-actions">
        {localValue && (
          <button className="pf-btn pf-btn--muted" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default function ProfileFieldsEditor({ layout, profile, onPickAvatar, onClearAvatar, onSetColor, onClearColor }) {
  return (
    <div className={`profile-fields profile-fields--${layout}`}>
      <div className="pf-avatars">
        <AvatarField
          label="Silent"
          src={profile.avatarSilent}
          onPick={() => onPickAvatar('silent')}
          onClear={() => onClearAvatar('silent')}
        />
        <AvatarField
          label="Speaking"
          src={profile.avatarSpeaking}
          onPick={() => onPickAvatar('speaking')}
          onClear={() => onClearAvatar('speaking')}
        />
      </div>
      <div className="pf-colors">
        <ColorField
          label="Name color"
          value={profile.usernameColor}
          onSet={(v) => onSetColor('usernameColor', v)}
          onClear={() => onClearColor('usernameColor')}
          exampleText="Username"
          exampleClassName="message-line-username message-line-username--medium"
        />
        <ColorField
          label="Chat color"
          value={profile.chatColor}
          onSet={(v) => onSetColor('chatColor', v)}
          onClear={() => onClearColor('chatColor')}
          exampleText="This is what your captions will look like."
          exampleClassName="message-line-text message-line-text--medium"
        />
      </div>
    </div>
  );
}
