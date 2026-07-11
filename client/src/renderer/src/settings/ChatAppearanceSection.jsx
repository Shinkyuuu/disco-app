import OptionPickerGrid from './OptionPickerGrid';
import { FONT_OPTIONS, BORDER_OPTIONS } from '../chatAppearanceOptions';

const BORDER_TILE_SIZE = 32;

function borderTileStyle(option) {
  return {
    width: BORDER_TILE_SIZE,
    height: BORDER_TILE_SIZE,
    padding: 0,
    borderWidth: `${option.borderWidth}px`,
    borderStyle: 'solid',
    borderColor: '#ffffff',
    borderRadius: `${option.borderRadius}px`,
  };
}

export default function ChatAppearanceSection({ settings, onSettingsChange }) {
  return (
    <>
      <h3 className="settings-heading">Chatbox Appearance</h3>
      <section className="settings-section">
        <div className="chat-appearance-fields">
          <label className="settings-field">
            Font
            <OptionPickerGrid
              options={FONT_OPTIONS}
              selectedId={settings.chatFontFamily}
              onSelect={(id) => onSettingsChange({ chatFontFamily: id }, true)}
              renderPreview={(option) => <span style={{ fontFamily: option.cssFontFamily }}>{option.label}</span>}
            />
          </label>
          <label className="settings-field">
            Border style
            <OptionPickerGrid
              options={BORDER_OPTIONS}
              selectedId={settings.chatBorderStyle}
              onSelect={(id) => onSettingsChange({ chatBorderStyle: id }, true)}
              renderPreview={() => null}
              tileStyle={borderTileStyle}
            />
          </label>
        </div>
      </section>
    </>
  );
}
