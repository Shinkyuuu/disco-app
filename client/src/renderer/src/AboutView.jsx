export default function AboutView({ onBack }) {
  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div className="settings-topbar-inner">
          <button className="settings-back-btn" onClick={onBack}>
            ‹ Back
          </button>
          <h2 className="settings-title">About</h2>
        </div>
      </div>
    </div>
  );
}
