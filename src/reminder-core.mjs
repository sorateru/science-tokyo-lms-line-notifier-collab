const MINUTE = 60_000;

export function dueNotifications(task, now = Date.now()) {
  const notifications = [];
  for (const offset of task.reminderOffsets) {
    const scheduledAt = task.dueAt - offset * MINUTE;
    if (now >= scheduledAt && now < task.dueAt) {
      notifications.push({ key: `offset:${offset}`, kind: 'offset', offset });
    }
  }

  if (task.repeatIntervalMinutes > 0 && task.repeatWindowMinutes > 0) {
    const start = task.dueAt - task.repeatWindowMinutes * MINUTE;
    if (now >= start && now < task.dueAt) {
      const bucket = Math.floor((now - start) / (task.repeatIntervalMinutes * MINUTE));
      notifications.push({ key: `repeat:${bucket}`, kind: 'repeat' });
    }
  }
  return notifications;
}

export function formatNotification(task, timezone = 'Asia/Tokyo') {
  const due = new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(task.dueAt));
  const lines = [
    '📚 課題締切通知',
    task.course ? `科目: ${task.course}` : null,
    `課題: ${task.title}`,
    `締切: ${due}`,
    task.url || null
  ];
  return lines.filter(Boolean).join('\n');
}
