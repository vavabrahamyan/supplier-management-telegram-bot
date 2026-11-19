import { randomBytes } from 'node:crypto';
import { Markup, type Context, type Telegraf } from 'telegraf';
import type { SupplierRepository } from '../features/suppliers/supplier.repository.ts';
import type { Supplier } from '../features/suppliers/supplier.types.ts';
import { text } from '../texts/suppliers.ts';
import type { Interaction, Screen } from './supplier-menu.types.ts';

const PAGE_SIZE = 6;
const token = () => randomBytes(6).toString('hex');
const callback = (state: Interaction, action: string) => `${state.token}:${action}`;
const details = ['phone', 'website', 'address', 'productTypes', 'orderDays', 'deliveryDays', 'workingHours', 'paymentTerms', 'generalInformation'] as const;

export function registerSupplierMenu(bot: Telegraf, repository: SupplierRepository): void {
  const sessions = new Map<string, Interaction>();
  const sessionKey = (ctx: Context) => `${ctx.chat!.id}:${ctx.from!.id}`;
  const list = (query?: string) => query === undefined ? repository.listActive() : repository.searchByName(query);
  async function render(ctx: Context, screen: Screen, edit = false, prefix = ''): Promise<void> {
    const state: Interaction = { screen, token: token() };
    let message: string;
    let buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    if (screen.kind === 'list') {
      const suppliers = list(screen.query);
      const pages = Math.max(1, Math.ceil(suppliers.length / PAGE_SIZE));
      screen.page = Math.max(0, Math.min(screen.page, pages - 1));
      message = suppliers.length ? (screen.query === undefined ? text.menu : text.results) : (screen.query === undefined ? text.empty : text.noResults);
      buttons = suppliers.slice(screen.page * PAGE_SIZE, (screen.page + 1) * PAGE_SIZE).map((supplier) => [Markup.button.callback(supplier.name.slice(0, 100), callback(state, `s${supplier.id}`))]);
      const navigation = [];
      if (screen.page > 0) navigation.push(Markup.button.callback(text.previous, callback(state, `p${screen.page - 1}`)));
      if (screen.page + 1 < pages) navigation.push(Markup.button.callback(text.next, callback(state, `p${screen.page + 1}`)));
      if (navigation.length) buttons.push(navigation);
      if (screen.query === undefined) {
        const actions = [Markup.button.callback(text.add, callback(state, 'add'))];
        if (suppliers.length) actions.unshift(Markup.button.callback(text.search, callback(state, 'search')));
        buttons.push(actions);
      } else {
        if (!suppliers.length) buttons.push([Markup.button.callback(text.add, callback(state, 'add'))]);
        buttons.push([Markup.button.callback(text.back, callback(state, 'search')), Markup.button.callback(text.cancel, callback(state, 'home'))]);
      }
    } else if (screen.kind === 'workspace') {
      const supplier = repository.getById(screen.id);
      if (!supplier || supplier.archived) { await render(ctx, { kind: 'list', page: screen.page, query: screen.query }, edit, `${text.missing}\n\n`); return; }
      message = [supplier.name, ...details.flatMap((field) => supplier[field] ? [`${text[field]}: ${supplier[field]}`] : [])].join('\n');
      buttons = [[Markup.button.callback(text.back, callback(state, 'back'))]];
    } else {
      message = screen.kind === 'add' ? text.addPrompt : text.searchPrompt;
      buttons = [[Markup.button.callback(text.cancel, callback(state, 'home'))]];
    }
    const options = Markup.inlineKeyboard(buttons);
    if (edit && ctx.callbackQuery?.message && 'message_id' in ctx.callbackQuery.message) {
      await ctx.editMessageText(prefix + message, options);
      state.messageId = ctx.callbackQuery.message.message_id;
    } else {
      const sent = await ctx.reply(prefix + message, options);
      state.messageId = sent.message_id;
    }
    sessions.set(sessionKey(ctx), state);
  }
  bot.start(async (ctx) => { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'list', page: 0 }); });
  bot.command('new', async (ctx) => { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'list', page: 0 }); });
  bot.command('cancel', async (ctx) => { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'list', page: 0 }); });
  bot.command('addsupplier', async (ctx) => { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'add' }); });
  bot.on('callback_query', async (ctx) => {
    const state = sessions.get(sessionKey(ctx));
    const query = ctx.callbackQuery;
    if (!('data' in query) || !state || !query.message || query.message.message_id !== state.messageId || !query.data.startsWith(`${state.token}:`)) {
      await ctx.answerCbQuery(text.expired); return;
    }
    const action = query.data.slice(state.token.length + 1);
    const screen = state.screen;
    let next: Screen | undefined;
    if (action === 'home') next = { kind: 'list', page: 0 };
    else if (action === 'add' && screen.kind === 'list' && (screen.query === undefined || list(screen.query).length === 0)) next = { kind: 'add' };
    else if (action === 'search' && screen.kind === 'list') next = { kind: 'search' };
    else if (action === 'back' && screen.kind === 'workspace') next = { kind: 'list', page: screen.page, query: screen.query };
    else if (/^p\d+$/.test(action) && screen.kind === 'list') {
      const page = Number(action.slice(1));
      const count = list(screen.query).length;
      if (Number.isSafeInteger(page) && page < Math.ceil(count / PAGE_SIZE) && Math.abs(page - screen.page) === 1) next = { ...screen, page };
    } else if (/^s[1-9]\d*$/.test(action) && screen.kind === 'list') {
      const id = Number(action.slice(1));
      const supplier = list(screen.query).slice(screen.page * PAGE_SIZE, (screen.page + 1) * PAGE_SIZE).find((item) => item.id === id);
      if (supplier) next = { kind: 'workspace', id, page: screen.page, query: screen.query };
    }
    if (!next) { await ctx.answerCbQuery(text.expired); return; }
    // Invalidate immediately so simultaneous or repeated clicks cannot reuse the old screen.
    sessions.delete(sessionKey(ctx));
    await ctx.answerCbQuery();
    await render(ctx, next, true);
  });
  bot.on('text', async (ctx) => {
    const state = sessions.get(sessionKey(ctx));
    if (!state || (state.screen.kind !== 'add' && state.screen.kind !== 'search')) return;
    if (ctx.message.text.startsWith('/')) return;
    const value = ctx.message.text.trim();
    if (!value) { await ctx.reply(text.invalid); return; }
    if (state.screen.kind === 'search') {
      sessions.delete(sessionKey(ctx));
      await render(ctx, { kind: 'list', page: 0, query: value });
      return;
    }
    let supplier: Supplier;
    try { supplier = repository.create({ name: value }); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR' && 'errcode' in error && error.errcode === 2067) { await ctx.reply(text.duplicate); return; }
      throw error;
    }
    sessions.delete(sessionKey(ctx));
    await render(ctx, { kind: 'workspace', id: supplier.id, page: 0 }, false, `${text.success}\n\n`);
  });
}
