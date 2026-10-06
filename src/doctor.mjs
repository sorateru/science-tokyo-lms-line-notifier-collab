import fs from 'node:fs';
import { getConfig } from './config.mjs';
import { lmsSource } from './lms.mjs';

const config = getConfig();
const major = Number(process.versions.node.split('.')[0]);
const checks = [
  ['Node.js 22.5以上', major >= 22, process.version],
  ['.env', fs.existsSync('.env'), fs.existsSync('.env') ? '存在します' : 'npm run setup で作成できます'],
  ['LMS同期', Boolean(lmsSource(config)), config.moodleIcalUrl ? 'iCalendar URL設定済み' : '未設定'],
  ['LINEトークン', Boolean(config.lineChannelAccessToken), config.lineChannelAccessToken ? '設定済み' : '未設定'],
  ['LINEユーザーID', Boolean(config.lineUserId), config.lineUserId ? '設定済み' : '未設定'],
  ['dry-run', true, config.dryRun ? '有効（LINEへ送信しません）' : '無効（LINEへ送信します）']
];

console.log('課題リマインダー 設定診断\n');
for (const [label, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '!'} ${label}: ${detail}`);
}

if (!lmsSource(config)) {
  console.log('\nLMS未設定でも、手動課題とdry-run通知は利用できます。');
}
if (!config.lineChannelAccessToken || !config.lineUserId || config.dryRun) {
  console.log('実際のLINE送信にはLINE設定と DRY_RUN=false が必要です。');
}
