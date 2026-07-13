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

// Pure config + lookup for chat overlay appearance settings. No Electron
// dependency - unit-tested like resolveAppearance.js. Adding a new font or
// border style is just a new entry in the arrays below (plus a bundled
// .ttf + @font-face rule in app.css for fonts) - no other code changes.

export const FONT_OPTIONS = [
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    cssFontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'determination',
    label: 'Determination',
    cssFontFamily: "'Determination', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'nintendo-ds',
    label: 'Nintendo DS',
    cssFontFamily: "'Nintendo DS', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
];

export const BORDER_OPTIONS = [
  { id: 'hard', label: 'Sharp', borderWidth: 5, borderRadius: 0 },
  { id: 'soft', label: 'Classic', borderWidth: 1, borderRadius: 10 },
];

export const DEFAULT_FONT_ID = 'plus-jakarta-sans';
export const DEFAULT_BORDER_ID = 'hard';

export function resolveFontOption(id) {
  return FONT_OPTIONS.find((option) => option.id === id) ?? FONT_OPTIONS.find((option) => option.id === DEFAULT_FONT_ID);
}

export function resolveBorderOption(id) {
  return (
    BORDER_OPTIONS.find((option) => option.id === id) ?? BORDER_OPTIONS.find((option) => option.id === DEFAULT_BORDER_ID)
  );
}
