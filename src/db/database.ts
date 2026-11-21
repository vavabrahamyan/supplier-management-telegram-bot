import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Transactions are synchronous: never perform asynchronous work inside the callback. */
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
      throw new TypeError('Transaction callbacks must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const migrations = [
  `CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    name_key TEXT NOT NULL UNIQUE CHECK (length(name_key) > 0),
    phone TEXT, website TEXT, address TEXT, product_types TEXT, order_days TEXT,
    delivery_days TEXT, working_hours TEXT, payment_terms TEXT, general_information TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
  );`,
  `CREATE TABLE product_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);`,
  `CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    text TEXT NOT NULL CHECK (length(trim(text)) > 0 AND length(text) <= 1000),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(supplier_id, position)
  );`,
  `CREATE TABLE waiting_items (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    text TEXT NOT NULL CHECK(length(trim(text)) > 0),
    position INTEGER NOT NULL CHECK(position >= 0),
    created_at TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    UNIQUE(supplier_id, position)
  );`,
  `CREATE TABLE item_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    item_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('received', 'returned', 'cancelled')),
    created_at TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    returned_order_id INTEGER
  );
  CREATE INDEX item_history_supplier ON item_history(supplier_id, occurred_at, id);`,
  `CREATE TABLE supplier_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    text TEXT NOT NULL CHECK(length(trim(text)) > 0),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT
  );
  CREATE UNIQUE INDEX supplier_notes_active ON supplier_notes(supplier_id) WHERE completed_at IS NULL;`,
  `CREATE TABLE drive_folders (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id),
    kind TEXT NOT NULL CHECK(kind IN ('root', 'supplier', 'current', 'archive')),
    drive_id TEXT NOT NULL UNIQUE,
    CHECK ((kind = 'root' AND supplier_id IS NULL) OR (kind != 'root' AND supplier_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX drive_root_folder ON drive_folders(kind) WHERE supplier_id IS NULL;
  CREATE UNIQUE INDEX drive_supplier_folder ON drive_folders(supplier_id, kind) WHERE supplier_id IS NOT NULL;
  CREATE TABLE price_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE price_list_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price_list_id INTEGER NOT NULL REFERENCES price_lists(id),
    drive_file_id TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL CHECK(length(filename) > 0),
    uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    archived_at TEXT,
    previous_version_id INTEGER REFERENCES price_list_versions(id)
  );
  CREATE UNIQUE INDEX price_list_active_version ON price_list_versions(price_list_id) WHERE archived_at IS NULL;
  CREATE TABLE drive_operations (
    id TEXT PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    price_list_id INTEGER REFERENCES price_lists(id),
    new_drive_file_id TEXT NOT NULL UNIQUE,
    previous_version_id INTEGER REFERENCES price_list_versions(id),
    filename TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('reserved', 'uploaded', 'committed', 'archived')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX drive_one_pending_replacement ON drive_operations(price_list_id) WHERE price_list_id IS NOT NULL AND state != 'archived';`,
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    transaction(db, () => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)));
      for (const [index, sql] of migrations.entries()) {
        const version = index + 1;
        if (!applied.has(version)) {
          db.exec(sql);
          db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
        }
      }
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
