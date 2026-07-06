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

function ColorField({ label, value, onSet, onClear }) {
  return (
    <div className="pf-field">
      <span className="pf-label">{label}</span>
      <label
        className={`pf-swatch ${value ? '' : 'pf-swatch--empty'}`.trim()}
        style={value ? { background: value } : undefined}
      >
        {!value && <span aria-hidden="true">+</span>}
        <input
          className="pf-color-input"
          type="color"
          value={value ?? '#ffffff'}
          onChange={(e) => onSet(e.target.value)}
        />
      </label>
      <div className="pf-actions">
        {value && (
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
      <ColorField
        label="Name color"
        value={profile.usernameColor}
        onSet={(v) => onSetColor('usernameColor', v)}
        onClear={() => onClearColor('usernameColor')}
      />
      <ColorField
        label="Chat color"
        value={profile.chatColor}
        onSet={(v) => onSetColor('chatColor', v)}
        onClear={() => onClearColor('chatColor')}
      />
    </div>
  );
}
