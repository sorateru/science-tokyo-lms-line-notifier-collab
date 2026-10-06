import { fetchIcalTasks } from './ical.mjs';
import { fetchMoodleTasks } from './moodle.mjs';

export async function fetchConfiguredLmsTasks(config, now = Date.now(), fetchImpl = fetch) {
  if (config.moodleIcalUrl) return fetchIcalTasks(config, now, fetchImpl);
  return fetchMoodleTasks(config, now, fetchImpl);
}

export function lmsSource(config) {
  if (config.moodleIcalUrl) return 'ical';
  if (config.lmsBaseUrl && config.moodleToken) return 'api';
  return null;
}
