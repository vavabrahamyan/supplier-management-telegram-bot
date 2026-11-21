export interface TextEntity { type: 'bold' | 'code'; offset: number; length: number }

/** Telegram entity offsets use UTF-16 code units, as do JavaScript string offsets. */
export function addEntity(entities: TextEntity[], type: TextEntity['type'], offset: number, value: string): void {
  if (value.length) entities.push({ type, offset, length: value.length });
}

/** Keep only short labels together; Telegram does not wrap inline rows. */
export function compactRows<T extends { text: string }>(rows: T[][]): T[][] {
  return rows.flatMap((row) => row.length > 1 && (row.length > 2 || row.some((button) => Array.from(button.text).length > 12)) ? row.map((button) => [button]) : [row]);
}
