import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    try { assert.equal(reopened.prepare('SELECT count(*) AS count FROM schema_migrations').get()?.count, 1); }
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
