const sessions = new Map(); // guildId -> { channelId, ownerId, roster, voiceStateListener }

export function createSession(guildId, { channelId, ownerId, voiceStateListener }) {
  const session = { channelId, ownerId, roster: [], voiceStateListener };
  sessions.set(guildId, session);
  return session;
}

export function endSession(guildId) {
  const session = sessions.get(guildId);
  sessions.delete(guildId);
  return session;
}

// Compare-and-delete: only removes the guild's session if it's still the exact
// object passed in. Guards against a slow /disco join's error-recovery path (an
// entersState() timeout doesn't reject early just because the connection was
// destroyed by a concurrent /disco leave - see bot.js) tearing down a newer,
// unrelated session that has since taken this guildId's slot.
export function endSessionIfCurrent(guildId, expectedSession) {
  if (sessions.get(guildId) !== expectedSession) return null;
  sessions.delete(guildId);
  return expectedSession;
}

export function getSession(guildId) {
  return sessions.get(guildId);
}

export function setRoster(guildId, roster) {
  const session = sessions.get(guildId);
  if (session) session.roster = roster;
}

export function activeSessionCount() {
  return sessions.size;
}
