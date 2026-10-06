CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE INDEX IF NOT EXISTS idx_tasks_active_due ON tasks(completed, due_at);
CREATE INDEX IF NOT EXISTS idx_notification_task ON notification_log(task_id);
