import 'dotenv/config';
import { startGateway } from './gateway.js';
import { startBot } from './bot.js';

startGateway();
await startBot();
