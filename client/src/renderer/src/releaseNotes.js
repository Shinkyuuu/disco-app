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

// Hand-maintained changelog shown on the in-app Release Notes page, newest
// first. Add an entry here alongside every client/package.json version bump
// (see CLAUDE.md's "Client App Version" section). `version` has no leading
// "v" (matches settings.appVersion); `date` is ISO 8601 ("YYYY-MM-DD").
//
// Each item in `changes` is either a plain string, or an object with `text`
// plus a `sub` array of nested bullet strings, for when a change needs
// supporting detail:
//   changes: [
//     'Top-level change',
//     { text: 'Another change', sub: ['Nested detail', 'Another detail'] },
//   ]
export const RELEASE_NOTES = [
  {
    version: '1.1.1 - Latest',
    date: '2026-07-19',
    changes: [
      'Added "Release Notes" page', 
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-19',
    changes: [
      'Shifted all current avatar sizes down in chat overlay', 
      'Added X-Large avatar size in chat overlay'
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-18',
    changes: [
      'Initial release!', 
      {
        text: 'Fixed tray icon context menu', 
        sub: [
          'Removed "Show Chat" option',
          'Added "Exit App" option'
        ]
      }
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-18',
    changes: [
      '"Snap-to-edge" and "Auto-width" settings muted while "Lock window" setting is active', 
      'Fixed chatbox autoscroll behavior',
      'Moved chat window from taskbar to tray icon in Windows',
      'Added Gifs and Frames (converted to gif) to speaking avatar settings for User, Friend overrides, and defaults'
    ],
  },
  {
    version: '0.3.2',
    date: '2026-07-16',
    changes: [
      {
        text: 'Added "Snap-to-edge" toggle in the dropdown menu', 
        sub: [
          'Chat window auto-snaps to nearest screen edge or taskbar',
        ]
      },
      'Fixed periodic "Reconnecting" message while in Disco session',
      'Added color indicators for currently enabled toggles in chat window dropdown menu'
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-16',
    changes: [
      'Fixed issue where reconnect error was shown in chat window after being idle for a few minutes',
      'Fixed issue where chat window could not be openned after reconnect issue above',
      'Fixed chatbox single pixel border being cut-off on some monitors',
      'Reduced sheep-to-text cutoff timeout from 5000ms to 2000ms',
      'Fixed scrolling behavior in chatbox',
      'Fixed automatic updates being locked behind beta builds op-in toggle in settings' 
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-16',
    changes: [
      'Adjusted visual style for engire application',
      'Re-vamped visuals for dropdown menu in chat window',
      'Sorted and categoriexed settings in chat window dropdown menu',
      'Fixed button alignment issue in default avatars in profile settings'
    ],
  },
  {
    version: '0.2.4',
    date: '2026-07-12',
    changes: [
      'Updated speech-to-text to newer model',
      'Added click through to locked mode',
      'Moved dropdown model in chat window to left side',
      'Fixed auto-update message type while installing updates',
      'Added installing message while installing app update',
      'In discord-avatar mode in chat window, fixed icon shadow clipping bottom of overlay while chatbox is hidden',
      'Fixed error-cursor icon after chat window is openned while in locked mode',
      'Added persistent chat window positioning between sessions'
    ],
  },
  {
    version: '0.2.3',
    date: '2026-07-12',
    changes: [
      'Updated UI for settings page and about page',
      'Updated default selection highlight from orange to indigo',
      'Added Nintendo-DS font to chatbox options',
      'Fixed discord login failing (stalling) indefinitely preventing app usage',
      'Fixed discord session tokens expiring every 4 hours after server restarts',
      'Added confirmation screen after discord login OAuth is successful'
    ],
  },
  {
    version: '0.2.2',
    date: '2026-07-12',
    changes: [
      'In discord avatar mode, the space between the top of discord avatars (icons) and the top of window has been reduced',
      'In discord avatar mode, the glow effect no longer clips with the edges of the window',
      'In discord avatar mode and while chatbox is collapsed, the glow effect no longer clips the bottom of the window border',
      'When the chat window is closed, it now closes the main window rather than minimizing it. When the exit button is pressed in the chat-window dropdown menu, the main window re-opens',
      'There is now a "Lock Window" button in the chat window dropdown menu that prevents interaction (resizing and moving) the chat-window. However, the dropdown menu button is still interactable',
      'Added "auto width" button to the chat window dropdown menu that forces the width of the chat window that forces the width of the window to align with the avatars above the chatbox',
      'Updated dropdown menu positioning to be fully visible when openned on the edges of a monitor. Now opens dynamically based on window position',
      'Friend IDs now have type-checking validation',
      'Fixed stuck-session bug where quickly leaving after joining session causes client to break',
      'Closing the connection now properly cancels any ongoing reconnect attempts',
      'Removed left-over unused variables',
      'Fixed typos',
      'Fixed occasional lag while in color picker in the settings page'
    ],
  },
  {
    version: '0.1.2',
    date: '2026-07-10',
    changes: [
      'Fixed executable not openning on click',
      'Fixed profile images not applying on selection'
    ],
  },
  {
    version: '0.1.1',
    date: '2026-07-10',
    changes: [
      'Updated images',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-10',
    changes: [
      'Initial app',
    ],
  },
];
