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
import { broadcast, PORT_NUMBER } from './gateway.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_SERVER_ID, DEEPGRAM_API_KEY } = process.env;

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3';

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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  // member.presence is only populated for cached members once GuildPresences
  // is granted - a one-off REST guild.members.fetch(userId) lookup does not
  // include presence data, so the whole guild is fetched once up front here.
  const guild = readyClient.guilds.cache.get(DISCORD_SERVER_ID);
  if (guild) {
    try {
      await guild.members.fetch();
    } catch (err) {
      console.error('Failed to fetch guild members:', err);
    }
  }
});

async function resolveSpeaker(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
  return { username: member.displayName, avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }) };
}

// key: `${guildId}:${userId}` -> { opusStream, dgSocket } | null (reserved while resolving speaker)
const activeStreams = new Map();

let trackedChannel = null; // { guildId, channelId, ownerId } | null - single global session
let roster = []; // [{ speakerId, username, avatarURL }]

export function isUserInTrackedChannel(userId) {
  if (!trackedChannel) return false;
  const guild = client.guilds.cache.get(trackedChannel.guildId);
  return guild?.members.cache.get(userId)?.voice.channelId === trackedChannel.channelId;
}

export function getRoster() {
  return roster;
}

export function getUserProfile(userId) {
  const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
  const member = guild?.members.cache.get(userId);
  if (!member) return null;
  return {
    username: member.displayName,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
    discordStatus: member.presence?.status ?? 'offline',
    inTrackedChannel: isUserInTrackedChannel(userId),
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

let voiceStateListener = null;

async function startTranscribing(guildId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;
  activeStreams.set(key, null);

  const speaker = await resolveSpeaker(guildId, userId);

  // /disco leave may have run while the attribution lookup above was in flight.
  if (!activeStreams.has(key)) return;

  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
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
    const msg = JSON.parse(data.toString());
    const transcript = msg.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;
    console.log(`[${speaker.username}] ${msg.is_final ? 'final' : 'interim'}: ${transcript}`);
    broadcast({
      type: 'transcript',
      speakerId: userId,
      username: speaker.username,
      avatarURL: speaker.avatarURL,
      text: transcript,
      isFinal: msg.is_final,
    });
  });

  dgSocket.on('error', (err) => {
    console.error(`[${userId}] Deepgram error:`, err);
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
  });
  dgSocket.on('close', () => {
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
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
    await interaction.reply({ content: 'Invoker must be injoice channel.', ephemeral: true });
    return;
  }

  await interaction.reply(
    `Joining **${channel.name}**`,
  );

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  trackedChannel = { guildId: channel.guild.id, channelId: channel.id, ownerId: interaction.user.id };

  roster = buildRoster(channel);
  broadcast({ type: 'roster', members: roster });

  voiceStateListener = (oldState, newState) => {
    if (oldState.channelId !== trackedChannel.channelId && newState.channelId !== trackedChannel.channelId) return;
    const membershipChanged = oldState.channelId !== newState.channelId;
    if (membershipChanged && oldState.id === trackedChannel.ownerId && oldState.channelId === trackedChannel.channelId) {
      stopCaptions(trackedChannel.guildId);
      return;
    }
    const muteOrDeafChanged = oldState.mute !== newState.mute || oldState.deaf !== newState.deaf;
    if (!membershipChanged && !muteOrDeafChanged) return; // ignore e.g. video/stream toggles
    const trackedChannelObj = client.channels.cache.get(trackedChannel.channelId);
    if (!trackedChannelObj) return;
    roster = buildRoster(trackedChannelObj);
    broadcast({ type: 'roster', members: roster });
  };
  client.on(Events.VoiceStateUpdate, voiceStateListener);

  connection.receiver.speaking.on('start', (userId) => {
    broadcast({ type: 'speaking', speakerId: userId, isSpeaking: true });
    startTranscribing(channel.guild.id, connection, userId);
  });
  // SpeakingMap emits 'end' (not 'stop') ~100ms after a user's last audio packet.
  connection.receiver.speaking.on('end', (userId) => {
    broadcast({ type: 'speaking', speakerId: userId, isSpeaking: false });
  });
}

function stopCaptions(guildId) {
  const connection = getVoiceConnection(guildId);
  if (!connection) return;

  stopTranscribing(guildId);
  trackedChannel = null;
  roster = [];
  if (voiceStateListener) {
    client.off(Events.VoiceStateUpdate, voiceStateListener);
    voiceStateListener = null;
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
    Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_SERVER_ID),
    { body: commands },
  );
  await client.login(DISCORD_BOT_TOKEN);
}
