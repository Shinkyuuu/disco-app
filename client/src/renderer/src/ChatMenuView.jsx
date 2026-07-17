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

import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

const SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Shared shape for the "Avatar size" and "Chat size" submenus below - a
// hover-to-open list of small/medium/large picking a persisted setting.
// Sub/SubTrigger manage their own open state (hover, keyboard ArrowRight/
// ArrowLeft) - no manual useState needed here anymore.
function SizeSubmenu({ label, value, onChange }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="window-menu-item">
        <span>{label}</span>
        <span className="window-menu-item-arrow">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          className="window-menu-submenu"
          side="right"
          align="start"
          sideOffset={0}
          avoidCollisions={false}
        >
          {SIZES.map(({ value: v, label: l }) => (
            <DropdownMenu.Item
              key={v}
              className={v === value ? 'window-menu-item window-menu-item--active' : 'window-menu-item'}
              onSelect={() => onChange(v)}
            >
              {l}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

// The ⋯ menu's actual content, rendered in its own small always-on-top popup
// window (see createChatMenuWindow in main/index.js) instead of inside the
// chat window - this reads/writes the same store-backed settings and pin
// state as ChatView, just over IPC from a separate renderer process, since
// there's no React tree to share props through across windows. `sections`
// (from the URL, set by WindowMenu when it opened this window) mirrors which
// items ChatView's current render supports - error screens open this with no
// sections at all, leaving just Exit.
//
// The popup window's existence IS the open state (nothing here ever calls
// setOpen(true) - there's no click that opens it), so Root is controlled
// with open permanently true; closing means window.close(), not a state
// transition. onOpenChange is the single funnel every Radix-driven close
// path (Escape, selecting an item, clicking outside Content) goes through.
// Trigger is an invisible, unclickable anchor (not a real button a user
// interacts with) placed at the window edge nearest the real ⋯ button, so
// Content's Popper side prop (driven by openDirection) reproduces "content
// flush against that edge" without the old flex-alignment CSS trick.
export default function ChatMenuView({ params }) {
  const sections = {
    avatarSize: params.has('avatarSize'),
    chatSize: params.has('chatSize'),
    opacity: params.has('opacity'),
    pin: params.has('pin'),
    collapse: params.has('collapse'),
    lock: params.has('lock'),
    autoWidth: params.has('autoWidth'),
    snapToEdge: params.has('snapToEdge'),
  };
  const openDirection = params.get('openDirection') === 'up' ? 'up' : 'down';

  const hasChatboxGroup = sections.avatarSize || sections.chatSize || sections.opacity || sections.collapse;
  const hasOverlayGroup = sections.pin || sections.lock || sections.autoWidth || sections.snapToEdge;

  const [settings, setSettings] = useState(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.isAlwaysOnTop().then(setPinned);
    return window.api.onSettingsChanged((partial) => {
      setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
    });
  }, []);

  if (!settings) return null;

  function changeSetting(partial) {
    setSettings((prev) => ({ ...prev, ...partial }));
    window.api.setSettings(partial);
  }

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    window.api.setAlwaysOnTop(next);
  }

  return (
    <div className="chat-menu-popup">
      <DropdownMenu.Root
        open
        onOpenChange={(next) => {
          if (!next) window.close();
        }}
      >
        <DropdownMenu.Trigger asChild>
          <span
            className={
              openDirection === 'up'
                ? 'window-menu-anchor window-menu-anchor--up'
                : 'window-menu-anchor window-menu-anchor--down'
            }
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="window-menu-dropdown"
            side={openDirection === 'up' ? 'top' : 'bottom'}
            align="start"
            sideOffset={0}
            avoidCollisions={false}
          >
            {hasChatboxGroup && (
              <>
                <DropdownMenu.Label className="window-menu-label">Chatbox</DropdownMenu.Label>
                {sections.avatarSize && (
                  <SizeSubmenu
                    label="Avatar size"
                    value={settings.avatarSize}
                    onChange={(avatarSize) => changeSetting({ avatarSize })}
                  />
                )}
                {sections.chatSize && (
                  <SizeSubmenu
                    label="Chat size"
                    value={settings.chatSize}
                    onChange={(chatSize) => changeSetting({ chatSize })}
                  />
                )}
                {sections.opacity && (
                  <div className="window-menu-slider-item">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={settings.chatOpacity ?? 1}
                      onChange={(e) => {
                        const chatOpacity = parseFloat(e.target.value);
                        setSettings((prev) => ({ ...prev, chatOpacity }));
                        window.api.setSettings({ chatOpacity });
                      }}
                    />
                  </div>
                )}
                {sections.collapse && (
                  <DropdownMenu.Item
                    className="window-menu-item"
                    onSelect={() => changeSetting({ chatCollapsed: !settings.chatCollapsed })}
                  >
                    {settings.chatCollapsed ? 'Show chat box' : 'Hide chat box'}
                  </DropdownMenu.Item>
                )}
              </>
            )}
            {hasChatboxGroup && hasOverlayGroup && <DropdownMenu.Separator className="window-menu-separator" />}
            {hasOverlayGroup && (
              <>
                <DropdownMenu.Label className="window-menu-label">Overlay</DropdownMenu.Label>
                {sections.pin && (
                  <DropdownMenu.Item className="window-menu-item" onSelect={togglePin}>
                    {pinned ? 'Unpin window' : 'Pin window'}
                  </DropdownMenu.Item>
                )}
                {sections.lock && (
                  <DropdownMenu.Item
                    className="window-menu-item"
                    onSelect={() => changeSetting({ chatLocked: !settings.chatLocked })}
                  >
                    {settings.chatLocked ? 'Unlock window' : 'Lock window'}
                  </DropdownMenu.Item>
                )}
                {sections.autoWidth && (
                  <DropdownMenu.Item
                    className="window-menu-item"
                    onSelect={() => changeSetting({ chatAutoWidth: !settings.chatAutoWidth })}
                  >
                    {settings.chatAutoWidth ? 'Disable auto width' : 'Enable auto width'}
                  </DropdownMenu.Item>
                )}
                {sections.snapToEdge && (
                  <DropdownMenu.Item
                    className="window-menu-item"
                    onSelect={() => changeSetting({ chatSnapToEdge: !settings.chatSnapToEdge })}
                  >
                    {settings.chatSnapToEdge ? 'Disable snap to edge' : 'Enable snap to edge'}
                  </DropdownMenu.Item>
                )}
              </>
            )}
            {(hasChatboxGroup || hasOverlayGroup) && <DropdownMenu.Separator className="window-menu-separator" />}
            <DropdownMenu.Label className="window-menu-label">General</DropdownMenu.Label>
            <DropdownMenu.Item className="window-menu-item" onSelect={() => window.api.closeChatWindow()}>
              Exit
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
