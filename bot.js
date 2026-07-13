import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  ApplicationCommandOptionType,
} from 'discord.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import prism from 'prism-media';
import WebSocket from 'ws';
import { broadcastToSession } from './gateway.js';
import {
  createSession,
  endSession,
  endSessionIfCurrent,
  getSession,
  setRoster,
  activeSessionCount,
} from './sessionRegistry.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DEEPGRAM_API_KEY } = process.env;

// A non-numeric MAX_ACTIVE_SESSIONS (e.g. an env-var typo) used to silently disable
// the session cap entirely: Number('garbage') is NaN, and `count >= NaN` is always
// false. Falling back to the same default of 5 keeps a bad env value from ever
// removing the cap outright.
export function resolveMaxActiveSessions(raw) {
  if (raw === undefined || raw === '') return 5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 5;
}

const MAX_ACTIVE_SESSIONS = resolveMaxActiveSessions(process.env.MAX_ACTIVE_SESSIONS);

// Flux only finalizes a turn's transcript on the EndOfTurn event - forwarding the
// intermediate Update events here would post the same growing utterance as separate
// chat lines, since the client treats every 'transcript' broadcast as an independent
// finalized line (see client/src/main/index.js's 'transcript' handler).
export function extractFluxTranscript(msg) {
  if (msg.type !== 'TurnInfo' || msg.event !== 'EndOfTurn') return null;
  return msg.transcript || null;
}

const DEEPGRAM_URL = 'wss://api.deepgram.com/v2/listen?encoding=linear16&sample_rate=48000&channels=1&model=flux-general-en';

const commands = [
  {
    name: 'disco',
    description: 'Manage live captions for this voice channel',
    options: [
      {
        name: 'join',
        description: 'Joins voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'leave',
        description: 'Leaves voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'ping',
        description: 'pong!',
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

// discord.js emits 'error' on shard/gateway failures; Node throws on an unhandled
// 'error' event and kills the whole process, so this must always have a listener.
client.on(Events.Error, (err) => {
  console.error('Discord client error:', err);
});

// member.presence is only populated for cached members once GuildPresences is granted,
// and a one-off REST guild.members.fetch(userId) lookup does not include presence data -
// so each guild's full member list is fetched once, the first time it's actually needed,
// rather than eagerly for every guild the bot happens to be invited to.
const fetchedGuilds = new Set();
async function ensureMembersFetched(guild) {
  if (fetchedGuilds.has(guild.id)) return;
  try {
    await guild.members.fetch();
    fetchedGuilds.add(guild.id);
  } catch (err) {
    console.error(`Failed to fetch members for guild ${guild.id}:`, err);
  }
}

async function resolveSpeaker(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
  return { username: member.displayName, avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }) };
}

// key: `${guildId}:${userId}` -> { opusStream, dgSocket } | null (reserved while resolving speaker)
const activeStreams = new Map();

// A Discord user can only be connected to one voice channel platform-wide at a time, so
// at most one guild will ever have a cached voice state for a given userId. This is the
// single source of truth both the gateway's connect-time auth gate and its per-broadcast
// filtering use to decide who is currently allowed to see a given guild's session.
export function getLiveSessionForUser(userId) {
  for (const guild of client.guilds.cache.values()) {
    const channelId = guild.voiceStates.cache.get(userId)?.channelId;
    if (channelId && getSession(guild.id)?.channelId === channelId) {
      return { guildId: guild.id, channelId };
    }
  }
  return null;
}

export async function getUserProfile(userId) {
  const liveSession = getLiveSessionForUser(userId);

  let guild = null;
  if (liveSession) {
    const liveGuild = client.guilds.cache.get(liveSession.guildId);
    if (liveGuild) {
      await ensureMembersFetched(liveGuild);
      if (liveGuild.members.cache.has(userId)) guild = liveGuild;
    }
  }

  if (!guild) {
    for (const candidate of client.guilds.cache.values()) {
      await ensureMembersFetched(candidate);
      if (candidate.members.cache.has(userId)) {
        guild = candidate;
        break;
      }
    }
  }

  const member = guild?.members.cache.get(userId);
  if (!member) return null;
  return {
    username: member.displayName,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
    discordStatus: member.presence?.status ?? 'offline',
    inTrackedChannel: !!liveSession,
  };
}

function buildRoster(channel) {
  return channel.members
    .filter((member) => !member.user.bot)
    .map((member) => ({
      speakerId: member.id,
      username: member.displayName,
      avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
      // .mute/.deaf combine self- and server- states (either counts)
      isMuted: member.voice.mute ?? false,
      isDeafened: member.voice.deaf ?? false,
    }));
}

async function startTranscribing(guildId, channelId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;
  activeStreams.set(key, null);

  let speaker;
  try {
    speaker = await resolveSpeaker(guildId, userId);
  } catch (err) {
    // Release the reservation on failure (e.g. the user left the guild before this
    // resolved) so a later speaking event for this user isn't silently no-op'd forever.
    activeStreams.delete(key);
    throw err;
  }

  // /disco leave may have run while the attribution lookup above was in flight.
  if (!activeStreams.has(key)) return;

  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
  const pcmStream = opusStream.pipe(decoder);

  const dgSocket = new WebSocket(DEEPGRAM_URL, { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });
  let dgOpen = false;
  let buffered = [];

  // Identity, not just key, so a stale pipeline's error/close can't delete a newer one's entry.
  const entry = { opusStream, dgSocket };

  dgSocket.on('open', () => {
    dgOpen = true;
    for (const chunk of buffered) dgSocket.send(chunk);
    buffered = [];
  });

  pcmStream.on('data', (chunk) => {
    if (dgOpen) dgSocket.send(chunk);
    else buffered.push(chunk);
  });

  dgSocket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error(`[${userId}] Failed to parse Deepgram message:`, err);
      return;
    }
    const transcript = extractFluxTranscript(msg);
    if (!transcript) return;
    broadcastToSession(guildId, {
      type: 'transcript',
      channelId,
      speakerId: userId,
      username: speaker.username,
      avatarURL: speaker.avatarURL,
      text: transcript,
    });
  });

  dgSocket.on('error', (err) => {
    console.error(`[${userId}] Deepgram error:`, err);
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
  });
  dgSocket.on('close', () => {
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
  });

  // Opus streams have no 'error' listener by default - Node throws and kills
  // the whole process (every guild's session, not just this one user) on an
  // unhandled stream error. A single malformed packet from Discord (network
  // jitter/loss) is enough to trigger this, so just end this one user's
  // pipeline instead of crashing the bot for everyone.
  // Destroying both ends (not just the one that errored) on either error keeps
  // opusStream from being handed back by receiver.subscribe() to a later speaking
  // event for this same user while orphaned - which would otherwise pile up repeat
  // 'error' listeners on the same long-lived stream instance.
  opusStream.on('error', (err) => {
    console.error(`[${userId}] Opus receive error:`, err);
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
    dgSocket.close();
    decoder.destroy();
  });
  decoder.on('error', (err) => {
    console.error(`[${userId}] Opus decode error:`, err);
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
    dgSocket.close();
    opusStream.destroy();
  });

  activeStreams.set(key, entry);

  opusStream.once('end', () => {
    if (dgOpen) {
      dgSocket.send(JSON.stringify({ type: 'CloseStream' }));
    } else {
      dgSocket.close();
    }
  });
}

function stopTranscribing(guildId) {
  for (const [key, streams] of activeStreams) {
    if (key.startsWith(`${guildId}:`)) {
      streams?.opusStream.destroy();
      streams?.dgSocket.close();
      activeStreams.delete(key);
    }
  }
}

async function handleCaptionsStart(interaction) {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply({ content: 'Invoker must be in a voice channel.', ephemeral: true });
    return;
  }

  const guildId = channel.guild.id;

  const existing = getSession(guildId);
  if (existing) {
    await interaction.reply({
      content: `This server already has an active session in <#${existing.channelId}>. Stop it first with \`/disco leave\`.`,
      ephemeral: true,
    });
    return;
  }

  if (activeSessionCount() >= MAX_ACTIVE_SESSIONS) {
    await interaction.reply({
      content: 'Disco is at capacity across all servers right now. Try again later.',
      ephemeral: true,
    });
    return;
  }

  // Reserve this guild's slot synchronously, before any `await` below, so a second
  // concurrent /disco join (in this guild, or racing the global cap) can't pass the
  // checks above before this one claims the slot. Tracked in `session` (reassigned
  // below once the real voiceStateListener is known) so the catch block's cleanup
  // can use endSessionIfCurrent - see the comment there for why a plain endSession
  // would be wrong.
  let session = createSession(guildId, { channelId: channel.id, ownerId: interaction.user.id, voiceStateListener: null });

  let connection;
  try {
    await interaction.reply(
      `Joining **${channel.name}**`,
    );

    await ensureMembersFetched(channel.guild);

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

    const roster = buildRoster(channel);

    const voiceStateListener = (oldState, newState) => {
      const session = getSession(guildId);
      if (!session) return;
      if (oldState.channelId !== session.channelId && newState.channelId !== session.channelId) return;
      const membershipChanged = oldState.channelId !== newState.channelId;
      if (membershipChanged && oldState.id === session.ownerId && oldState.channelId === session.channelId) {
        stopCaptions(guildId);
        return;
      }
      const muteOrDeafChanged = oldState.mute !== newState.mute || oldState.deaf !== newState.deaf;
      if (!membershipChanged && !muteOrDeafChanged) return; // ignore e.g. video/stream toggles
      const trackedChannelObj = client.channels.cache.get(session.channelId);
      if (!trackedChannelObj) return;
      const updatedRoster = buildRoster(trackedChannelObj);
      setRoster(guildId, updatedRoster);
      broadcastToSession(guildId, { type: 'roster', channelId: session.channelId, members: updatedRoster });
    };

    session = createSession(guildId, { channelId: channel.id, ownerId: interaction.user.id, voiceStateListener });
    setRoster(guildId, roster);
    broadcastToSession(guildId, { type: 'roster', channelId: channel.id, members: roster });

    client.on(Events.VoiceStateUpdate, voiceStateListener);

    connection.receiver.speaking.on('start', (userId) => {
      broadcastToSession(guildId, { type: 'speaking', channelId: channel.id, speakerId: userId, isSpeaking: true });
      // An unhandled rejection here (e.g. the member-fetch in resolveSpeaker failing)
      // would otherwise crash the whole process on Node's default unhandledRejection behavior.
      startTranscribing(guildId, channel.id, connection, userId).catch((err) => {
        console.error(`[${userId}] Failed to start transcribing:`, err);
      });
    });
    // SpeakingMap emits 'end' (not 'stop') ~100ms after a user's last audio packet.
    connection.receiver.speaking.on('end', (userId) => {
      broadcastToSession(guildId, { type: 'speaking', channelId: channel.id, speakerId: userId, isSpeaking: false });
    });
  } catch (err) {
    connection?.destroy();
    // Not a plain endSession(guildId): entersState() above doesn't reject early
    // just because `connection` was destroyed (e.g. by a concurrent /disco leave
    // racing this join before Ready) - it only resolves on Ready or times out.
    // If a fresh /disco join has since claimed guildId's slot while this one was
    // still waiting out that timeout, this call must not delete that newer,
    // unrelated session out from under it.
    endSessionIfCurrent(guildId, session);
    throw err;
  }
}

function stopCaptions(guildId) {
  const connection = getVoiceConnection(guildId);
  if (!connection) return;

  stopTranscribing(guildId);
  const session = endSession(guildId);
  if (session?.voiceStateListener) {
    client.off(Events.VoiceStateUpdate, session.voiceStateListener);
  }
  connection.destroy();
}

async function handleCaptionsStop(interaction) {
  if (!getVoiceConnection(interaction.guild.id)) {
    await interaction.reply({ content: 'Not currently in a voice channel.', ephemeral: true });
    return;
  }

  stopCaptions(interaction.guild.id);
  await interaction.reply('Listening stopped, left the voice channel.');
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'disco') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'join') {
      await handleCaptionsStart(interaction);
    } else if (subcommand === 'leave') {
      await handleCaptionsStop(interaction);
    } else if (subcommand === 'ping') {
      await interaction.reply('Pong!');
    }
  }
});

export async function startBot() {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationCommands(DISCORD_APPLICATION_ID),
    { body: commands },
  );
  await client.login(DISCORD_BOT_TOKEN);
}
