import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_OFFSETS = [1440, 720, 180];

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      external_id TEXT UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual',
      course TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      reminder_offsets TEXT NOT NULL DEFAULT '[1440,720,180]',
      repeat_interval_minutes INTEGER NOT NULL DEFAULT 0,
      repeat_window_minutes INTEGER NOT NULL DEFAULT 1440,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      notification_key TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      UNIQUE(task_id, notification_key)
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function normalizeTask(input, now = Date.now()) {
  const dueAt = typeof input.dueAt === 'number' ? input.dueAt : Date.parse(input.dueAt);
  const title = cleanText(input.title, '課題名', 200, true);
  if (!Number.isFinite(dueAt)) throw new Error('正しい締切日時を指定してください');
  const offsets = Array.isArray(input.reminderOffsets)
    ? input.reminderOffsets.map(Number).filter(value => Number.isFinite(value) && value >= 0)
    : DEFAULT_OFFSETS;
  return {
    externalId: input.externalId || null,
    source: input.source || 'manual',
    course: cleanText(input.course, '科目名', 200),
    title,
    dueAt,
    url: normalizeUrl(input.url),
    completed: input.completed ? 1 : 0,
    reminderOffsets: JSON.stringify([...new Set(offsets)].sort((a, b) => b - a)),
    repeatIntervalMinutes: finiteNonNegative(input.repeatIntervalMinutes, 0),
    repeatWindowMinutes: finiteNonNegative(input.repeatWindowMinutes, 1440),
    now
  };
}

export function createTask(db, input, now = Date.now()) {
  const task = normalizeTask(input, now);
  const result = db.prepare(`
    INSERT INTO tasks (
      external_id, source, course, title, due_at, url, completed,
      reminder_offsets, repeat_interval_minutes, repeat_window_minutes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.externalId, task.source, task.course, task.title, task.dueAt,
    task.url, task.completed, task.reminderOffsets, task.repeatIntervalMinutes,
    task.repeatWindowMinutes, task.now, task.now
  );
  return getTask(db, Number(result.lastInsertRowid));
}

export function upsertExternalTask(db, input, now = Date.now()) {
  const task = normalizeTask(input, now);
  if (!task.externalId) throw new Error('externalId is required');
  const previous = db.prepare('SELECT id, due_at FROM tasks WHERE external_id = ?').get(task.externalId);
  db.prepare(`
    INSERT INTO tasks (
      external_id, source, course, title, due_at, url, completed,
      reminder_offsets, repeat_interval_minutes, repeat_window_minutes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      source = excluded.source,
      course = excluded.course,
      title = excluded.title,
      due_at = excluded.due_at,
      url = excluded.url,
      updated_at = excluded.updated_at
  `).run(
    task.externalId, task.source, task.course, task.title, task.dueAt,
    task.url, task.reminderOffsets, task.repeatIntervalMinutes,
    task.repeatWindowMinutes, task.now, task.now
  );
  const saved = fromRow(db.prepare('SELECT * FROM tasks WHERE external_id = ?').get(task.externalId));
  if (previous && previous.due_at !== task.dueAt) clearNotificationHistory(db, saved.id);
  return saved;
}

export function updateTask(db, id, patch, now = Date.now()) {
  const current = getTask(db, id);
  if (!current) return null;
  const merged = normalizeTask({ ...current, ...patch }, now);
  db.prepare(`
    UPDATE tasks SET course = ?, title = ?, due_at = ?, url = ?, completed = ?,
      reminder_offsets = ?, repeat_interval_minutes = ?, repeat_window_minutes = ?,
      updated_at = ? WHERE id = ?
  `).run(
    merged.course, merged.title, merged.dueAt, merged.url, merged.completed,
    merged.reminderOffsets, merged.repeatIntervalMinutes,
    merged.repeatWindowMinutes, now, id
  );
  const scheduleChanged = current.dueAt !== merged.dueAt ||
    JSON.stringify(current.reminderOffsets) !== merged.reminderOffsets ||
    current.repeatIntervalMinutes !== merged.repeatIntervalMinutes ||
    current.repeatWindowMinutes !== merged.repeatWindowMinutes;
  if (scheduleChanged) clearNotificationHistory(db, id);
  return getTask(db, id);
}

export function deleteTask(db, id) {
  return db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}

export function getTask(db, id) {
  return fromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

export function listTasks(db) {
  return db.prepare('SELECT * FROM tasks ORDER BY completed, due_at').all().map(fromRow);
}

export function listActiveTasks(db, now = Date.now()) {
  return db.prepare('SELECT * FROM tasks WHERE completed = 0 AND due_at >= ? ORDER BY due_at')
    .all(now - 60_000).map(fromRow);
}

export function wasNotified(db, taskId, key) {
  return Boolean(db.prepare(
    'SELECT 1 FROM notification_log WHERE task_id = ? AND notification_key = ?'
  ).get(taskId, key));
}

export function recordNotification(db, taskId, key, status, detail = '', now = Date.now()) {
  db.prepare(`
    INSERT OR IGNORE INTO notification_log
      (task_id, notification_key, sent_at, status, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, key, now, status, detail.slice(0, 1000));
}

export function clearNotificationHistory(db, taskId) {
  db.prepare('DELETE FROM notification_log WHERE task_id = ?').run(taskId);
}

export function setState(db, key, value) {
  db.prepare(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function getState(db) {
  return Object.fromEntries(db.prepare('SELECT key, value FROM app_state').all()
    .map(row => [row.key, row.value]));
}

function finiteNonNegative(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function cleanText(value, label, maxLength, required = false) {
  const text = String(value || '').trim();
  if (required && !text) throw new Error(`${label}は必須です`);
  if (text.length > maxLength) throw new Error(`${label}は${maxLength}文字以内で入力してください`);
  return text;
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 2000) throw new Error('URLが長すぎます');
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('正しいURLを入力してください'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URLはhttpまたはhttpsのみ使用できます');
  }
  return parsed.href;
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    externalId: row.external_id,
    source: row.source,
    course: row.course,
    title: row.title,
    dueAt: row.due_at,
    url: row.url,
    completed: Boolean(row.completed),
    reminderOffsets: JSON.parse(row.reminder_offsets),
    repeatIntervalMinutes: row.repeat_interval_minutes,
    repeatWindowMinutes: row.repeat_window_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
