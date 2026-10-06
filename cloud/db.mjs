const DEFAULT_OFFSETS = [1440, 720, 180];

export async function listTasks(db) {
  const result = await db.prepare('SELECT * FROM tasks ORDER BY completed, due_at').all();
  return result.results.map(fromRow);
}

export async function listActiveTasks(db, now = Date.now()) {
  const result = await db.prepare(`
    SELECT * FROM tasks
    WHERE completed = 0 AND due_at >= ?
    ORDER BY due_at LIMIT 100
  `).bind(now - 60_000).all();
  return result.results.map(fromRow);
}

export async function createTask(db, input, now = Date.now()) {
  const task = normalizeTask(input, now);
  const result = await db.prepare(`
    INSERT INTO tasks (
      external_id, source, course, title, due_at, url, completed,
      reminder_offsets, repeat_interval_minutes, repeat_window_minutes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    task.externalId, task.source, task.course, task.title, task.dueAt,
    task.url, task.completed, task.reminderOffsets, task.repeatIntervalMinutes,
    task.repeatWindowMinutes, now, now
  ).run();
  return getTask(db, result.meta.last_row_id);
}

export async function getTask(db, id) {
  return fromRow(await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first());
}

export async function updateTask(db, id, patch, now = Date.now()) {
  const current = await getTask(db, id);
  if (!current) return null;
  const merged = normalizeTask({ ...current, ...patch }, now);
  await db.prepare(`
    UPDATE tasks SET course = ?, title = ?, due_at = ?, url = ?, completed = ?,
      reminder_offsets = ?, repeat_interval_minutes = ?, repeat_window_minutes = ?,
      updated_at = ? WHERE id = ?
  `).bind(
    merged.course, merged.title, merged.dueAt, merged.url, merged.completed,
    merged.reminderOffsets, merged.repeatIntervalMinutes,
    merged.repeatWindowMinutes, now, id
  ).run();
  const scheduleChanged = current.dueAt !== merged.dueAt ||
    JSON.stringify(current.reminderOffsets) !== merged.reminderOffsets ||
    current.repeatIntervalMinutes !== merged.repeatIntervalMinutes ||
    current.repeatWindowMinutes !== merged.repeatWindowMinutes;
  if (scheduleChanged) await clearNotificationHistory(db, id);
  return getTask(db, id);
}

export async function deleteTask(db, id) {
  const result = await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function upsertExternalTask(db, input, now = Date.now()) {
  const task = normalizeTask(input, now);
  if (!task.externalId) throw new Error('externalId is required');
  const previous = await db.prepare(
    'SELECT id, due_at FROM tasks WHERE external_id = ?'
  ).bind(task.externalId).first();
  await db.prepare(`
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
  `).bind(
    task.externalId, task.source, task.course, task.title, task.dueAt,
    task.url, task.reminderOffsets, task.repeatIntervalMinutes,
    task.repeatWindowMinutes, now, now
  ).run();
  const saved = fromRow(await db.prepare(
    'SELECT * FROM tasks WHERE external_id = ?'
  ).bind(task.externalId).first());
  if (previous && previous.due_at !== task.dueAt) await clearNotificationHistory(db, saved.id);
  return saved;
}

export async function bulkUpsertExternalTasks(db, inputs, now = Date.now()) {
  const tasks = inputs.map(input => normalizeTask(input, now));
  if (!tasks.length) return 0;
  if (tasks.some(task => !task.externalId)) throw new Error('externalId is required');

  const previous = new Map();
  for (const chunk of chunks(tasks.map(task => task.externalId), 100)) {
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT id, external_id, due_at FROM tasks WHERE external_id IN (${placeholders})
    `).bind(...chunk).all();
    for (const row of result.results) previous.set(row.external_id, row);
  }

  // D1は1文100パラメーターまでなので、11パラメーター×8件ずつまとめる。
  for (const chunk of chunks(tasks, 8)) {
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)').join(',');
    const values = chunk.flatMap(task => [
      task.externalId, task.source, task.course, task.title, task.dueAt, task.url,
      task.reminderOffsets, task.repeatIntervalMinutes, task.repeatWindowMinutes, now, now
    ]);
    await db.prepare(`
      INSERT INTO tasks (
        external_id, source, course, title, due_at, url, completed,
        reminder_offsets, repeat_interval_minutes, repeat_window_minutes,
        created_at, updated_at
      ) VALUES ${placeholders}
      ON CONFLICT(external_id) DO UPDATE SET
        source = excluded.source,
        course = excluded.course,
        title = excluded.title,
        due_at = excluded.due_at,
        url = excluded.url,
        updated_at = excluded.updated_at
    `).bind(...values).run();
  }

  const changedIds = tasks
    .map(task => previous.get(task.externalId))
    .filter((row, index) => row && row.due_at !== tasks[index].dueAt)
    .map(row => row.id);
  for (const chunk of chunks(changedIds, 100)) {
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(`DELETE FROM notification_log WHERE task_id IN (${placeholders})`)
      .bind(...chunk).run();
  }
  return tasks.length;
}

export async function getNotificationKeys(db, taskIds) {
  if (!taskIds.length) return new Set();
  const placeholders = taskIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT task_id, notification_key FROM notification_log
    WHERE task_id IN (${placeholders})
  `).bind(...taskIds).all();
  return new Set(result.results.map(row => `${row.task_id}:${row.notification_key}`));
}

export async function recordNotifications(db, taskId, notifications, now = Date.now(), status = 'sent') {
  if (!notifications.length) return;
  await db.batch(notifications.map(notification => db.prepare(`
    INSERT OR IGNORE INTO notification_log
      (task_id, notification_key, sent_at, status, detail)
    VALUES (?, ?, ?, ?, '')
  `).bind(taskId, notification.key, now, status)));
}

export async function clearNotificationHistory(db, taskId) {
  await db.prepare('DELETE FROM notification_log WHERE task_id = ?').bind(taskId).run();
}

export async function setState(db, key, value) {
  await db.prepare(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, String(value)).run();
}

export async function getState(db) {
  const result = await db.prepare('SELECT key, value FROM app_state').all();
  return Object.fromEntries(result.results.map(row => [row.key, row.value]));
}

export async function getLineUsage(db, monthKey) {
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?')
    .bind(`lineUsage:${monthKey}`).first();
  return Number(row?.value) || 0;
}

export async function incrementLineUsage(db, monthKey) {
  const key = `lineUsage:${monthKey}`;
  await db.prepare(`
    INSERT INTO app_state (key, value) VALUES (?, '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
  `).bind(key).run();
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

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
