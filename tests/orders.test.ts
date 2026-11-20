import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';
import { OrderRepository } from '../src/features/orders/order.repository.ts';
import { parseOrderItems, orderPages } from '../src/features/orders/order.ts';

test('orders persist, remain isolated and ordered, and replace atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orders-'));
  const path = join(dir, 'db.sqlite');
  let db = openDatabase(path);
  try {
    const suppliers = new SupplierRepository(db);
    const a = suppliers.create({ name: 'A' });
    const b = suppliers.create({ name: 'B' });
    let orders = new OrderRepository(db);
    orders.append(a.id, parseOrderItems('Filter 2, Brake 3\nOil'));
    const initial = orders.list(a.id);
    orders.append(a.id, ['Belt']);
    orders.append(b.id, ['Other']);
    assert.deepEqual(orders.list(a.id).map((x) => x.text), ['Filter 2', 'Brake 3', 'Oil', 'Belt']);
    assert.deepEqual(orders.list(a.id).slice(0, 3).map((x) => x.id), initial.map((x) => x.id));
    assert.deepEqual(orders.list(b.id).map((x) => x.text), ['Other']);
    db.close();
    db = openDatabase(path);
    orders = new OrderRepository(db);
    assert.equal(orders.list(a.id).length, 4);
    db.exec("CREATE TRIGGER fail_order BEFORE INSERT ON order_items WHEN NEW.text = 'FAIL' BEGIN SELECT RAISE(ABORT, 'failure'); END");
    assert.throws(() => orders.replace(a.id, ['New', 'FAIL']));
    assert.deepEqual(orders.list(a.id).map((x) => x.text), ['Filter 2', 'Brake 3', 'Oil', 'Belt']);
    orders.replace(a.id, ['New']);
    assert.deepEqual(orders.list(a.id).map((x) => x.text), ['New']);
    assert.throws(() => orders.append(999, ['Missing']));
    orders.replace(a.id, []);
    assert.deepEqual(orders.list(a.id), []);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('parses delimiters and rejects invalid entries; paginates without losing text', () => {
  assert.deepEqual(parseOrderItems(' A, B\n\n C 2 '), ['A', 'B', 'C 2']);
  assert.throws(() => parseOrderItems(' , \n '));
  assert.throws(() => parseOrderItems('x'.repeat(1001)));
  assert.throws(() => parseOrderItems('item\u0000'));
  const items = ['x'.repeat(1000), 'y'.repeat(1000), 'z'];
  const pages = orderPages(items);
  assert.ok(pages.every((page) => page.length <= 2000));
  assert.equal(pages.join('\n'), items.join('\n'));
});


test('accepts realistic quoted product descriptions and rejects control characters', () => {
  const db = openDatabase(':memory:');
  try {
    const supplier = new SupplierRepository(db).create({ name: 'Parts' });
    const orders = new OrderRepository(db);
    const input = `Bosch O'Ring 3/4", Фильтр "MANN" 2 шт.\nԱրգելակի սկավառակ 2 հատ`;
    const items = parseOrderItems(input);
    orders.append(supplier.id, items);
    assert.deepEqual(orders.list(supplier.id).map((item) => item.text), items);
    for (const invalid of ['\tPart', 'Part\u0001', 'Part\u0085', 'Part\u007f']) {
      assert.throws(() => parseOrderItems(invalid));
      assert.throws(() => orders.append(supplier.id, [invalid]));
    }
  } finally { db.close(); }
});
