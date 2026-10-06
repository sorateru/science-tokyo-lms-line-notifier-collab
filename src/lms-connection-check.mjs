import { getConfig } from './config.mjs';
import { fetchConfiguredLmsTasks, lmsSource } from './lms.mjs';
import { inspectIcalUrl } from './ical.mjs';

const config = getConfig();

if (!lmsSource(config)) {
  console.error('✗ .env の MOODLE_ICAL_URL を設定してください');
  process.exitCode = 1;
} else {
  try {
    if (lmsSource(config) === 'api') {
      console.log('1/2 Moodle基本APIを確認しています…');
      const siteInfo = await callMoodle('core_webservice_get_site_info');
      console.log(`✓ 認証成功: ${siteInfo.sitename || 'サイト名取得済み'}`);
      console.log('2/2 締切イベントAPIを確認しています…');
    } else {
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
    console.error(lmsSource(config) === 'ical'
      ? 'Safariのプライベートウインドウで同じURLを開き、ログインなしで.icsを取得できるか確認してください。'
      : 'トークン、関数の利用権限、LMS_BASE_URLを確認してください。');
    process.exitCode = 1;
  }
}

async function callMoodle(wsfunction) {
  const params = new URLSearchParams({
    wstoken: config.moodleToken,
    wsfunction,
    moodlewsrestformat: 'json'
  });
  const response = await fetch(`${config.lmsBaseUrl}/webservice/rest/server.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.exception) throw new Error(data.message || data.errorcode || 'Moodle API error');
  return data;
}
