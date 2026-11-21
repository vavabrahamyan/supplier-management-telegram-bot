/** Split by code points without losing text or splitting surrogate pairs. */
export function notePages(value: string): string[] {
  const pages: string[] = [];
  let part = '';
  for (const character of value) {
    if (part.length + character.length > 2000) { pages.push(part); part = ''; }
    part += character;
  }
  if (part) pages.push(part);
  return pages;
}
