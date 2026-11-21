import { randomBytes } from 'node:crypto';
import { Markup, type Context, type Telegraf } from 'telegraf';
import { NoteChangedError, InvalidNoteError, type NoteRepository } from '../features/notes/note.repository.ts';
import { notePages } from '../features/notes/note.ts';
import { WaitingChangedError, OrderCapacityError, type WaitingRepository } from '../features/waiting/waiting.repository.ts';
import { OrderChangedError, type OrderRepository } from '../features/orders/order.repository.ts';
import { orderPages, parseOrderItems } from '../features/orders/order.ts';
import type { SupplierRepository } from '../features/suppliers/supplier.repository.ts';
import type { Supplier } from '../features/suppliers/supplier.types.ts';
import { addEntity, compactRows, type TextEntity } from '../utils/telegram-format.ts';
import { text } from '../texts/suppliers.ts';
import type { Interaction, Screen, SupplierField } from './supplier-menu.types.ts';

const PAGE_SIZE = 6;
const token = () => randomBytes(6).toString('hex');
const callback = (state: Interaction, action: string) => `sup:${state.token}:${action}`;
const days = ['երկուշաբթի', 'երեքշաբթի', 'չորեքշաբթի', 'հինգշաբթի', 'ուրբաթ', 'շաբաթ', 'կիրակի'];
const weekdays = ['Ամեն երկուշաբթի', 'Ամեն երեքշաբթի', 'Ամեն չորեքշաբթի', 'Ամեն հինգշաբթի', 'Ամեն ուրբաթ', 'Ամեն շաբաթ', 'Ամեն կիրակի'];
const prompts: Record<SupplierField, string> = { name: 'Մուտքագրեք նոր անվանումը։', phone: 'Մուտքագրեք նոր հեռախոսահամար(ներ)', website: 'Մուտքագրեք նոր կայք', address: 'Մուտքագրեք նոր հասցեն։', productTypes: 'Ընտրեք ապրանքատեսակը։', orderDays: 'Ընտրեք պատվերի օրերը։', deliveryDays: 'Ընտրեք առաքման օրերը։', workingHours: 'Մուտքագրեք նոր աշխատանքային ժամերը՝ ԺԺ:ՐՐ-ԺԺ:ՐՐ։', paymentTerms: 'Ընտրեք վճարման եղանակը։', generalInformation: 'Մուտքագրեք նոր ընդհանուր տեղեկությունը։' };
const details = ['phone', 'website', 'address', 'productTypes', 'orderDays', 'deliveryDays', 'workingHours', 'paymentTerms', 'generalInformation'] as const;

export function registerSupplierMenu(bot: Telegraf, repository: SupplierRepository, orders: OrderRepository, waiting: WaitingRepository, notes: NoteRepository): void {
  const sessions = new Map<string, Interaction>();
  const sessionKey = (ctx: Context) => `${ctx.chat!.id}:${ctx.from!.id}`;
  const list = (query?: string) => query === undefined ? repository.listActive() : repository.searchByName(query);
  const fields: readonly SupplierField[] = ['name', ...details];
  const workspace = (screen: { id: number; page: number; query?: string }): Screen => ({ kind: 'workspace', id: screen.id, page: screen.page, query: screen.query });
  async function render(ctx: Context, screen: Screen, edit = false, prefix = ''): Promise<void> {
    const state: Interaction = { screen, token: token() };
    let message: string;
    let boldName: string | undefined;
    let codeOffset: number | undefined;
    let codeLength = 0;
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
        buttons.push([Markup.button.callback(text.back, callback(state, 'search')), Markup.button.callback(text.home, callback(state, 'home'))]);
      }
    } else if ('id' in screen) {
      const supplier = repository.getById(screen.id);
      if (!supplier || supplier.archived) { await render(ctx, { kind: 'list', page: 0 }, edit, `${text.missing}\n\n`); return; }
      if (screen.kind === 'workspace') {
        const information = details.flatMap((field) => supplier[field] ? [`${text[field]}: ${supplier[field]}`] : []).join('\n');
        message = supplier.name + (information ? `\n\n${information}` : '');
        boldName = supplier.name;
        buttons = [[Markup.button.callback(`${text.order} (${orders.list(screen.id).length})`, callback(state, 'order')), Markup.button.callback(`${text.waiting} (${waiting.list(screen.id).length})`, callback(state, 'waiting'))], [Markup.button.callback(`${text.notes} (${notes.active(screen.id) ? text.noteActive : text.noteNone})`, callback(state, 'notes'))], [Markup.button.callback(text.information, callback(state, 'info')), Markup.button.callback(text.archive, callback(state, 'archive'))], [Markup.button.callback(text.back, callback(state, 'back'))]];
      } else if (screen.kind === 'note' || screen.kind === 'noteDone' || screen.kind === 'noteInput') {
        const note = notes.active(screen.id);
        boldName = supplier.name.slice(0, 200);
        if (screen.kind === 'note') {
          const pages = notePages(note?.text ?? '');
          screen.notePage = Math.max(0, Math.min(screen.notePage, Math.max(0, pages.length - 1)));
          const part = pages[screen.notePage];
          message = `${boldName}\n\n${text.notes}\n\n${screen.copying ? `${text.noteCopyHint}\n\n` : ''}${part ?? text.noteEmpty}`;
          if (screen.copying && part) { codeOffset = prefix.length + message.length - part.length; codeLength = part.length; }
          const nav = [];
          if (screen.notePage > 0) nav.push(Markup.button.callback(text.previous, callback(state, `np:${screen.notePage - 1}`)));
          if (screen.notePage + 1 < pages.length) nav.push(Markup.button.callback(text.next, callback(state, `np:${screen.notePage + 1}`)));
          if (nav.length) buttons.push(nav);
          buttons.push([Markup.button.callback(text.noteAdd, callback(state, 'noteAdd'))]);
          if (note) {
            if (note.text.length <= 256) buttons.push([{ text: text.noteCopy, copy_text: { text: note.text } } as unknown as ReturnType<typeof Markup.button.callback>]);
            else if (!screen.copying) buttons.push([Markup.button.callback(text.noteCopy, callback(state, 'noteCopy'))]);
            buttons.push([Markup.button.callback(text.noteEdit, callback(state, 'noteEdit'))], [Markup.button.callback(text.noteDone, callback(state, 'noteDone'))]);
          }
          buttons.push([Markup.button.callback(text.back, callback(state, screen.copying ? 'notesBack' : 'workspace'))]);
        } else if (screen.kind === 'noteDone') {
          message = `${boldName}\n\n${text.noteDonePrompt}`;
          buttons = [[Markup.button.callback(text.noteDoneConfirm, callback(state, 'noteComplete'))], [Markup.button.callback(text.cancel, callback(state, 'notesBack'))]];
        } else {
          message = `${boldName}\n\n${screen.operation === 'append' ? text.noteAppendPrompt : text.noteReplacePrompt}`;
          buttons = [[Markup.button.callback(text.cancel, callback(state, 'notesBack'))]];
        }
      } else if (screen.kind === 'waiting' || screen.kind === 'waitingRemove') {
        const items = waiting.list(screen.id);
        screen.waitingPage = Math.max(0, Math.min(screen.waitingPage, Math.max(0, Math.ceil(items.length / 10) - 1)));
        boldName = supplier.name.slice(0, 200);
        message = `${boldName}\n\n${screen.kind === 'waitingRemove' ? text.confirmRemoveWaiting : items.length ? `${text.waiting}\n${text.selected}: ${screen.selectedIds.length} / ${items.length}` : text.waitingEmpty}`;
        if (screen.kind === 'waitingRemove') {
          buttons = [[Markup.button.callback(text.confirmRemove, callback(state, 'wConfirmRemove')), Markup.button.callback(text.cancel, callback(state, 'wCancelRemove'))]];
        } else {
          const chosen = new Set(screen.selectedIds);
          buttons = items.slice(screen.waitingPage * 10, (screen.waitingPage + 1) * 10).map((item) => [Markup.button.callback(`${chosen.has(item.id) ? '✅' : '☐'} ${Array.from(item.text).slice(0, 70).join('')}`, callback(state, `wt:${item.id}`))]);
          const nav = [];
          if (screen.waitingPage > 0) nav.push(Markup.button.callback(text.previous, callback(state, `wp:${screen.waitingPage - 1}`)));
          if ((screen.waitingPage + 1) * 10 < items.length) nav.push(Markup.button.callback(text.next, callback(state, `wp:${screen.waitingPage + 1}`)));
          if (nav.length) buttons.push(nav);
          if (items.length) {
            buttons.push([Markup.button.callback(text.checkAll, callback(state, 'wAll')), Markup.button.callback(text.clearAll, callback(state, 'wNone'))]);
            buttons.push([Markup.button.callback(text.receive, callback(state, 'wReceive')), Markup.button.callback(text.returnOrder, callback(state, 'wReturn'))]);
            buttons.push([Markup.button.callback(text.removeWaiting, callback(state, 'wRemove'))]);
          }
          buttons.push([Markup.button.callback(screen.selectedIds.length ? text.cancel : text.backSupplier, callback(state, 'workspace'))]);
        }
      } else if (screen.kind === 'order') {
        const items = orders.list(screen.id).map((item) => item.text);
        const complete = items.join('\n');
        const pages = orderPages(items);
        screen.orderPage = Math.max(0, Math.min(screen.orderPage, Math.max(0, pages.length - 1)));
        const heading = `${supplier.name.slice(0, 200)}\n\n${text.order}`;
        boldName = supplier.name.slice(0, 200);
        const page = pages[screen.orderPage];
        message = `${heading}\n\n${screen.copying ? `${text.orderCopyHint}\n\n` : ''}${page || text.orderEmpty}`;
        if (screen.copying && page) { codeOffset = prefix.length + message.length - page.length; codeLength = page.length; }
        const nav = [];
        if (screen.orderPage > 0) nav.push(Markup.button.callback(text.previous, callback(state, `op:${screen.orderPage - 1}`)));
        if (screen.orderPage + 1 < pages.length) nav.push(Markup.button.callback(text.next, callback(state, `op:${screen.orderPage + 1}`)));
        if (nav.length) buttons.push(nav);
        if (items.length && !screen.copying) buttons.push([Markup.button.callback(text.orderConfirm, callback(state, 'checklist'))]);
        buttons.push([Markup.button.callback(text.orderAdd, callback(state, 'orderAdd')), Markup.button.callback(text.orderEdit, callback(state, 'orderEdit'))]);
        if (complete) {
          if (complete.length <= 256) {
            // Telegraf's bundled Telegram types predate Bot API's copy_text button.
            buttons.push([{ text: text.orderCopy, copy_text: { text: complete } } as unknown as ReturnType<typeof Markup.button.callback>]);
          } else if (!screen.copying) buttons.push([Markup.button.callback(text.orderCopy, callback(state, 'orderCopy'))]);
        }
        buttons.push([Markup.button.callback(text.back, callback(state, screen.copying ? 'order' : 'workspace'))]);
      } else if (screen.kind === 'checklist') {
        const items = orders.list(screen.id);
        screen.checkPage = Math.max(0, Math.min(screen.checkPage, Math.max(0, Math.ceil(items.length / 10) - 1)));
        boldName = supplier.name.slice(0, 200);
        message = `${boldName}\n\n${text.orderConfirm}\n${text.selected}: ${screen.selectedIds.length} / ${screen.itemIds.length}`;
        const chosen = new Set(screen.selectedIds);
        buttons = items.slice(screen.checkPage * 10, (screen.checkPage + 1) * 10).map((item) => [Markup.button.callback(`${chosen.has(item.id) ? '✅' : '☐'} ${Array.from(item.text).slice(0, 70).join('')}`, callback(state, `toggle:${item.id}`))]);
        const navigation = [];
        if (screen.checkPage > 0) navigation.push(Markup.button.callback(text.previous, callback(state, `cp:${screen.checkPage - 1}`)));
        if ((screen.checkPage + 1) * 10 < items.length) navigation.push(Markup.button.callback(text.next, callback(state, `cp:${screen.checkPage + 1}`)));
        if (navigation.length) buttons.push(navigation);
        buttons.push([Markup.button.callback(text.checkAll, callback(state, 'checkAll')), Markup.button.callback(text.clearAll, callback(state, 'clearAll'))]);
        buttons.push([Markup.button.callback(text.submit, callback(state, 'submit')), Markup.button.callback(text.cancel, callback(state, 'order'))]);
      } else if (screen.kind === 'orderInput') {
        message = screen.operation === 'append' ? text.orderPromptAdd : text.orderPromptEdit;
        if (screen.operation === 'replace') buttons.push([Markup.button.callback(text.orderClear, callback(state, 'orderClear'))]);
        buttons.push([Markup.button.callback(text.cancel, callback(state, 'order'))]);
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
    const entities: TextEntity[] = [];
    if (prefix.trim()) addEntity(entities, 'bold', 0, prefix.trimEnd());
    if (boldName) {
      addEntity(entities, 'bold', prefix.length, boldName);
      const heading = screen.kind === 'order' ? text.order : screen.kind === 'checklist' ? text.orderConfirm : screen.kind === 'waiting' && screen.itemIds.length ? text.waiting : screen.kind === 'note' ? text.notes : undefined;
      if (heading) addEntity(entities, 'bold', prefix.length + boldName.length + 2, heading);
    } else if (screen.kind === 'list') {
      const heading = message.includes('։') ? message.slice(0, message.indexOf('։') + 1) : message;
      addEntity(entities, 'bold', prefix.length, heading);
    } else {
      const title = screen.kind === 'search' ? text.searchTitle : screen.kind === 'add' ? text.addTitle : screen.kind === 'orderInput' ? text.orderInputTitle : screen.kind === 'edit' ? text.inputTitle : undefined;
      if (title) { message = `${title}\n\n${message}`; addEntity(entities, 'bold', prefix.length, title); }
    }
    if (codeOffset !== undefined) addEntity(entities, 'code', codeOffset, message.slice(codeOffset - prefix.length, codeOffset - prefix.length + codeLength));
    const options = { ...Markup.inlineKeyboard(compactRows(buttons)), ...(entities.length ? { entities } : {}) };
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
    else if (action === 'workspace' && (screen.kind === 'information' || screen.kind === 'confirmArchive' || screen.kind === 'order' || screen.kind === 'waiting' || screen.kind === 'note')) next = workspace(screen);
    else if (action === 'notes' && screen.kind === 'workspace') {
      const current = notes.active(screen.id);
      next = { ...screen, kind: 'note', notePage: 0, version: current ? { id: current.id, revision: current.revision } : null };
    }
    else if (screen.kind === 'note' || screen.kind === 'noteDone' || screen.kind === 'noteInput') {
      const current = notes.active(screen.id);
      const version = current ? { id: current.id, revision: current.revision } : null;
      if (version?.id !== screen.version?.id || version?.revision !== screen.version?.revision) {
        next = { ...screen, kind: 'note', notePage: 0, version }; prefix = `${text.noteChanged}\n\n`;
      } else if (action === 'notesBack') next = { ...screen, kind: 'note', notePage: 0, copying: false, version };
      else if (screen.kind === 'note' && (action === 'noteAdd' || (action === 'noteEdit' && current))) next = { ...screen, kind: 'noteInput', operation: action === 'noteAdd' ? 'append' : 'replace' };
      else if (screen.kind === 'note' && current && action === 'noteDone') next = { ...screen, kind: 'noteDone', version: version! };
      else if (screen.kind === 'noteDone' && action === 'noteComplete') {
        try { notes.complete(screen.id, screen.version); prefix = `${text.noteCompleted}\n\n`; }
        catch (error) { if (!(error instanceof NoteChangedError)) throw error; prefix = `${text.noteChanged}\n\n`; }
        const updated = notes.active(screen.id);
        next = { ...screen, kind: 'note', notePage: 0, version: updated ? { id: updated.id, revision: updated.revision } : null };
      }
      else if (screen.kind === 'note' && current && action === 'noteCopy' && current.text.length > 256) next = { ...screen, copying: true, notePage: 0 };
      else if (screen.kind === 'note' && /^np:\d+$/.test(action)) {
        const page = Number(action.slice(3));
        if (Number.isSafeInteger(page) && page < notePages(current?.text ?? '').length && Math.abs(page - screen.notePage) === 1) next = { ...screen, notePage: page };
      }
    }
    else if (action === 'waiting' && screen.kind === 'workspace') next = { ...screen, kind: 'waiting', waitingPage: 0, itemIds: waiting.list(screen.id).map((item) => item.id), selectedIds: [] };
    else if (screen.kind === 'waiting' || screen.kind === 'waitingRemove') {
      const currentIds = waiting.list(screen.id).map((item) => item.id);
      if (currentIds.length !== screen.itemIds.length || currentIds.some((id, index) => id !== screen.itemIds[index])) {
        next = { ...screen, kind: 'waiting', waitingPage: 0, itemIds: currentIds, selectedIds: [] }; prefix = `${text.waitingChanged}\n\n`;
      } else if (screen.kind === 'waitingRemove' && action === 'wCancelRemove') next = { ...screen, kind: 'waiting' };
      else if (screen.kind === 'waiting' && /^wt:[1-9]\d*$/.test(action)) {
        const id = Number(action.slice(3));
        if (screen.itemIds.slice(screen.waitingPage * 10, (screen.waitingPage + 1) * 10).includes(id)) {
          const selected = new Set(screen.selectedIds);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          next = { ...screen, selectedIds: [...selected] };
        }
      } else if (screen.kind === 'waiting' && /^wp:\d+$/.test(action)) {
        const page = Number(action.slice(3));
        if (Number.isSafeInteger(page) && page < Math.ceil(screen.itemIds.length / 10) && Math.abs(page - screen.waitingPage) === 1) next = { ...screen, waitingPage: page };
      } else if (screen.kind === 'waiting' && action === 'wAll') next = { ...screen, selectedIds: [...screen.itemIds] };
      else if (screen.kind === 'waiting' && action === 'wNone') next = { ...screen, selectedIds: [] };
      else if ((screen.kind === 'waiting' && ['wReceive', 'wReturn', 'wRemove'].includes(action)) || (screen.kind === 'waitingRemove' && action === 'wConfirmRemove')) {
        if (!screen.selectedIds.length) { await ctx.answerCbQuery(text.noSelection); return; }
        if (action === 'wRemove') next = { ...screen, kind: 'waitingRemove' };
        else {
          const operation = action === 'wReceive' ? 'received' : action === 'wReturn' ? 'returned' : 'cancelled';
          try {
            const count = waiting.transition(screen.id, screen.selectedIds, screen.itemIds, operation);
            prefix = `${operation === 'received' ? text.waitingReceived : operation === 'returned' ? text.waitingReturned : text.waitingCancelled}: ${count}\n\n`;
          } catch (error) {
            if (error instanceof OrderCapacityError) { await ctx.answerCbQuery(text.orderFull); return; }
            if (!(error instanceof WaitingChangedError)) throw error;
            prefix = `${text.waitingChanged}\n\n`;
          }
          next = { ...screen, kind: 'waiting', waitingPage: 0, itemIds: waiting.list(screen.id).map((item) => item.id), selectedIds: [] };
        }
      }
    }
    else if (action === 'order' && (screen.kind === 'workspace' || screen.kind === 'orderInput' || screen.kind === 'order' || screen.kind === 'checklist')) next = { ...screen, kind: 'order', orderPage: 0, copying: false };
    else if (screen.kind === 'order' && action === 'checklist') {
      const itemIds = orders.list(screen.id).map((item) => item.id);
      if (itemIds.length) next = { ...screen, kind: 'checklist', checkPage: 0, itemIds, selectedIds: [] };
    }
    else if (screen.kind === 'checklist') {
      const currentIds = orders.list(screen.id).map((item) => item.id);
      if (currentIds.length !== screen.itemIds.length || currentIds.some((id, index) => id !== screen.itemIds[index])) {
        next = { ...screen, kind: 'order', orderPage: 0 }; prefix = `${text.orderChanged}\n\n`;
      } else if (/^toggle:[1-9]\d*$/.test(action)) {
        const id = Number(action.slice(7));
        if (screen.itemIds.slice(screen.checkPage * 10, (screen.checkPage + 1) * 10).includes(id)) {
          const selected = new Set(screen.selectedIds);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          next = { ...screen, selectedIds: [...selected] };
        }
      } else if (/^cp:\d+$/.test(action)) {
        const page = Number(action.slice(3));
        if (Number.isSafeInteger(page) && page < Math.ceil(screen.itemIds.length / 10) && Math.abs(page - screen.checkPage) === 1) next = { ...screen, checkPage: page };
      } else if (action === 'checkAll') next = { ...screen, selectedIds: [...screen.itemIds] };
      else if (action === 'clearAll') next = { ...screen, selectedIds: [] };
      else if (action === 'submit') {
        if (!screen.selectedIds.length) { await ctx.answerCbQuery(text.noSelection); return; }
        try { const count = orders.confirm(screen.id, screen.selectedIds, screen.itemIds); prefix = `${text.moved}: ${count}\n\n`; }
        catch (error) { if (!(error instanceof OrderChangedError)) throw error; prefix = `${text.orderChanged}\n\n`; }
        next = { ...screen, kind: 'order', orderPage: 0 };
      }
    }
    else if (screen.kind === 'order' && (action === 'orderAdd' || action === 'orderEdit')) next = { ...screen, kind: 'orderInput', operation: action === 'orderAdd' ? 'append' : 'replace' };
    else if (screen.kind === 'order' && action === 'orderCopy' && orders.list(screen.id).map((item) => item.text).join('\n').length > 256) next = { ...screen, copying: true, orderPage: 0 };
    else if (screen.kind === 'order' && /^op:\d+$/.test(action)) {
      const target = Number(action.slice(3));
      const count = orderPages(orders.list(screen.id).map((item) => item.text)).length;
      if (Number.isSafeInteger(target) && target < count && Math.abs(target - screen.orderPage) === 1) next = { ...screen, orderPage: target };
    }
    else if (screen.kind === 'orderInput' && screen.operation === 'replace' && action === 'orderClear') { orders.replace(screen.id, []); next = { ...screen, kind: 'order', orderPage: 0 }; prefix = `${text.saved}\n\n`; }
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
    if (!state || (state.screen.kind !== 'add' && state.screen.kind !== 'search' && state.screen.kind !== 'edit' && state.screen.kind !== 'orderInput' && state.screen.kind !== 'noteInput')) return nextHandler();
    if (ctx.message.text.startsWith('/')) return nextHandler();
    const value = ctx.message.text.trim();
    if (!value) { await ctx.reply(text.invalid); return; }
    if (state.screen.kind === 'search') {
      sessions.delete(sessionKey(ctx));
      await render(ctx, { kind: 'list', page: 0, query: value });
      return;
    }
    if (state.screen.kind === 'noteInput') {
      const screen = state.screen;
      try { notes.save(screen.id, ctx.message.text, screen.operation, screen.version); }
      catch (error) {
        if (error instanceof InvalidNoteError) { await ctx.reply(text.noteInvalid); return; }
        if (!(error instanceof NoteChangedError)) throw error;
        const current = notes.active(screen.id);
        sessions.delete(sessionKey(ctx));
        await render(ctx, { ...screen, kind: 'note', notePage: 0, version: current ? { id: current.id, revision: current.revision } : null }, false, `${text.noteChanged}\n\n`);
        return;
      }
      const current = notes.active(screen.id)!;
      sessions.delete(sessionKey(ctx));
      await render(ctx, { ...screen, kind: 'note', notePage: 0, version: { id: current.id, revision: current.revision } }, false, `${text.saved}\n\n`);
      return;
    }
    if (state.screen.kind === 'orderInput') {
      const screen = state.screen;
      const supplier = repository.getById(screen.id);
      if (!supplier || supplier.archived) { sessions.delete(sessionKey(ctx)); await render(ctx, { kind: 'list', page: 0 }, false, `${text.missing}\n\n`); return; }
      let items: string[];
      try { items = parseOrderItems(ctx.message.text); }
      catch { await ctx.reply(text.orderInvalid); return; }
      try { if (screen.operation === 'append') orders.append(screen.id, items); else orders.replace(screen.id, items); }
      catch (error) { if (error instanceof RangeError) { await ctx.reply(text.orderInvalid); return; } throw error; }
      sessions.delete(sessionKey(ctx));
      await render(ctx, { ...screen, kind: 'order', orderPage: 0 }, false, `${text.saved}\n\n`);
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
