import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { OrderRepository } from '../src/features/orders/order.repository.ts';
import { join } from 'node:path';
import { openDatabase, transaction } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'supplier-bot-'));
  const path = join(directory, 'nested', 'test.sqlite');
  return { directory, path, db: openDatabase(path) };
}

test('initializes directories and repeatable migrations with foreign keys enabled', () => {
  const { directory, path, db } = temporaryDatabase();
  try {
    assert.equal(existsSync(path), true);
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
    db.exec('CREATE TABLE child (supplier_id INTEGER REFERENCES suppliers(id))');
    assert.throws(() => db.prepare('INSERT INTO child VALUES (?)').run(999));
    db.close();
    const reopened = openDatabase(path);
    try { assert.equal(reopened.prepare('SELECT count(*) AS count FROM schema_migrations').get()?.count, 5); }
    finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('supplier creation, updates, unique names and validation', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const suppliers = new SupplierRepository(db);
    const created = suppliers.create({ name: '  Մատակարար  ', phone: ' 123 ', productTypes: 'parts' });
    assert.equal(created.name, 'Մատակարար');
    assert.equal(created.phone, '123');
    assert.equal(created.archived, false);
    assert.ok(created.createdAt && created.updatedAt);
    assert.deepEqual(suppliers.getById(created.id), created);
    assert.throws(() => suppliers.create({ name: ' մԱՏԱԿԱՐԱՐ ' }));
    assert.throws(() => suppliers.create({ name: '   ' }), /name/);
    const updated = suppliers.update(created.id, { name: 'New name', phone: null, address: 'Yerevan' });
    assert.equal(updated?.name, 'New name');
    assert.equal(updated?.phone, null);
    assert.equal(updated?.address, 'Yerevan');
    assert.equal(suppliers.update(999, { name: 'Missing' }), undefined);
    assert.equal(suppliers.getById(999), undefined);
    assert.throws(() => suppliers.update(created.id, { name: '' }), /name/);
    suppliers.create({ name: 'Other' });
    assert.throws(() => suppliers.update(created.id, { name: 'other' }));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('searches active names case-insensitively with literal substring matching and archives', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const suppliers = new SupplierRepository(db);
    const first = suppliers.create({ name: 'ԱՎՏՈ Parts 100%' });
    const second = suppliers.create({ name: 'Other Parts' });
    assert.deepEqual(suppliers.searchByName('ավտո').map((s) => s.id), [first.id]);
    assert.deepEqual(suppliers.searchByName('%').map((s) => s.id), [first.id]);
    assert.throws(() => suppliers.searchByName('  '));
    assert.equal(suppliers.archive(first.id), true);
    assert.equal(suppliers.archive(first.id), false);
    assert.equal(suppliers.archive(999), false);
    assert.equal(suppliers.getById(first.id)?.archived, true);
    assert.deepEqual(suppliers.listActive().map((s) => s.id), [second.id]);
    assert.deepEqual(suppliers.searchByName('ավտո'), []);
    assert.throws(() => suppliers.create({ name: 'ավտո parts 100%' }));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rolls back all writes on transaction failure', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const suppliers = new SupplierRepository(db);
    assert.throws(() => transaction(db, () => {
      suppliers.create({ name: 'Temporary' });
      throw new Error('failure');
    }), /failure/);
    assert.deepEqual(suppliers.listActive(), []);
    assert.throws(() => transaction(db, () => Promise.resolve()), /synchronous/);
    transaction(db, () => suppliers.create({ name: 'Persisted' }));
    assert.equal(suppliers.listActive().length, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('upgrades a version 2 database without changing existing supplier data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'supplier-upgrade-'));
  const path = join(directory, 'previous.sqlite');
  const old = new DatabaseSync(path);
  try {
    old.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        name_key TEXT NOT NULL UNIQUE CHECK (length(name_key) > 0),
        phone TEXT, website TEXT, address TEXT, product_types TEXT, order_days TEXT,
        delivery_days TEXT, working_hours TEXT, payment_terms TEXT, general_information TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
      );
      CREATE TABLE product_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);
      INSERT INTO schema_migrations (version) VALUES (1), (2);
      INSERT INTO suppliers (id, name, name_key, phone, address) VALUES (42, 'Existing', 'existing', '012345678', 'Yerevan');
      INSERT INTO product_categories (name, name_key) VALUES ('Parts', 'parts');`);
  } finally { old.close(); }
  try {
    const db = openDatabase(path);
    try {
      assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2, 3, 4, 5]);
      const supplier = new SupplierRepository(db).getById(42);
      assert.equal(supplier?.name, 'Existing');
      assert.equal(supplier?.phone, '012345678');
      assert.equal(supplier?.address, 'Yerevan');
      assert.equal(db.prepare('SELECT name FROM product_categories').get()?.name, 'Parts');
      const orders = new OrderRepository(db);
      orders.append(42, ['Existing supplier item']);
      assert.equal(orders.list(42)[0]?.text, 'Existing supplier item');
    } finally { db.close(); }
    const reopened = openDatabase(path);
    try { assert.equal(new OrderRepository(reopened).list(42).length, 1); }
    finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('upgrades a version 3 database without altering existing order items', () => {
  const { directory, path, db } = temporaryDatabase();
  try {
    const supplier = new SupplierRepository(db).create({ name: 'Previous order' });
    const original = new OrderRepository(db);
    original.append(supplier.id, ['Preserved']);
    const before = original.list(supplier.id)[0]!;
    // Construct a version 3 fixture from the current schema, with version 4 absent.
    db.exec('DROP TABLE waiting_items; DELETE FROM schema_migrations WHERE version = 4');
    db.close();
    const upgraded = openDatabase(path);
    try {
      assert.deepEqual(new OrderRepository(upgraded).list(supplier.id)[0], before);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 5);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM waiting_items').get()?.n, 0);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('upgrades a version 4 database preserving waiting data', () => {
  const { directory, path, db } = temporaryDatabase();
  try {
    const supplier = new SupplierRepository(db).create({ name: 'Upgrade waiting' });
    const orders = new OrderRepository(db);
    orders.append(supplier.id, ['Existing']);
    const id = orders.list(supplier.id)[0]!.id;
    orders.confirm(supplier.id, [id], [id]);
    const before = db.prepare('SELECT * FROM waiting_items').get();
    db.exec('DROP TABLE item_history; DELETE FROM schema_migrations WHERE version = 5');
    db.close();
    const upgraded = openDatabase(path);
    try {
      assert.deepEqual(upgraded.prepare('SELECT * FROM waiting_items').get(), before);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n, 5);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM item_history').get()?.n, 0);
    } finally { upgraded.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('matches ordered word prefixes without losing literal substring search', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const suppliers = new SupplierRepository(db);
    const garik = suppliers.create({ name: 'Garik Tec' });
    const unicode = suppliers.create({ name: 'ԱՎՏՈ Մասեր' });
    const composed = suppliers.create({ name: 'Café Pièces' });
    const reversed = suppliers.create({ name: 'Tec Garik' });
    const archived = suppliers.create({ name: 'Garik Test' });
    suppliers.archive(archived.id);
    for (const query of ['Garik Tec', 'garik', 'GARI T', 'gari t', 'gar te', 'tec', '  GAR  \t te  ']) {
      assert.ok(suppliers.searchByName(query).some((supplier) => supplier.id === garik.id), query);
    }
    assert.deepEqual(suppliers.searchByName('gari t').map((supplier) => supplier.id), [garik.id]);
    assert.deepEqual(suppliers.searchByName('tec gar').map((supplier) => supplier.id), [reversed.id]);
    assert.deepEqual(suppliers.searchByName('t g').map((supplier) => supplier.id), [reversed.id]);
    assert.deepEqual(suppliers.searchByName('ԱՎ ՄԱ').map((supplier) => supplier.id), [unicode.id]);
    assert.deepEqual(suppliers.searchByName('cafe\u0301 pi').map((supplier) => supplier.id), [composed.id]);
    assert.deepEqual(suppliers.searchByName('arik te').map((supplier) => supplier.id), [garik.id]);
    assert.deepEqual(suppliers.searchByName('unknown'), []);
    assert.deepEqual(suppliers.searchByName('gar').map((supplier) => supplier.name), ['Garik Tec', 'Tec Garik']);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
