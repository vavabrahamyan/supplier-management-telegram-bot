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
