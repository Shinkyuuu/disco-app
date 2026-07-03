import Store from 'electron-store';

export const store = new Store({
  defaults: {
    serverAddress: 'localhost:3000',
    avatarMode: 'discord',
    sessionToken: null,
  },
});
