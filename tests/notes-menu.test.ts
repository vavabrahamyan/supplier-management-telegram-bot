import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';
import { OrderRepository } from '../src/features/orders/order.repository.ts';
import { WaitingRepository } from '../src/features/waiting/waiting.repository.ts';
import { NoteRepository } from '../src/features/notes/note.repository.ts';
import { createBot } from '../src/bot/bot.ts';
import { loadConfig } from '../src/config/config.ts';
import { createLogger } from '../src/utils/logger.ts';

test('note menu supports add, copy, cancel, completion and stale protection', async () => {
  const db = openDatabase(':memory:'); const suppliers = new SupplierRepository(db); const supplier = suppliers.create({name: 'Ա & <😀>'}); const notes = new NoteRepository(db);
  const bot = createBot(loadConfig({ BOT_TOKEN: 'fake', ALLOWED_TELEGRAM_USERNAMES: 'Alice' }), createLogger('error'), suppliers, new OrderRepository(db), new WaitingRepository(db), notes);
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  const calls: {method: string; payload: any}[] = []; const proto = Object.getPrototypeOf(bot.telegram) as typeof bot.telegram; const original = proto.callApi;
  let msg = 10, update = 0;
  proto.callApi = (async (method: string, payload: any) => { calls.push({method, payload}); return method === 'sendMessage' ? {message_id: ++msg} : true; }) as typeof bot.telegram.callApi;
  const chat = { id: 7, type: 'private' as const }; const from = { id: 7, is_bot: false, first_name: 'User', username: 'Alice' };
  const send = async (value: string) => bot.handleUpdate({ update_id: ++update, message: { message_id: update, date: 0, chat, from, text: value, ...(value.startsWith('/') ? { entities: [{type: 'bot_command' as const, offset: 0, length: value.length}] } : {}) } });
  const latest = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1)!.payload;
  const button = (label: string) => latest().reply_markup.inline_keyboard.flat().find((b: any) => b.text === label)?.callback_data as string;
  const click = async (data: string) => bot.handleUpdate({ update_id: ++update, callback_query: { id: String(update), from, chat_instance: 'x', message: {message_id: msg, date: 0, chat}, data } });
  try {
    await send('/start'); await click(button('Ա & <😀>')); await click(button('📝 Նշումներ (չկա)'));
    assert.match(latest().text, /Ակտիվ նշում չկա/);
    await click(button('➕ Ավելացնել տեքստ')); await send('First');
    assert.equal(latest().reply_markup.inline_keyboard.flat().find((b: any) => b.copy_text)?.copy_text.text, 'First');
    await click(button('➕ Ավելացնել տեքստ')); await send('Second'); assert.equal(notes.active(supplier.id)?.text, 'First\nSecond');
    await click(button('✏️ Խմբագրել նշումը')); await click(button('❌ Չեղարկել')); assert.equal(notes.active(supplier.id)?.text, 'First\nSecond');
    await click(button('✏️ Խմբագրել նշումը')); await send('😀'.repeat(1100));
    await click(button('📋 Պատճենել')); let copied = latest().text.slice(latest().entities.at(-1).offset, latest().entities.at(-1).offset + latest().entities.at(-1).length);
    await click(button('➡️')); copied += latest().text.slice(latest().entities.at(-1).offset, latest().entities.at(-1).offset + latest().entities.at(-1).length);
    assert.equal(copied, '😀'.repeat(1100));
    await click(button('⬅️ Հետ')); await click(button('✅ Ավարտել նշումը'));
    const confirm = button('✅ Ավարտել'); await click(confirm); assert.equal(notes.active(supplier.id), undefined);
    await click(confirm); assert.match(calls.at(-1)?.payload.text, /ակտիվ չէ/);
    assert.ok(db.prepare('SELECT completed_at FROM supplier_notes').get()?.completed_at);
  } finally { proto.callApi = original; db.close(); }
});
