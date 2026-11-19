import type { LogLevel } from '../utils/logger.types.ts';

export interface Config {
  botToken: string;
  allowedTelegramUsernames: ReadonlySet<string>;
  timezone: string;
  databasePath: string;
  logLevel: LogLevel;
}
