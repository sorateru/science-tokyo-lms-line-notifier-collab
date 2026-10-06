import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, openDatabase } from '../src/db.mjs';
import { dueNotifications, formatNotification, runNotificationCheck } from '../src/notifier.mjs';

const MINUTE = 60_000;

test('fixed notifications become due once their threshold has passed', () => {
  const now = Date.UTC(2026, 8, 14, 3, 0);
  const task = {
    dueAt: now + 120 * MINUTE,
    reminderOffsets: [1440, 180, 60],
    repeatIntervalMinutes: 0,
    repeatWindowMinutes: 0
  };
  assert.deepEqual(dueNotifications(task, now).map(item => item.key), ['offset:1440', 'offset:180']);
});

test('repeat reminders use a stable time bucket', () => {
  const now = Date.UTC(2026, 8, 14, 3, 0);
  const task = {
    dueAt: now + 100 * MINUTE,
    reminderOffsets: [],
    repeatIntervalMinutes: 30,
    repeatWindowMinutes: 120
  };
  assert.equal(dueNotifications(task, now)[0].key, 'repeat:0');
  assert.equal(dueNotifications(task, now + 31 * MINUTE)[0].key, 'repeat:1');
});

test('notification message includes course, title and URL', () => {
  const text = formatNotification({
    dueAt: Date.UTC(2026, 8, 14, 12, 0),
    course: '確率論基礎', title: 'レポート', url: 'https://example.com'
  });
  assert.match(text, /確率論基礎/);
  assert.match(text, /レポート/);
  assert.match(text, /https:\/\/example.com/);
});

test('multiple due thresholds are sent as one LINE message', async () => {
  const db = openDatabase(':memory:');
  const now = Date.UTC(2026, 8, 14, 3, 0);
  createTask(db, {
    title: 'まとめて通知', dueAt: now + 120 * MINUTE,
    reminderOffsets: [1440, 180]
  }, now);
  let sendCount = 0;
  const results = await runNotificationCheck(
    db,
    { timezone: 'Asia/Tokyo' },
    now,
    async () => { sendCount += 1; }
  );
  assert.equal(sendCount, 1);
  assert.equal(results.length, 2);

  await runNotificationCheck(db, { timezone: 'Asia/Tokyo' }, now, async () => { sendCount += 1; });
  assert.equal(sendCount, 1);
});
