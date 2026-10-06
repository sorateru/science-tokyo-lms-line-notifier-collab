export async function fetchMoodleTasks(config, now = Date.now(), fetchImpl = fetch) {
  if (!config.lmsBaseUrl || !config.moodleToken) {
    throw new Error('LMS_BASE_URL と MOODLE_TOKEN を設定してください');
  }

  const events = [];
  let afterEventId = 0;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      wstoken: config.moodleToken,
      wsfunction: 'core_calendar_get_action_events_by_timesort',
      moodlewsrestformat: 'json',
      timesortfrom: String(Math.floor(now / 1000) - 86400),
      timesortto: String(Math.floor(now / 1000) + config.moodleSyncDays * 86400),
      aftereventid: String(afterEventId),
      limitnum: '50'
    });
    const response = await fetchImpl(`${config.lmsBaseUrl}/webservice/rest/server.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    if (!response.ok) throw new Error(`LMS API error: HTTP ${response.status}`);
    const data = await response.json();
    if (data.exception) throw new Error(data.message || data.errorcode || 'LMS API error');
    const pageEvents = data.events || [];
    events.push(...pageEvents);
    if (pageEvents.length < 50) break;
    afterEventId = pageEvents.at(-1).id;
  }

  return events
    .map(event => ({
      externalId: `moodle:${event.id}`,
      source: 'moodle',
      course: event.course?.fullname || event.course?.shortname || '',
      title: event.name || event.activityname || '名称未設定の課題',
      dueAt: Number(event.timesort || event.timestart) * 1000,
      url: event.url || event.viewurl || '',
      reminderOffsets: [1440, 720, 180],
      repeatIntervalMinutes: 0,
      repeatWindowMinutes: 1440
    }))
    .filter(task => Number.isFinite(task.dueAt) && task.dueAt > 0);
}
