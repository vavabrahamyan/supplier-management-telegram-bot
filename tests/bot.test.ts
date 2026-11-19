import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot/bot.ts';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/utils/logger.ts';
import { openDatabase } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';

test('only authorized users receive the start response', async () => {
  const db = openDatabase(':memory:');
  const bot = createBot(loadConfig({ BOT_TOKEN: 'test-token', ALLOWED_TELEGRAM_USERNAMES: '@Alice' }), createLogger('error'), new SupplierRepository(db));
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  const replies: unknown[] = [];
  const prototype = Object.getPrototypeOf(bot.telegram) as typeof bot.telegram;
  const original = prototype.callApi;
  prototype.callApi = (async (_method: unknown, payload: unknown) => { replies.push(payload); return { message_id: 1 };  }) as typeof bot.telegram.callApi;
  const update = (id: number, username?: string) => ({ update_id: id, message: { message_id: 1, date: 0, chat: { id, type: 'private' as const }, from: { id, is_bot: false, first_name: 'User', username }, text: '/start', entities: [{ offset: 0, length: 6, type: 'bot_command' as const }] } });
  try {
    await bot.handleUpdate(update(456, 'other'));
    assert.equal(replies.length, 0);
    await bot.handleUpdate(update(789));
    assert.equal(replies.length, 0);
    await bot.handleUpdate(update(123, 'aLiCe'));
    assert.equal(replies.length, 1);
  } finally {
    prototype.callApi = original;
    db.close();
  }
});
