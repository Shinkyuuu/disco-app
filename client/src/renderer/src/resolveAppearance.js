// Pure mapping from a resolved profile + current mode/speaking state to concrete
// render values. No Electron dependency - unit-tested like backoff.js/protocolUrl.js.
export function resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile }) {
  const avatarSrc =
    avatarMode === 'discord'
      ? discordAvatarURL
      : (isSpeaking ? profile.avatarSpeaking ?? profile.avatarSilent : profile.avatarSilent) ?? discordAvatarURL;
  return {
    avatarSrc,
    usernameColor: profile.usernameColor ?? null,
    chatColor: profile.chatColor ?? null,
  };
}
