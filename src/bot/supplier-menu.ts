import { randomBytes } from 'node:crypto';
import { Markup, type Context, type Telegraf } from 'telegraf';
import type { SupplierRepository } from '../features/suppliers/supplier.repository.ts';
import type { Supplier } from '../features/suppliers/supplier.types.ts';
import { text } from '../texts/suppliers.ts';
import type { Interaction, Screen, SupplierField } from './supplier-menu.types.ts';

const PAGE_SIZE = 6;
const token = () => randomBytes(6).toString('hex');
const callback = (state: Interaction, action: string) => `sup:${state.token}:${action}`;
const days = ['երկուշաբթի', 'երեքշաբթի', 'չորեքշաբթի', 'հինգշաբթի', 'ուրբաթ', 'շաբաթ', 'կիրակի'];
const weekdays = ['Ամեն երկուշաբթի', 'Ամեն երեքշաբթի', 'Ամեն չորեքշաբթի', 'Ամեն հինգշաբթի', 'Ամեն ուրբաթ', 'Ամեն շաբաթ', 'Ամեն կիրակի'];
const prompts: Record<SupplierField, string> = { name: 'Մուտքագրեք նոր անվանումը։', phone: 'Մուտքագրեք նոր հեռախոսահամար(ներ)', website: 'Մուտքագրեք նոր կայք', address: 'Մուտքագրեք նոր հասցեն։', productTypes: 'Ընտրեք ապրանքատեսակը։', orderDays: 'Ընտրեք պատվերի օրերը։', deliveryDays: 'Ընտրեք առաքման օրերը։', workingHours: 'Մուտքագրեք նոր աշխատանքային ժամերը՝ ԺԺ:ՐՐ-ԺԺ:ՐՐ։', paymentTerms: 'Ընտրեք վճարման եղանակը։', generalInformation: 'Մուտքագրեք նոր ընդհանուր տեղեկությունը։' };
const details = ['phone', 'website', 'address', 'productTypes', 'orderDays', 'deliveryDays', 'workingHours', 'paymentTerms', 'generalInformation'] as const;

export function registerSupplierMenu(bot: Telegraf, repository: SupplierRepository): void {
  const sessions = new Map<string, Interaction>();
  const sessionKey = (ctx: Context) => `${ctx.chat!.id}:${ctx.from!.id}`;
  const list = (query?: string) => query === undefined ? repository.listActive() : repository.searchByName(query);
  const fields: readonly SupplierField[] = ['name', ...details];
  const workspace = (screen: { id: number; page: number; query?: string }): Screen => ({ kind: 'workspace', id: screen.id, page: screen.page, query: screen.query });
  async function render(ctx: Context, screen: Screen, edit = false, prefix = ''): Promise<void> {
    const state: Interaction = { screen, token: token() };
    let message: string;
    let boldName: string | undefined;
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
    } else if ('id' in screen) {
      const supplier = repository.getById(screen.id);
      if (!supplier || supplier.archived) { await render(ctx, { kind: 'list', page: 0 }, edit, `${text.missing}\n\n`); return; }
      if (screen.kind === 'workspace') {
        const information = details.flatMap((field) => supplier[field] ? [`${text[field]}: ${supplier[field]}`] : []).join('\n');
        message = supplier.name + (information ? `\n\n${information}` : '');
        boldName = supplier.name;
        buttons = [[Markup.button.callback(text.information, callback(state, 'info')), Markup.button.callback(text.archive, callback(state, 'archive'))], [Markup.button.callback(text.back, callback(state, 'back'))]];
      } else if (screen.kind === 'information') {
        message = `${supplier.name}\n\n${details.map((field) => `${text[field]}: ${supplier[field] || '—'}`).join('\n')}`;
        boldName = supplier.name;
        buttons = fields.map((field) => [Markup.button.callback(`${text.edit} ${text[field]}`, callback(state, `field:${field}`))]);
        buttons.push([Markup.button.callback(text.back, callback(state, 'workspace'))]);
      } else if (screen.kind === 'edit') {
        message = screen.mode === 'customCategory' ? text.categoryPrompt : screen.intervalValue ? text.startDay : screen.mode ? text.intervalPrompt : prompts[screen.field];
        if (screen.intervalValue && (screen.mode === 'intervalDays' || screen.mode === 'intervalWeeks')) buttons.push(...days.map((day, index) => [Markup.button.callback(day, callback(state, `start:${index}`))]));
        if (!screen.mode && (screen.field === 'orderDays' || screen.field === 'deliveryDays')) {
          buttons.push(...weekdays.map((day, index) => [Markup.button.callback(day, callback(state, `day:${index}`))]));
          buttons.push([Markup.button.callback(text.intervalDays, callback(state, 'intervalDays')), Markup.button.callback(text.intervalWeeks, callback(state, 'intervalWeeks'))]);
        }
        if (!screen.mode && screen.field === 'paymentTerms') buttons.push([Markup.button.callback(text.cash, callback(state, 'payment:cash')), Markup.button.callback(text.transfer, callback(state, 'payment:transfer')), Markup.button.callback(text.hybrid, callback(state, 'payment:hybrid'))]);
        if (!screen.mode && screen.field === 'productTypes') {
          buttons.push(...repository.listCategories().map((category) => [Markup.button.callback(category.name.slice(0, 100), callback(state, `category:${category.id}`))]));
          buttons.push([Markup.button.callback(text.customCategory, callback(state, 'customCategory'))]);
        }
        if (screen.field !== 'name') buttons.push([Markup.button.callback(text.clear, callback(state, 'clear'))]);
        buttons.push([Markup.button.callback(text.cancel, callback(state, 'info'))]);
      } else {
        message = `${supplier.name}\n\n${text.archivePrompt}`;
        boldName = supplier.name;
        buttons = [[Markup.button.callback(text.confirmArchive, callback(state, 'confirm')), Markup.button.callback(text.cancel, callback(state, 'workspace'))]];
      }
    } else {
      message = screen.kind === 'add' ? text.addPrompt : text.searchPrompt;
      buttons = [[Markup.button.callback(text.cancel, callback(state, 'home'))]];
    }
    const options = { ...Markup.inlineKeyboard(buttons), ...(boldName ? { entities: [{ type: 'bold' as const, offset: prefix.length, length: boldName.length }] } : {}) };
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
  bot.on('callback_query', async (ctx, nextHandler) => {
    const incoming = ctx.callbackQuery;
    if (!('data' in incoming) || (!incoming.data.startsWith('sup:') && !/^[a-f0-9]{12}:/.test(incoming.data))) return nextHandler();
    if (!ctx.chat || !ctx.from) { await ctx.answerCbQuery(text.expired); return; }
    const state = sessions.get(sessionKey(ctx));
    const query = ctx.callbackQuery;
    if (!('data' in query) || !state || !query.message || query.message.message_id !== state.messageId || !query.data.startsWith(`sup:${state.token}:`)) {
      await ctx.answerCbQuery(text.expired); return;
    }
    const action = query.data.slice(state.token.length + 5);
    const screen = state.screen;
    let next: Screen | undefined;
    let prefix = '';
    if ('id' in screen) {
      const current = repository.getById(screen.id);
      if (!current || current.archived) {
        sessions.delete(sessionKey(ctx));
        await ctx.answerCbQuery(text.expired);
        await render(ctx, { kind: 'list', page: 0 }, true, `${text.missing}\n\n`);
        return;
      }
    }
    if (action === 'home') next = { kind: 'list', page: 0 };
    else if (action === 'add' && screen.kind === 'list' && (screen.query === undefined || list(screen.query).length === 0)) next = { kind: 'add' };
    else if (action === 'search' && screen.kind === 'list') next = { kind: 'search' };
    else if (action === 'info' && (screen.kind === 'workspace' || screen.kind === 'edit')) next = { ...screen, kind: 'information' };
    else if (action === 'workspace' && (screen.kind === 'information' || screen.kind === 'confirmArchive')) next = workspace(screen);
    else if (action === 'archive' && screen.kind === 'workspace') next = { ...screen, kind: 'confirmArchive' };
    else if (action === 'confirm' && screen.kind === 'confirmArchive') { repository.archive(screen.id); next = { kind: 'list', page: 0 }; prefix = `${text.archived}\n\n`; }
    else if (action.startsWith('field:') && screen.kind === 'information' && fields.includes(action.slice(6) as SupplierField)) next = { ...screen, kind: 'edit', field: action.slice(6) as SupplierField, mode: undefined, intervalValue: undefined };
    else if (screen.kind === 'edit' && (screen.field === 'orderDays' || screen.field === 'deliveryDays') && !screen.mode && (action === 'intervalDays' || action === 'intervalWeeks')) next = { ...screen, mode: action };
    else if (screen.kind === 'edit' && (screen.field === 'orderDays' || screen.field === 'deliveryDays') && !screen.mode && /^day:[0-6]$/.test(action)) { repository.update(screen.id, { [screen.field]: weekdays[Number(action.slice(4))]! }); next = { ...screen, kind: 'information' }; prefix = `${text.saved}\n\n`; }
    else if (screen.kind === 'edit' && (screen.field === 'orderDays' || screen.field === 'deliveryDays') && (screen.mode === 'intervalDays' || screen.mode === 'intervalWeeks') && screen.intervalValue && /^start:[0-6]$/.test(action)) {
      const unit = screen.mode === 'intervalDays' ? 'օրը' : 'շաբաթը';
      repository.update(screen.id, { [screen.field]: `Ամեն ${screen.intervalValue} ${unit}, սկսած ${days[Number(action.slice(6))]} օրվանից` });
      next = { ...screen, kind: 'information' }; prefix = `${text.saved}\n\n`;
    }
    else if (screen.kind === 'edit' && screen.field === 'paymentTerms' && !screen.mode && (action === 'payment:cash' || action === 'payment:transfer' || action === 'payment:hybrid')) { repository.update(screen.id, { paymentTerms: action === 'payment:cash' ? text.cash : action === 'payment:transfer' ? text.transfer : text.hybrid }); next = { ...screen, kind: 'information' }; prefix = `${text.saved}\n\n`; }
    else if (screen.kind === 'edit' && screen.field === 'productTypes' && !screen.mode && action === 'customCategory') next = { ...screen, mode: 'customCategory' };
    else if (screen.kind === 'edit' && screen.field === 'productTypes' && !screen.mode && /^category:[1-9]\d*$/.test(action)) {
      const category = repository.listCategories().find((item) => item.id === Number(action.slice(9)));
      if (category) { repository.setCategory(screen.id, category.name); next = { ...screen, kind: 'information' }; prefix = `${text.saved}\n\n`; }
    }
    else if (action === 'clear' && screen.kind === 'edit' && screen.field !== 'name') { repository.update(screen.id, { [screen.field]: null }); next = { ...screen, kind: 'information' }; prefix = `${text.saved}\n\n`; }
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
    await render(ctx, next, true, prefix);
  });
  bot.on('text', async (ctx, nextHandler) => {
    const state = sessions.get(sessionKey(ctx));
    if (!state || (state.screen.kind !== 'add' && state.screen.kind !== 'search' && state.screen.kind !== 'edit')) return nextHandler();
    if (ctx.message.text.startsWith('/')) return nextHandler();
    const value = ctx.message.text.trim();
    if (!value) { await ctx.reply(text.invalid); return; }
    if (state.screen.kind === 'search') {
      sessions.delete(sessionKey(ctx));
      await render(ctx, { kind: 'list', page: 0, query: value });
      return;
    }
    if (state.screen.kind === 'edit') {
      const screen = state.screen;
      const current = repository.getById(screen.id);
      if (!current || current.archived) { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'list', page: 0 }, false, `${text.missing}\n\n`); return; }
      if (screen.field === 'phone' && !value.split(',').every((phone) => /^(?:0\d{8}|\+\d{11})$/.test(phone.trim()))) { await ctx.reply(text.invalidPhone); return; }
      if (screen.field === 'website') {
        try { const url = new URL(value.includes('://') ? value : `https://${value}`); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || /\s/.test(value)) throw new Error(); }
        catch { await ctx.reply(text.invalidWebsite); return; }
      }
      if (screen.field === 'workingHours' && !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) { await ctx.reply(text.invalidHours); return; }
      if (screen.field === 'orderDays' || screen.field === 'deliveryDays') {
        if ((screen.mode !== 'intervalDays' && screen.mode !== 'intervalWeeks') || screen.intervalValue) { await ctx.reply(text.choose); return; }
        if (!/^[1-9]\d{0,5}$/.test(value)) { await ctx.reply(text.invalidInterval); return; }
        sessions.delete(sessionKey(ctx));
        await render(ctx, { ...screen, intervalValue: value });
        return;
      }
      if (screen.field === 'paymentTerms') { await ctx.reply(text.choose); return; }
      if (screen.field === 'productTypes' && screen.mode !== 'customCategory') { await ctx.reply(text.choose); return; }
      const storedValue = screen.mode === 'intervalDays' ? `Ամեն ${value} օրը` : screen.mode === 'intervalWeeks' ? `Ամեն ${value} շաբաթը` : value;
      try { if (screen.field === 'productTypes') repository.setCategory(screen.id, storedValue); else repository.update(screen.id, { [screen.field]: storedValue }); }
      catch (error) {
        if (error instanceof Error && 'errcode' in error && error.errcode === 2067) { await ctx.reply(repository.findByName(value)?.archived ? text.duplicateArchived : text.duplicate); return; }
        throw error;
      }
      sessions.delete(sessionKey(ctx));
      await render(ctx, { ...screen, kind: 'information' }, false, `${text.saved}\n\n`);
      return;
    }
    let supplier: Supplier;
    try { supplier = repository.create({ name: value }); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR' && 'errcode' in error && error.errcode === 2067) { await ctx.reply(repository.findByName(value)?.archived ? text.duplicateArchived : text.duplicate); return; }
      throw error;
    }
    sessions.delete(sessionKey(ctx));
    await render(ctx, { kind: 'workspace', id: supplier.id, page: 0 }, false, `${text.success}\n\n`);
  });
}
