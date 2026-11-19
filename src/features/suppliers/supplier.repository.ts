import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { Supplier, SupplierInput, SupplierUpdate } from './supplier.types.ts';

const fields = {
  phone: 'phone', website: 'website', address: 'address', productTypes: 'product_types',
  orderDays: 'order_days', deliveryDays: 'delivery_days', workingHours: 'working_hours',
  paymentTerms: 'payment_terms', generalInformation: 'general_information',
} as const;
type OptionalField = keyof typeof fields;
type Row = Record<string, SQLOutputValue>;

function normalizeName(name: string): string {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('Supplier name is required');
  return name.trim().normalize('NFC');
}
function key(name: string): string { return name.normalize('NFC').toLowerCase().normalize('NFC'); }
function optional(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('Supplier fields must be strings or null');
  return value.trim() || null;
}
function map(row: Row): Supplier {
  return {
    id: Number(row.id), name: String(row.name), phone: row.phone as string | null,
    website: row.website as string | null, address: row.address as string | null,
    productTypes: row.product_types as string | null, orderDays: row.order_days as string | null,
    deliveryDays: row.delivery_days as string | null, workingHours: row.working_hours as string | null,
    paymentTerms: row.payment_terms as string | null, generalInformation: row.general_information as string | null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), archived: row.archived === 1,
  };
}

export class SupplierRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) { this.db = db; }

  create(input: SupplierInput): Supplier {
    const name = normalizeName(input.name);
    const entries = Object.entries(fields) as [OptionalField, string][];
    const result = this.db.prepare(`INSERT INTO suppliers (name, name_key, ${entries.map(([, column]) => column).join(', ')}) VALUES (${entries.map(() => '?').concat(['?', '?']).join(', ')})`)
      .run(name, key(name), ...entries.map(([field]) => optional(input[field])));
    return this.getById(Number(result.lastInsertRowid))!;
  }

  getById(id: number): Supplier | undefined {
    const row = this.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    return row ? map(row) : undefined;
  }

  listActive(): Supplier[] {
    return this.db.prepare('SELECT * FROM suppliers WHERE archived = 0 ORDER BY name_key, id').all().map(map);
  }

  searchByName(query: string): Supplier[] {
    if (typeof query !== 'string' || !query.trim()) throw new TypeError('Search query is required');
    return this.db.prepare('SELECT * FROM suppliers WHERE archived = 0 AND instr(name_key, ?) > 0 ORDER BY name_key, id')
      .all(key(query.trim())).map(map);
  }

  update(id: number, input: SupplierUpdate): Supplier | undefined {
    const assignments: string[] = [];
    const values: SQLInputValue[] = [];
    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      assignments.push('name = ?', 'name_key = ?');
      values.push(name, key(name));
    }
    for (const [field, column] of Object.entries(fields) as [OptionalField, string][]) {
      if (input[field] !== undefined) {
        assignments.push(`${column} = ?`);
        values.push(optional(input[field]));
      }
    }
    if (assignments.length === 0) return this.getById(id);
    assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    const result = this.db.prepare(`UPDATE suppliers SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    return result.changes ? this.getById(id) : undefined;
  }

  archive(id: number): boolean {
    return Number(this.db.prepare("UPDATE suppliers SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND archived = 0").run(id).changes) > 0;
  }
}
