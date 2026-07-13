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

import Store from 'electron-store';

export const store = new Store({
  defaults: {
    avatarMode: 'discord',
    avatarSize: 'small',
    chatSize: 'medium',
    chatOpacity: 1,
    chatCollapsed: false,
    chatLocked: false,
    chatAutoWidth: false,
    chatFontFamily: 'plus-jakarta-sans',
    chatBorderStyle: 'hard',
    betaUpdates: false,
    chatWindowWidth: 480,
    chatWindowPanelHeight: 324,
    chatWindowPosition: null,
    sessionToken: null,
    loggedInUserId: null,
    defaultProfiles: Array.from({ length: 10 }, () => ({ usernameColor: null, chatColor: null })),
    friendProfiles: {},
  },
});
