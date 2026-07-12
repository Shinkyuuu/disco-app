import ProfileFieldsEditor from './ProfileFieldsEditor';
import { colorsOf } from './profileColors';

export default function DefaultSlotsSection({ profiles, onChange }) {
  async function update(mutate) {
    await mutate();
    onChange();
  }
  return (
    <>
      <h3 className="settings-heading">Default Slots (10)</h3>
      <section className="settings-section">
        <p className="settings-subtext">Assigned by join order to speakers without a friend profile.</p>
        <div className="slot-rows">
          {profiles.map((profile, slotIndex) => (
            <div key={slotIndex} className="slot-row">
              <span className="slot-number">{slotIndex + 1}</span>
              <ProfileFieldsEditor
                layout="row"
                profile={profile}
                onPickAvatar={(kind) => update(() => window.api.pickDefaultAvatarImage(slotIndex, kind))}
                onClearAvatar={(kind) => update(() => window.api.clearDefaultAvatarImage(slotIndex, kind))}
                onSetColor={(field, value) =>
                  update(() => window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: value }))
                }
                onClearColor={(field) =>
                  update(() => window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: null }))
                }
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
