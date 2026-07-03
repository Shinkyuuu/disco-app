import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
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
import WebSocket, { WebSocketServer } from 'ws';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_SERVER_ID, DEEPGRAM_API_KEY, PORT } = process.env;

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3';

const PORT_NUMBER = PORT || 3000;
const OVERLAY_HTML = fs.readFileSync('overlay.html');

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(OVERLAY_HTML);
});

const gatewayClients = new Set();
const gateway = new WebSocketServer({ server: httpServer });

gateway.on('connection', (ws) => {
  gatewayClients.add(ws);
  ws.on('close', () => gatewayClients.delete(ws));
});

httpServer.listen(PORT_NUMBER, () => {
  console.log(`Caption overlay available at http://localhost:${PORT_NUMBER}`);
});

function broadcastTranscript(event) {
  const payload = JSON.stringify(event);
  for (const client of gatewayClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

const commands = [
  { name: 'ping', description: 'Replies with Pong!' },
  {
    name: 'captions',
    description: 'Manage live captions for this voice channel',
    options: [
      {
        name: 'start',
        description: 'Join your voice channel and start live captions',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'stop',
        description: 'Stop captions and leave the voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
];

const rest = new REST().setToken(DISCORD_BOT_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_SERVER_ID),
  { body: commands },
);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

async function resolveSpeaker(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
  return { username: member.displayName, avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }) };
}

// key: `${guildId}:${userId}` -> { opusStream, dgSocket } | null (reserved while resolving speaker)
const activeStreams = new Map();

async function startTranscribing(guildId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;
  activeStreams.set(key, null);

  const speaker = await resolveSpeaker(guildId, userId);

  // /captions stop may have run while the attribution lookup above was in flight.
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
    broadcastTranscript({
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
    await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    return;
  }

  await interaction.reply(
    `Joining **${channel.name}** — open the overlay at http://localhost:${PORT_NUMBER} to see captions.`,
  );

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  connection.receiver.speaking.on('start', (userId) => {
    startTranscribing(channel.guild.id, connection, userId);
  });
}

async function handleCaptionsStop(interaction) {
  const connection = getVoiceConnection(interaction.guild.id);
  if (!connection) {
    await interaction.reply({ content: 'Not currently in a voice channel.', ephemeral: true });
    return;
  }

  stopTranscribing(interaction.guild.id);
  connection.destroy();
  await interaction.reply('Captions stopped, left the voice channel.');
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  } else if (interaction.commandName === 'captions') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'start') {
      await handleCaptionsStart(interaction);
    } else if (subcommand === 'stop') {
      await handleCaptionsStop(interaction);
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
