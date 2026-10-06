import { listActiveTasks, recordNotification, wasNotified } from './db.mjs';
import { dueNotifications, formatNotification } from './reminder-core.mjs';

export { dueNotifications, formatNotification } from './reminder-core.mjs';

export async function sendLine(text, config, fetchImpl = fetch) {
  if (config.dryRun) {
    console.log(`[DRY RUN]\n${text}`);
    return { dryRun: true };
  }
  if (!config.lineChannelAccessToken || !config.lineUserId) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID を設定してください');
  }
  const response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.lineChannelAccessToken}`,
      'X-Line-Retry-Key': crypto.randomUUID()
    },
    body: JSON.stringify({
      to: config.lineUserId,
      messages: [{ type: 'text', text }]
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE API error: HTTP ${response.status} ${detail}`);
  }
  return { dryRun: false };
}

export async function runNotificationCheck(db, config, now = Date.now(), send = sendLine) {
  const results = [];
  for (const task of listActiveTasks(db, now)) {
    const pending = dueNotifications(task, now)
      .filter(notification => !wasNotified(db, task.id, notification.key));
    if (!pending.length) continue;
    try {
      // 複数のタイミングが同時に対象でも、LINEメッセージは1通にまとめる。
      await send(formatNotification(task, config.timezone), config);
      for (const notification of pending) {
        recordNotification(db, task.id, notification.key, 'sent', '', now);
        results.push({ taskId: task.id, key: notification.key, status: 'sent' });
      }
    } catch (error) {
      // 失敗を確定済みにしないため、次回チェック時に再試行される。
      for (const notification of pending) {
        results.push({ taskId: task.id, key: notification.key, status: 'failed', error: error.message });
      }
    }
  }
  return results;
}
