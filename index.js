import 'dotenv/config';
import { startGateway } from './gateway.js';
import { startBot } from './bot.js';

// Last-resort backstop: this is a multi-guild service, so letting one uncaught error
// or rejection anywhere take down every active session is worse than logging and
// continuing. Every known throw site should already be handled closer to its source -
// this only catches what those miss.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

startGateway();
await startBot();
