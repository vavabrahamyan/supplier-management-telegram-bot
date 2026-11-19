import 'dotenv/config';
import { createBot } from './bot/bot.ts';
import { loadConfig } from './config/config.ts';
import { createLogger } from './utils/logger.ts';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const bot = createBot(config, logger);
  // launch resolves when polling stops, so register signal handlers first.
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('Bot', `Received ${signal}; stopping`);
    try {
      bot.stop(signal);
    } catch {
      // Polling has not started yet; terminate without waiting for startup requests.
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  logger.info('Bot', 'Starting application');
  await bot.launch();
}

main().catch((error: unknown) => {
  // Config errors are authored locally; Telegram and network errors can contain the token.
  const message = error instanceof Error && /^(BOT_TOKEN|ALLOWED_TELEGRAM_USERNAMES|TIMEZONE|LOG_LEVEL) (is required|must be)/.test(error.message)
    ? error.message : 'Application failed to start';
  createLogger('error').error('Startup', message);
  process.exitCode = 1;
});
