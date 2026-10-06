import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMoodleTasks } from '../src/moodle.mjs';

test('Moodle calendar events are converted to local tasks', async () => {
  let requestedUrl = '';
  let requestedOptions;
  const fakeFetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { events: [{
          id: 42,
          name: 'レポート1',
          timesort: 1790847540,
          url: 'https://lms.example/mod/assign/view.php?id=5',
          course: { fullname: '情報基礎' }
        }] };
      }
    };
  };
  const tasks = await fetchMoodleTasks({
    lmsBaseUrl: 'https://lms.example', moodleToken: 'secret', moodleSyncDays: 30
  }, Date.UTC(2026, 8, 14), fakeFetch);
  assert.equal(requestedUrl, 'https://lms.example/webservice/rest/server.php');
  assert.equal(requestedOptions.method, 'POST');
  assert.equal(requestedOptions.body.get('wsfunction'), 'core_calendar_get_action_events_by_timesort');
  assert.equal(requestedOptions.body.get('wstoken'), 'secret');
  assert.equal(tasks[0].externalId, 'moodle:42');
  assert.equal(tasks[0].course, '情報基礎');
  assert.equal(tasks[0].title, 'レポート1');
});

test('Moodle API errors are surfaced without exposing the token', async () => {
  const fakeFetch = async () => ({
    ok: true,
    async json() { return { exception: 'moodle_exception', message: 'Function disabled' }; }
  });
  await assert.rejects(
    fetchMoodleTasks({ lmsBaseUrl: 'https://lms.example', moodleToken: 'secret', moodleSyncDays: 30 }, Date.now(), fakeFetch),
    /Function disabled/
  );
});
