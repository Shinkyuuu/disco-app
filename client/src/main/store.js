import Store from 'electron-store';

export const store = new Store({
  defaults: {
    serverAddress: 'disco.schemainit.com',
    avatarMode: 'discord',
    avatarSize: 'small',
    chatSize: 'medium',
    chatOpacity: 1,
    chatCollapsed: false,
    chatFontFamily: 'plus-jakarta-sans',
    chatBorderStyle: 'hard',
    chatWindowWidth: 480,
    chatWindowPanelHeight: 324,
    sessionToken: null,
    loggedInUserId: null,
    defaultProfiles: Array.from({ length: 10 }, () => ({ usernameColor: null, chatColor: null })),
    friendProfiles: {},
  },
});
