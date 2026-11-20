export const MAX_ITEM_LENGTH = 1000;
export const MAX_ORDER_ITEMS = 500;

/** Commas and line breaks delimit items; empty segments are ignored. */
export function parseOrderItems(input: string): string[] {
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input)) throw new TypeError('Invalid order items');
  const items = input.split(/[,\r\n]+/u).map((item) => item.trim()).filter(Boolean);
  if (!items.length || items.length > MAX_ORDER_ITEMS || items.some((item) => item.length > MAX_ITEM_LENGTH || /[\u0000-\u001f\u007f]/u.test(item))) {
    throw new TypeError('Invalid order items');
  }
  return items;
}

/** Keep each item intact and leave room for the supplier heading and navigation. */
export function orderPages(items: readonly string[]): string[] {
  const pages: string[] = [];
  let page = '';
  for (const item of items) {
    if (page && page.length + item.length + 1 > 2000) { pages.push(page); page = ''; }
    page += (page ? '\n' : '') + item;
  }
  if (page) pages.push(page);
  return pages;
}
