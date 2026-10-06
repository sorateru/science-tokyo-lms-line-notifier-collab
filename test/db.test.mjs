import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask, listTasks, openDatabase, recordNotification, updateTask,
  upsertExternalTask, wasNotified
} from '../src/db.mjs';

test('manual task is stored', () => {
  const db = openDatabase(':memory:');
  createTask(db, { title: '手動課題', dueAt: '2026-10-01T12:00:00+09:00' });
  assert.equal(listTasks(db)[0].title, '手動課題');
});

test('Moodle sync updates instead of duplicating', () => {
  const db = openDatabase(':memory:');
  const task = { externalId: 'moodle:42', source: 'moodle', title: '課題A', dueAt: Date.now() + 10000 };
  upsertExternalTask(db, task);
  upsertExternalTask(db, { ...task, title: '課題A（更新）' });
  assert.equal(listTasks(db).length, 1);
  assert.equal(listTasks(db)[0].title, '課題A（更新）');
});

test('changing a deadline clears old notification history', () => {
  const db = openDatabase(':memory:');
  const task = createTask(db, { title: '課題', dueAt: Date.now() + 10000 });
  recordNotification(db, task.id, 'offset:180', 'sent');
  assert.equal(wasNotified(db, task.id, 'offset:180'), true);
  updateTask(db, task.id, { dueAt: task.dueAt + 86400000 });
  assert.equal(wasNotified(db, task.id, 'offset:180'), false);
});

test('zero repeat window is preserved', () => {
  const db = openDatabase(':memory:');
  const task = createTask(db, {
    title: '繰り返さない課題', dueAt: Date.now() + 10000,
    repeatIntervalMinutes: 60, repeatWindowMinutes: 0
  });
  assert.equal(task.repeatWindowMinutes, 0);
});
