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
