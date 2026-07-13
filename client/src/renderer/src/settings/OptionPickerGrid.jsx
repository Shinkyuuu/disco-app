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

// Reusable horizontal, wrapping list of preview tiles for a single-select
// setting (e.g. chat font, chat border style). Adding an option to the
// caller's `options` array is the only change needed to grow the list - this
// component never needs to change.
export default function OptionPickerGrid({
  options,
  selectedId,
  onSelect,
  renderPreview,
  tileStyle
}) {
  return (
    <div className="option-picker-grid">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={
            option.id === selectedId
              ? 'option-picker-tile option-picker-tile--active'
              : 'option-picker-tile'
          }
          style={tileStyle ? tileStyle(option) : undefined}
          onClick={() => onSelect(option.id)}
        >
          {renderPreview(option)}
        </button>
      ))}
    </div>
  )
}
