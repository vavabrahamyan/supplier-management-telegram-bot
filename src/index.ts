import 'dotenv/config';
import { createBot } from './bot/bot.ts';
import { loadConfig } from './config/config.ts';
import { createLogger } from './utils/logger.ts';
import { openDatabase } from './db/database.ts';
import { NoteRepository } from './features/notes/note.repository.ts';
import { WaitingRepository } from './features/waiting/waiting.repository.ts';
import { OrderRepository } from './features/orders/order.repository.ts';
import { SupplierRepository } from './features/suppliers/supplier.repository.ts';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const db = openDatabase(config.databasePath);
  const bot = createBot(config, logger, new SupplierRepository(db), new OrderRepository(db), new WaitingRepository(db), new NoteRepository(db));
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
      db.close();
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  logger.info('Bot', 'Starting application');
  try {
    await bot.telegram.setMyCommands([{ command: 'start', description: 'Մատակարարներ' }, { command: 'new', description: 'Գլխավոր էջ' }, { command: 'addsupplier', description: 'Ավելացնել մատակարար' }, { command: 'cancel', description: 'Չեղարկել' }]);
    await bot.launch();
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    db.close();
  }
}

main().catch((error: unknown) => {
  // Config errors are authored locally; Telegram and network errors can contain the token.
  const message = error instanceof Error && /^(BOT_TOKEN|ALLOWED_TELEGRAM_USERNAMES|TIMEZONE|LOG_LEVEL) (is required|must be)/.test(error.message)
    ? error.message : 'Application failed to start';
  createLogger('error').error('Startup', message);
  process.exitCode = 1;
});
