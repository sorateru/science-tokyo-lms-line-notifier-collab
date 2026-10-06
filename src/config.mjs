import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumber(name, fallback) {
  const value = number(name, fallback);
  return value > 0 ? value : fallback;
}

export function getConfig() {
  loadEnv();
  return {
    port: positiveNumber('PORT', 8787),
    host: process.env.HOST || '127.0.0.1',
    timezone: process.env.TIMEZONE || 'Asia/Tokyo',
    databasePath: path.resolve(process.env.DATABASE_PATH || './data/notifier.db'),
    moodleIcalUrl: process.env.MOODLE_ICAL_URL || '',
    moodleSyncDays: positiveNumber('MOODLE_SYNC_DAYS', 120),
    lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    lineUserId: process.env.LINE_USER_ID || '',
    dryRun: (process.env.DRY_RUN || 'true').toLowerCase() !== 'false',
    syncIntervalMinutes: positiveNumber('SYNC_INTERVAL_MINUTES', 30),
    notifyIntervalMinutes: positiveNumber('NOTIFY_INTERVAL_MINUTES', 1)
  };
}
