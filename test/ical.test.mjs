import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchIcalTasks, inspectIcalUrl, parseIcalTasks } from '../src/ical.mjs';

const SAMPLE = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:assignment-42@example.invalid\r
DTSTART;TZID=Asia/Tokyo:20261001T235900\r
SUMMARY:確率論基礎\\, レポート1\r
CATEGORIES:確率論基礎\r
DESCRIPTION:課題ページ\\nhttps://lms.example/mod/assign/view.php?id=42\r
END:VEVENT\r
END:VCALENDAR\r
`;

test('Moodle iCalendar event is converted to a task', () => {
  const tasks = parseIcalTasks(SAMPLE);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].externalId, 'ical:assignment-42@example.invalid');
  assert.equal(tasks[0].course, '確率論基礎');
  assert.equal(tasks[0].title, '確率論基礎, レポート1');
  assert.equal(tasks[0].dueAt, Date.parse('2026-10-01T23:59:00+09:00'));
  assert.equal(tasks[0].url, 'https://lms.example/mod/assign/view.php?id=42');
});

test('iCalendar URL is fetched without exposing it in task data', async () => {
  const secretUrl = 'https://lms.example/calendar/export_execute.php?userid=123&authtoken=secret';
  const tasks = await fetchIcalTasks({
    moodleIcalUrl: secretUrl, timezone: 'Asia/Tokyo'
  }, Date.parse('2026-09-01T00:00:00+09:00'), async url => {
    assert.equal(url, secretUrl);
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'text/calendar' }),
      async text() { return SAMPLE; }
    };
  });
  assert.equal(tasks.length, 1);
  assert.equal(JSON.stringify(tasks).includes('authtoken'), false);
});

test('HTML-escaped ampersands in a copied calendar URL are normalized', async () => {
  const copiedUrl = 'https://lms.example/calendar/export_execute.php?userid=123&amp;authtoken=secret';
  await fetchIcalTasks({ moodleIcalUrl: copiedUrl }, 0, async url => {
    assert.equal(url, 'https://lms.example/calendar/export_execute.php?userid=123&authtoken=secret');
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'text/calendar' }),
      async text() { return SAMPLE; }
    };
  });
});

test('calendar URL structure is checked without returning secret values', () => {
  assert.deepEqual(inspectIcalUrl(
    'https://lms.example/calendar/export_execute.php?userid=123&authtoken=secret'
  ), {
    valid: true,
    isExportExecute: true,
    hasAuthToken: true,
    hasUser: true,
    normalizedAmpersand: false
  });
  assert.equal(inspectIcalUrl('https://lms.example/calendar/export.php').valid, false);
});

test('HTML login page is rejected', async () => {
  await assert.rejects(fetchIcalTasks({ moodleIcalUrl: 'https://lms.example/calendar' },
    Date.now(), async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      async text() { return '<html>login</html>'; }
    })), /ログインページ/);
});
