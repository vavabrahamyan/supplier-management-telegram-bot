import { Telegraf } from 'telegraf';
import type { Config } from '../config/config.types.ts';
import type { Logger } from '../utils/logger.types.ts';

export function createBot(config: Config, logger: Logger): Telegraf {
  const bot = new Telegraf(config.botToken);
  bot.use(async (ctx, next) => {
    if (!ctx.from?.username || !config.allowedTelegramUsernames.has(ctx.from.username.toLowerCase())) {
      logger.warn('Bot', 'Ignored an unauthorized update');
      return;
    }
    await next();
  });
  bot.start(async (ctx) => {
    await ctx.reply('Բարի գալուստ։ Բոտը դեռ մշակման փուլում է։');
  });
  bot.catch(() => {
    logger.error('Bot', 'An update could not be processed');
  });
  return bot;
}
