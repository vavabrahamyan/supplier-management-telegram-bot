import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';
import { PriceListRepository } from '../src/features/price-lists/price-list.repository.ts';

test('price-list metadata is scoped to its supplier and allows only one active version', () => {
  const db = openDatabase(':memory:');
  try {
    const suppliers = new SupplierRepository(db);
    const first = suppliers.create({ name: 'First' });
    const second = suppliers.create({ name: 'Second' });
    const list = Number(db.prepare('INSERT INTO price_lists (supplier_id) VALUES (?)').run(first.id).lastInsertRowid);
    db.prepare('INSERT INTO price_list_versions (price_list_id, drive_file_id, filename) VALUES (?, ?, ?)').run(list, 'file-id', 'prices.xlsx');
    const repo = new PriceListRepository(db);
    assert.equal(repo.versions(first.id, list)[0]?.filename, 'prices.xlsx');
    assert.deepEqual(repo.versions(second.id, list), []);
    assert.throws(() => db.prepare('INSERT INTO price_list_versions (price_list_id, drive_file_id, filename) VALUES (?, ?, ?)').run(list, 'another', 'other.xlsx'));
  } finally { db.close(); }
});
