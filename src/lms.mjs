import { fetchIcalTasks } from './ical.mjs';

export async function fetchConfiguredLmsTasks(config, now = Date.now(), fetchImpl = fetch) {
  return fetchIcalTasks(config, now, fetchImpl);
}

export function lmsSource(config) {
  if (config.moodleIcalUrl) return 'ical';
  return null;
}
