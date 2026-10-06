import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getConfig, loadEnv } from '../src/config.mjs';

loadEnv();
const config = getConfig();
const secrets = {
  APP_PASSWORD: process.env.APP_PASSWORD || '',
  MOODLE_ICAL_URL: config.moodleIcalUrl,
  LINE_CHANNEL_ACCESS_TOKEN: config.lineChannelAccessToken,
  LINE_USER_ID: config.lineUserId
};

const missing = Object.entries(secrets).filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`未設定のsecretがあります: ${missing.join(', ')}`);
  process.exit(1);
}
if (secrets.APP_PASSWORD.length < 16) {
  console.error('APP_PASSWORDは16文字以上にしてください。');
  process.exit(1);
}

const wrangler = path.resolve('node_modules/.bin/wrangler');
const result = spawnSync(wrangler, ['secret', 'bulk'], {
  input: JSON.stringify(secrets),
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
