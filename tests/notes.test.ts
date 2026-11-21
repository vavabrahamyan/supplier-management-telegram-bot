import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/database.ts';
import { SupplierRepository } from '../src/features/suppliers/supplier.repository.ts';
import { NoteRepository, NoteChangedError, InvalidNoteError } from '../src/features/notes/note.repository.ts';
import { notePages } from '../src/features/notes/note.ts';

test('notes persist, append, replace and archive with concurrency and supplier isolation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-')); const path = join(dir, 'db.sqlite');
  let db = openDatabase(path);
  try {
    const suppliers = new SupplierRepository(db); const a = suppliers.create({ name: 'A' }); const b = suppliers.create({ name: 'B' });
    let notes = new NoteRepository(db);
    notes.save(a.id, 'First', 'append', null);
    let first = notes.active(a.id)!;
    notes.save(a.id, 'Second', 'append', first);
    assert.equal(notes.active(a.id)?.text, 'First\nSecond');
    assert.throws(() => notes.save(a.id, 'stale', 'replace', first), NoteChangedError);
    assert.throws(() => notes.complete(b.id, first), NoteChangedError);
    first = notes.active(a.id)!;
    assert.throws(() => notes.save(a.id, ' ', 'replace', first), InvalidNoteError);
    assert.throws(() => notes.save(a.id, 'x'.repeat(100001), 'replace', first), InvalidNoteError);
    notes.save(a.id, 'New', 'replace', first);
    first = notes.active(a.id)!;
    db.exec("CREATE TRIGGER fail_complete BEFORE UPDATE ON supplier_notes WHEN NEW.completed_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'failure'); END");
    assert.throws(() => notes.complete(a.id, first));
    assert.equal(notes.active(a.id)?.text, 'New');
    db.exec('DROP TRIGGER fail_complete');
    notes.complete(a.id, first);
    assert.throws(() => notes.complete(a.id, first), NoteChangedError);
    assert.ok(db.prepare('SELECT completed_at FROM supplier_notes WHERE id = ?').get(first.id)?.completed_at);
    notes.save(a.id, 'Fresh', 'append', null);
    notes.save(b.id, 'Other', 'append', null);
    db.close(); db = openDatabase(path); notes = new NoteRepository(db);
    assert.equal(notes.active(a.id)?.text, 'Fresh'); assert.equal(notes.active(b.id)?.text, 'Other');
    assert.equal(db.prepare('SELECT count(*) AS n FROM supplier_notes WHERE supplier_id = ?').get(a.id)?.n, 2);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('note pages preserve long text including emoji and line breaks', () => {
  const value = 'x'.repeat(1999) + '😀\n' + 'y'.repeat(2100);
  const pages = notePages(value);
  assert.equal(pages.join(''), value); assert.ok(pages.every((page) => page.length <= 2000));
});
