import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../db/database.ts';
import { MAX_ITEM_LENGTH, MAX_ORDER_ITEMS } from './order.ts';
import type { OrderItem } from './order.types.ts';

export class OrderChangedError extends Error {}

export class OrderRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  list(supplierId: number): OrderItem[] {
    return this.db.prepare('SELECT * FROM order_items WHERE supplier_id = ? ORDER BY position, id').all(supplierId).map((row) => ({
      id: Number(row.id), supplierId: Number(row.supplier_id), text: String(row.text), position: Number(row.position),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  append(supplierId: number, items: readonly string[]): void { this.write(supplierId, items, false); }
  replace(supplierId: number, items: readonly string[]): void { this.write(supplierId, items, true); }

  /** Reject the entire operation if the displayed order no longer matches the database. */
  confirm(supplierId: number, selectedIds: readonly number[], snapshotIds: readonly number[]): number {
    if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length || new Set(snapshotIds).size !== snapshotIds.length || selectedIds.some((id) => !Number.isSafeInteger(id) || id < 1 || !snapshotIds.includes(id))) throw new TypeError('Invalid selection');
    return transaction(this.db, () => {
      const supplier = this.db.prepare('SELECT id FROM suppliers WHERE id = ? AND archived = 0').get(supplierId);
      const items = this.list(supplierId);
      if (!supplier || items.length !== snapshotIds.length || items.some((item, index) => item.id !== snapshotIds[index])) throw new OrderChangedError('Order changed');
      const chosen = new Set(selectedIds);
      let position = Number(this.db.prepare('SELECT coalesce(max(position), -1) + 1 AS next FROM waiting_items WHERE supplier_id = ?').get(supplierId)!.next);
      const insert = this.db.prepare("INSERT INTO waiting_items (id, supplier_id, text, position, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
      const remove = this.db.prepare('DELETE FROM order_items WHERE id = ? AND supplier_id = ?');
      for (const item of items) if (chosen.has(item.id)) {
        insert.run(item.id, supplierId, item.text, position++, item.createdAt);
        if (Number(remove.run(item.id, supplierId).changes) !== 1) throw new OrderChangedError('Order changed');
      }
      return selectedIds.length;
    });
  }

  private write(supplierId: number, items: readonly string[], replace: boolean): void {
    if (items.length > MAX_ORDER_ITEMS || items.some((item) => typeof item !== 'string' || !item.trim() || item !== item.trim() || item.length > MAX_ITEM_LENGTH || /[,\r\n\u0000-\u001f\u007f-\u009f]/u.test(item))) throw new TypeError('Invalid order items');
    transaction(this.db, () => {
      const supplier = this.db.prepare('SELECT id FROM suppliers WHERE id = ? AND archived = 0').get(supplierId);
      if (!supplier) throw new Error('Supplier unavailable');
      const count = Number(this.db.prepare('SELECT count(*) AS count FROM order_items WHERE supplier_id = ?').get(supplierId)!.count);
      if ((!replace && count + items.length > MAX_ORDER_ITEMS)) throw new RangeError('Order is too large');
      if (replace) this.db.prepare('DELETE FROM order_items WHERE supplier_id = ?').run(supplierId);
      let position = replace ? 0 : Number(this.db.prepare('SELECT coalesce(max(position), -1) + 1 AS next FROM order_items WHERE supplier_id = ?').get(supplierId)!.next);
      const insert = this.db.prepare('INSERT INTO order_items (supplier_id, text, position) VALUES (?, ?, ?)');
      for (const item of items) insert.run(supplierId, item, position++);
    });
  }
}
