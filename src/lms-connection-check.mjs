import { getConfig } from './config.mjs';
import { fetchConfiguredLmsTasks, lmsSource } from './lms.mjs';
import { inspectIcalUrl } from './ical.mjs';

const config = getConfig();

if (!lmsSource(config)) {
  console.error('✗ .env の MOODLE_ICAL_URL を設定してください');
  process.exitCode = 1;
} else {
  try {
    console.log('iCalendar URLを確認しています…');
    const inspection = inspectIcalUrl(config.moodleIcalUrl);
    if (!inspection.valid) {
      const missing = [];
      if (!inspection.isExportExecute) missing.push('export_execute.php');
      if (!inspection.hasAuthToken) missing.push('authtoken');
      if (!inspection.hasUser) missing.push('userid または username');
      throw new Error(`カレンダーURLの形式が違います（不足: ${missing.join('、') || inspection.reason}）`);
    }
    console.log('✓ URL形式: export_execute.php / 利用者情報 / authtoken');
    if (inspection.normalizedAmpersand) {
      console.log('  URL内の &amp; は自動的に & へ補正します。');
    }
    const tasks = await fetchConfiguredLmsTasks(config);
    console.log(`✓ LMS締切取得成功: ${tasks.length}件取得`);
    for (const task of tasks.slice(0, 5)) {
      console.log(`  - ${task.course ? `${task.course}: ` : ''}${task.title} / ${new Date(task.dueAt).toLocaleString('ja-JP')}`);
    }
    if (tasks.length === 0) {
      console.log('  接続は成功しています。対象期間に要対応イベントがない状態です。');
    }
  } catch (error) {
    console.error(`✗ LMS接続テスト失敗: ${error.message}`);
    console.error('Safariのプライベートウインドウで同じURLを開き、ログインなしで.icsを取得できるか確認してください。');
    process.exitCode = 1;
  }
}
