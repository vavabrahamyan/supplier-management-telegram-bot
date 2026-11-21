import type { DatabaseSync } from 'node:sqlite';
import type { PriceListVersion } from './price-list.types.ts';

/** Metadata only: external Drive operations must be coordinated through a durable journal. */
export class PriceListRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  versions(supplierId: number, priceListId: number): PriceListVersion[] {
    return this.db.prepare(`SELECT v.* FROM price_list_versions v
      JOIN price_lists p ON p.id = v.price_list_id
      WHERE p.supplier_id = ? AND p.id = ? ORDER BY v.id DESC`).all(supplierId, priceListId).map((row) => ({
      id: Number(row.id), priceListId: Number(row.price_list_id), driveFileId: String(row.drive_file_id),
      filename: String(row.filename), uploadedAt: String(row.uploaded_at),
      archivedAt: row.archived_at === null ? null : String(row.archived_at),
      previousVersionId: row.previous_version_id === null ? null : Number(row.previous_version_id),
    }));
  }
}
