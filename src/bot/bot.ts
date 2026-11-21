import { Telegraf } from 'telegraf';
import type { Config } from '../config/config.types.ts';
import type { Logger } from '../utils/logger.types.ts';
import type { SupplierRepository } from '../features/suppliers/supplier.repository.ts';
import type { OrderRepository } from '../features/orders/order.repository.ts';
import type { WaitingRepository } from '../features/waiting/waiting.repository.ts';
import type { NoteRepository } from '../features/notes/note.repository.ts';
import { registerSupplierMenu } from './supplier-menu.ts';

export function createBot(config: Config, logger: Logger, suppliers: SupplierRepository, orders: OrderRepository, waiting: WaitingRepository, notes: NoteRepository): Telegraf {
  const bot = new Telegraf(config.botToken);
  bot.use(async (ctx, next) => {
    if (!ctx.from?.username || !config.allowedTelegramUsernames.has(ctx.from.username.toLowerCase())) {
      logger.warn('Bot', 'Ignored an unauthorized update');
      return;
    }
    await next();
  });
  registerSupplierMenu(bot, suppliers, orders, waiting, notes);
  bot.catch(() => {
    logger.error('Bot', 'An update could not be processed');
  });
  return bot;
}
