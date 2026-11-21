import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../db/database.ts';
import { MAX_ORDER_ITEMS } from '../orders/order.ts';
import type { WaitingAction, WaitingItem } from './waiting.types.ts';

export class WaitingChangedError extends Error {}
export class OrderCapacityError extends Error {}

export class WaitingRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  list(supplierId: number): WaitingItem[] {
    return this.db.prepare('SELECT * FROM waiting_items WHERE supplier_id = ? ORDER BY position, id').all(supplierId).map((row) => ({
      id: Number(row.id), supplierId: Number(row.supplier_id), text: String(row.text), position: Number(row.position),
      createdAt: String(row.created_at), confirmedAt: String(row.confirmed_at),
    }));
  }

  transition(supplierId: number, selectedIds: readonly number[], snapshotIds: readonly number[], action: WaitingAction): number {
    if (!['received', 'returned', 'cancelled'].includes(action) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length || new Set(snapshotIds).size !== snapshotIds.length || selectedIds.some((id) => !Number.isSafeInteger(id) || id < 1 || !snapshotIds.includes(id))) throw new TypeError('Invalid selection');
    return transaction(this.db, () => {
      const supplier = this.db.prepare('SELECT id FROM suppliers WHERE id = ? AND archived = 0').get(supplierId);
      const items = this.list(supplierId);
      if (!supplier || items.length !== snapshotIds.length || items.some((item, index) => item.id !== snapshotIds[index])) throw new WaitingChangedError('Waiting list changed');
      const selected = new Set(selectedIds);
      const count = Number(this.db.prepare('SELECT count(*) AS n FROM order_items WHERE supplier_id = ?').get(supplierId)!.n);
      if (action === 'returned' && count + selectedIds.length > MAX_ORDER_ITEMS) throw new OrderCapacityError('Order is full');
      let position = Number(this.db.prepare('SELECT coalesce(max(position), -1) + 1 AS n FROM order_items WHERE supplier_id = ?').get(supplierId)!.n);
      const insertOrder = this.db.prepare('INSERT INTO order_items (supplier_id, text, position, created_at) VALUES (?, ?, ?, ?)');
      const history = this.db.prepare("INSERT INTO item_history (supplier_id, item_id, text, action, created_at, confirmed_at, occurred_at, returned_order_id) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)");
      const remove = this.db.prepare('DELETE FROM waiting_items WHERE id = ? AND supplier_id = ?');
      for (const item of items) if (selected.has(item.id)) {
        const newId = action === 'returned' ? Number(insertOrder.run(supplierId, item.text, position++, item.createdAt).lastInsertRowid) : null;
        history.run(supplierId, item.id, item.text, action, item.createdAt, item.confirmedAt, newId);
        if (Number(remove.run(item.id, supplierId).changes) !== 1) throw new WaitingChangedError('Waiting list changed');
      }
      return selectedIds.length;
    });
  }
}
