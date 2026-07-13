/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
          <div className="settings-field">
            Font
            <OptionPickerGrid
              options={FONT_OPTIONS}
              selectedId={settings.chatFontFamily}
              onSelect={(id) => onSettingsChange({ chatFontFamily: id }, true)}
              renderPreview={(option) => <span style={{ fontFamily: option.cssFontFamily }}>{option.label}</span>}
            />
          </div>
          <div className="settings-field">
            Border style
            <OptionPickerGrid
              options={BORDER_OPTIONS}
              selectedId={settings.chatBorderStyle}
              onSelect={(id) => onSettingsChange({ chatBorderStyle: id }, true)}
              renderPreview={() => null}
              tileStyle={borderTileStyle}
            />
          </div>
        </div>
      </section>
    </>
  );
}
