import type { Config } from './config.types.ts';
import type { LogLevel } from '../utils/logger.types.ts';

const levels: readonly string[] = ['debug', 'info', 'warn', 'error'];

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) throw new Error('BOT_TOKEN is required');

  const rawUsernames = env.ALLOWED_TELEGRAM_USERNAMES?.trim();
  if (!rawUsernames) throw new Error('ALLOWED_TELEGRAM_USERNAMES is required');
  const usernames = rawUsernames.split(',').map((name) => name.trim().replace(/^@/, ''));
  if (usernames.some((name) => !/^[a-zA-Z0-9_]{1,32}$/.test(name))) {
    throw new Error('ALLOWED_TELEGRAM_USERNAMES must contain comma-separated Telegram usernames');
  }

  const timezone = env.TIMEZONE?.trim() || 'Asia/Yerevan';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error('TIMEZONE must be a valid IANA time zone');
  }
  const logLevel = env.LOG_LEVEL?.trim() || 'info';
  if (!levels.includes(logLevel)) throw new Error('LOG_LEVEL must be debug, info, warn, or error');

  return {
    botToken,
    allowedTelegramUsernames: new Set(usernames.map((name) => name.toLowerCase())),
    timezone,
    databasePath: env.DATABASE_PATH?.trim() || './data/suppliers.sqlite',
    logLevel: logLevel as LogLevel,
  };
}
