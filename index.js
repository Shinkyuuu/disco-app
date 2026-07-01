import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, Events } from 'discord.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_SERVER_ID } = process.env;

const commands = [
  { name: 'ping', description: 'Replies with Pong!' },
];

const rest = new REST().setToken(DISCORD_BOT_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_SERVER_ID),
  { body: commands },
);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});

client.login(DISCORD_BOT_TOKEN);
