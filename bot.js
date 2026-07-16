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
import { broadcastToSession, notifySessionEnded } from './gateway.js';
import {
  createSession,
  endSession,
  endSessionIfCurrent,
  getSession,
  setRoster,
  activeSessionCount,
} from './sessionRegistry.js';
import { avatarRegistry } from './avatarRegistry.js';

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

// v2/listen rejects a 'channels' query param outright (400 INVALID_QUERY_PARAMETER) -
// Flux only accepts mono audio, so it isn't a configurable value like on v1/listen.
// The decoder below still emits mono PCM to match what Flux expects on the wire.
const DEEPGRAM_URL = 'wss://api.deepgram.com/v2/listen?encoding=linear16&sample_rate=48000&model=flux-general-en';

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

// userId -> true while a background resolveAvatarUrls() call for them is in
// flight, so a burst of roster rebuilds (e.g. several VoiceStateUpdates in a
// row) doesn't kick off duplicate concurrent S3 lookups for the same user.
const pendingAvatarResolutions = new Set();

// buildRoster() below must stay synchronous (see the comment there) - this
// reads only the in-memory cache and, the first time a given user is seen
// unresolved (e.g. right after a server restart), kicks off a background
// lookup that re-broadcasts an updated roster once it completes.
function broadcastAvatarFields(member) {
  const cached = avatarRegistry.getCachedAvatarUrls(member.id);
  if (cached === undefined && !pendingAvatarResolutions.has(member.id)) {
    pendingAvatarResolutions.add(member.id);
    avatarRegistry.resolveAvatarUrls(member.id)
      .then(() => rebroadcastRosterIfLive(member.id))
      .catch((err) => console.error(`Failed to resolve broadcast avatar for ${member.id}:`, err))
      .finally(() => pendingAvatarResolutions.delete(member.id));
  }
  const fields = {};
  if (cached?.silentURL) fields.customAvatarSilentURL = cached.silentURL;
  if (cached?.speakingURL) fields.customAvatarSpeakingURL = cached.speakingURL;
  if (cached?.usernameColor) fields.usernameColor = cached.usernameColor;
  if (cached?.chatColor) fields.chatColor = cached.chatColor;
  return fields;
}

// Re-sends the roster for whichever guild's session userId currently belongs
// to, if any - used once a background avatar resolution (above) completes,
// so viewers see the broadcast avatar appear shortly after a restart instead
// of only on the next unrelated roster change.
export function rebroadcastRosterIfLive(userId) {
  const liveSession = getLiveSessionForUser(userId);
  if (!liveSession) return;
  const session = getSession(liveSession.guildId);
  if (!session) return;
  const channelObj = client.channels.cache.get(liveSession.channelId);
  if (!channelObj) return;
  const updatedRoster = buildRoster(channelObj);
  setRoster(liveSession.guildId, updatedRoster);
  broadcastToSession(liveSession.guildId, { type: 'roster', channelId: liveSession.channelId, members: updatedRoster });
}

// key: `${guildId}:${userId}` -> { guildId, opusStream, dgSocket, decoder }
const activeStreams = new Map();
// Pipelines whose opusStream has already ended but are still padding out silence to let
// Deepgram finalize the turn. Kept out of activeStreams so a user resuming speech during
// that window starts a fresh pipeline immediately instead of being blocked - but still
// tracked here so /disco leave (stopTranscribing) can find and tear them down too.
const windingDownStreams = new Set();

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
      ...broadcastAvatarFields(member),
      // .mute/.deaf combine self- and server- states (either counts)
      isMuted: member.voice.mute ?? false,
      isDeafened: member.voice.deaf ?? false,
    }));
}

async function startTranscribing(guildId, channelId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;

  // Subscribe immediately, synchronously, before any `await` below - @discordjs/voice
  // silently and permanently drops any packets for a userId with no registered
  // subscription (no buffering), so the async speaker-info lookup further down can't
  // be allowed to delay this or early audio is lost before it's ever captured.
  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
  const pcmStream = opusStream.pipe(decoder);

  // handshakeTimeout guards against a stalled (not outright refused) TCP/TLS handshake,
  // which would otherwise never emit 'open', 'error', or 'close' - leaking this entry
  // and permanently blocking this user from getting captions again.
  const dgSocket = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    handshakeTimeout: 10_000,
  });
  let dgOpen = false;
  let buffered = [];
  let speaker;
  let windingDown = false;
  let stopPadding = () => {};

  // Identity, not just key, so a stale pipeline's error/close can't delete a newer one's entry.
  const entry = { guildId, opusStream, dgSocket, decoder };
  activeStreams.set(key, entry);

  const releaseEntry = () => {
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
    windingDownStreams.delete(entry);
  };

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
    if (!speaker) return; // message arrived before speaker info resolved below
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.error(`[${userId}] Failed to parse Deepgram message:`, err);
      return;
    }
    // Flux sends fatal errors in-band on the still-open socket rather than as a
    // WebSocket close/error event, so without this they'd vanish silently.
    if (msg.type === 'Error') {
      console.error(`[${userId}] Deepgram Flux error:`, msg.code, msg.description);
      return;
    }
    // Only the wind-down phase (opusStream already ended) should close the socket on
    // EndOfTurn - during active speech a turn can end and a new one begin mid-stream.
    if (windingDown && msg.type === 'TurnInfo' && msg.event === 'EndOfTurn') {
      stopPadding();
      dgSocket.close();
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

  // Destroying opusStream/decoder here too (not just releasing the activeStreams entry)
  // matters if Deepgram drops the connection mid-utterance, while the user is still
  // talking: without this, a later speech resumption re-subscribes to @discordjs/voice
  // for a userId whose old, still-live opusStream it hands back unchanged (per its
  // dedup-by-userId behavior), stacking a second full set of listeners and a second
  // decoder onto the same stream - a zombie pipeline that keeps decoding and sending to
  // the already-dead socket indefinitely.
  dgSocket.on('error', (err) => {
    console.error(`[${userId}] Deepgram error:`, err);
    stopPadding();
    releaseEntry();
    opusStream.destroy();
    decoder.destroy();
  });
  dgSocket.on('close', () => {
    stopPadding();
    releaseEntry();
    opusStream.destroy();
    decoder.destroy();
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
    stopPadding();
    releaseEntry();
    dgSocket.close();
    decoder.destroy();
  });
  decoder.on('error', (err) => {
    console.error(`[${userId}] Opus decode error:`, err);
    stopPadding();
    releaseEntry();
    dgSocket.close();
    opusStream.destroy();
  });

  // Discord stops delivering any packets at all the instant the user goes quiet - but
  // Flux tracks turn/silence timing against the audio timeline it's fed, not wall-clock
  // time, so with no more bytes flowing its internal clock never advances and the
  // in-progress turn's transcript is silently discarded when the connection closes.
  // Feeding real silence PCM here lets Flux's own turn detection (or its eot_timeout_ms
  // fallback, 5s by default) actually finalize the turn before we close.
  const startPadding = () => {
    windingDown = true;
    const silenceFrame = Buffer.alloc(960 * 2); // 20ms of mono 48kHz linear16 silence
    const padInterval = setInterval(() => dgSocket.send(silenceFrame), 20);
    const giveUp = setTimeout(() => {
      stopPadding();
      dgSocket.close();
    }, 6000); // covers Flux's default 5s eot_timeout_ms plus margin
    stopPadding = () => {
      clearInterval(padInterval);
      clearTimeout(giveUp);
    };
  };

  opusStream.once('end', () => {
    // Free this user's slot immediately, before padding even starts - otherwise, since
    // the activeStreams entry isn't cleared until dgSocket eventually closes (up to 6s
    // later), a user resuming speech during that window hits the activeStreams.has(key)
    // guard above and their new speech is silently dropped: @discordjs/voice itself
    // would happily hand back a fresh subscription, but startTranscribing never gets
    // the chance to call it. Moved into windingDownStreams (not just dropped) so
    // /disco leave can still find and tear this connection down while it finishes.
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
    windingDownStreams.add(entry);

    // For a very short utterance, the Deepgram handshake may not have finished yet -
    // `buffered` (see the pcmStream 'data' handler above) already holds the entire
    // utterance's audio in that case, and the existing 'open' handler above flushes it
    // the moment the socket connects, so wait for that instead of abandoning it here.
    // If the socket never opens, its own 'error'/'close' handlers already clean up.
    if (dgOpen) startPadding();
    else dgSocket.once('open', startPadding);
  });

  try {
    speaker = await resolveSpeaker(guildId, userId);
  } catch (err) {
    // Release the reservation on failure (e.g. the user left the guild before this
    // resolved) so a later speaking event for this user isn't silently no-op'd forever.
    releaseEntry();
    stopPadding();
    opusStream.destroy();
    decoder.destroy();
    dgSocket.close();
    throw err;
  }
}

function stopTranscribing(guildId) {
  for (const [key, streams] of activeStreams) {
    if (key.startsWith(`${guildId}:`)) {
      streams?.opusStream.destroy();
      streams?.decoder?.destroy();
      streams?.dgSocket.close();
      activeStreams.delete(key);
    }
  }
  // Pipelines already past opusStream 'end' live here instead, mid-padding - still
  // need tearing down on /disco leave rather than left to finish their own 6s cap.
  for (const entry of windingDownStreams) {
    if (entry.guildId === guildId) {
      entry.opusStream.destroy();
      entry.decoder.destroy();
      entry.dgSocket.close();
      windingDownStreams.delete(entry);
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

    // VoiceConnection emits its own 'error' on networking failures, separate from the
    // discord.js Client's 'error' event handled above - left unlistened, Node's default
    // behavior throws on an unhandled 'error' event. Even with a process-level backstop
    // preventing a full crash, this guild's session would otherwise never get cleaned
    // up (streams, listeners, sessionRegistry entry), leaving it zombied until someone
    // manually runs /disco leave.
    connection.on('error', (err) => {
      console.error(`[${guildId}] Voice connection error:`, err);
      stopCaptions(guildId);
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
  // Not broadcastToSession: that filters recipients through each client's
  // CURRENT live voice-session status, which is exactly wrong here - when
  // this runs because the owner left the channel, Discord's voice-state
  // cache already reflects their departure by the time this listener fires,
  // so broadcastToSession would silently exclude the one client whose
  // departure just triggered this. notifySessionEnded instead reaches every
  // client authorized for this guild at connect time, regardless of
  // whether their live status has since changed.
  notifySessionEnded(guildId);
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
