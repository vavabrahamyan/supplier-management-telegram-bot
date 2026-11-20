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

test('confirms selected items atomically and rejects stale or cross-supplier selections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waiting-'));
  const path = join(dir, 'data.sqlite');
  let db = openDatabase(path);
  try {
    const suppliers = new SupplierRepository(db);
    const a = suppliers.create({ name: 'A' });
    const b = suppliers.create({ name: 'B' });
    let orders = new OrderRepository(db);
    orders.append(a.id, ['one', 'two', 'three']);
    orders.append(b.id, ['other']);
    const items = orders.list(a.id);
    const ids = items.map((item) => item.id);
    const foreign = orders.list(b.id)[0]!.id;
    assert.throws(() => orders.confirm(a.id, [foreign], ids));
    assert.throws(() => orders.confirm(a.id, [ids[0]!, ids[0]!], ids));
    orders.append(a.id, ['concurrent']);
    assert.throws(() => orders.confirm(a.id, [ids[0]!], ids), /Order changed/);
    db.prepare('DELETE FROM order_items WHERE supplier_id = ? AND text = ?').run(a.id, 'concurrent');
    db.exec("CREATE TRIGGER fail_wait BEFORE INSERT ON waiting_items WHEN NEW.text = 'three' BEGIN SELECT RAISE(ABORT, 'failure'); END");
    assert.throws(() => orders.confirm(a.id, [ids[0]!, ids[2]!], ids));
    assert.equal(orders.list(a.id).length, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM waiting_items').get()?.n, 0);
    db.exec('DROP TRIGGER fail_wait');
    assert.equal(orders.confirm(a.id, [ids[0]!, ids[2]!], ids), 2);
    assert.deepEqual(orders.list(a.id).map((item) => item.text), ['two']);
    assert.throws(() => orders.confirm(a.id, [ids[0]!], ids));
    const waiting = db.prepare('SELECT id, text, confirmed_at FROM waiting_items WHERE supplier_id = ? ORDER BY position').all(a.id);
    assert.deepEqual(waiting.map((item) => item.id), [ids[0], ids[2]]);
    assert.ok(waiting.every((item) => item.confirmed_at));
    assert.equal(orders.list(b.id).length, 1);
    const remaining = orders.list(a.id).map((item) => item.id);
    orders.confirm(a.id, remaining, remaining);
    db.close();
    db = openDatabase(path);
    orders = new OrderRepository(db);
    assert.equal(orders.list(a.id).length, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM waiting_items WHERE supplier_id = ?').get(a.id)?.n, 3);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
