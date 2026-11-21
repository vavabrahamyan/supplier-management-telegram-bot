import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../db/database.ts';
import type { Note, NoteVersion } from './note.types.ts';

export const MAX_NOTE_LENGTH = 100_000;
export class NoteChangedError extends Error {}
export class InvalidNoteError extends Error {}

export class NoteRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  active(supplierId: number): Note | undefined {
    const row = this.db.prepare('SELECT * FROM supplier_notes WHERE supplier_id = ? AND completed_at IS NULL').get(supplierId);
    return row ? { id: Number(row.id), supplierId: Number(row.supplier_id), text: String(row.text), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at), completedAt: row.completed_at === null ? null : String(row.completed_at) } : undefined;
  }
  private check(supplierId: number, expected: NoteVersion | null): Note | undefined {
    if (!this.db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND archived = 0').get(supplierId)) throw new NoteChangedError('Supplier unavailable');
    const current = this.active(supplierId);
    if (expected === null ? !!current : !current || current.id !== expected.id || current.revision !== expected.revision) throw new NoteChangedError('Note changed');
    return current;
  }
  save(supplierId: number, input: string, mode: 'append' | 'replace', expected: NoteVersion | null): void {
    if (!input.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input)) throw new InvalidNoteError('Invalid note');
    transaction(this.db, () => {
      const current = this.check(supplierId, expected);
      const value = mode === 'append' && current ? `${current.text}\n${input}` : input;
      if (value.length > MAX_NOTE_LENGTH) throw new InvalidNoteError('Note too long');
      if (current) this.db.prepare("UPDATE supplier_notes SET text = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(value, current.id);
      else this.db.prepare('INSERT INTO supplier_notes (supplier_id, text) VALUES (?, ?)').run(supplierId, value);
    });
  }
  complete(supplierId: number, expected: NoteVersion): void {
    transaction(this.db, () => {
      const current = this.check(supplierId, expected);
      if (!current) throw new NoteChangedError('Note changed');
      this.db.prepare("UPDATE supplier_notes SET completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = revision + 1 WHERE id = ?").run(current.id);
    });
  }
}
