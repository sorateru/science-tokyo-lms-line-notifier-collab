import { fetchConfiguredLmsTasks, lmsSource } from '../src/lms.mjs';
import { dueNotifications, formatNotification } from '../src/reminder-core.mjs';
import {
  bulkUpsertExternalTasks, createTask, deleteTask, getLineUsage, getNotificationKeys,
  getState, incrementLineUsage, listActiveTasks, listTasks, recordNotifications,
  setState, updateTask
} from './db.mjs';

export default {
  async fetch(request, env) {
    if (!env.APP_PASSWORD) {
      return text('APP_PASSWORD secretが未設定です', 503);
    }
    if (!(await isAuthorized(request, env.APP_PASSWORD))) {
      return new Response('認証が必要です', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Science Tokyo Task Notifier v2", charset="UTF-8"' }
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  }
};

async function handleApi(request, env, url) {
  try {
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      return json({ tasks: await listTasks(env.DB) });
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const state = await getState(env.DB);
      const monthKey = formatMonthKey(Date.now(), env.TIMEZONE || 'Asia/Tokyo');
      const lmsConfig = cloudLmsConfig(env);
      return json({
        lmsConfigured: Boolean(lmsSource(lmsConfig)),
        lmsSource: lmsSource(lmsConfig),
        lineConfigured: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_USER_ID),
        dryRun: env.DRY_RUN !== 'false',
        timezone: env.TIMEZONE || 'Asia/Tokyo',
        lastSyncAt: Number(state.lastSyncAt) || null,
        lastSyncCount: Number(state.lastSyncCount) || 0,
        lastSyncError: state.lastSyncError || '',
        lineUsage: await getLineUsage(env.DB, monthKey),
        lineMonthlyLimit: Math.max(1, Number(env.LINE_MONTHLY_LIMIT) || 180)
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      return json({ task: await createTask(env.DB, await readJson(request)) }, 201);
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && request.method === 'PATCH') {
      const task = await updateTask(env.DB, Number(taskMatch[1]), await readJson(request));
      return task ? json({ task }) : json({ error: 'Not found' }, 404);
    }
    if (taskMatch && request.method === 'DELETE') {
      return await deleteTask(env.DB, Number(taskMatch[1]))
        ? json({ ok: true }) : json({ error: 'Not found' }, 404);
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      return json({ imported: await syncMoodle(env) });
    }
    if (request.method === 'POST' && url.pathname === '/api/notify/test') {
      await sendLineWithQuota('✅ 課題リマインダーのテスト通知です。', env);
      return json({ ok: true, dryRun: env.DRY_RUN !== 'false' });
    }
    if (request.method === 'POST' && url.pathname === '/api/notify/check') {
      return json({ results: await runNotificationCheck(env) });
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error.message }, 400);
  }
}

async function runScheduled(env, now) {
  // 1つの毎分Cronで通知を確認し、00分・30分には先にLMSを同期する。
  if (new Date(now).getUTCMinutes() % 30 === 0 && lmsSource(cloudLmsConfig(env))) {
    try {
      await syncMoodle(env, now);
    } catch (error) {
      console.error(`LMS sync failed: ${error.message}`);
    }
  }
  await runNotificationCheck(env, now);
  await setState(env.DB, 'lastCronAt', now);
}

async function syncMoodle(env, now = Date.now()) {
  try {
    const tasks = await fetchConfiguredLmsTasks(cloudLmsConfig(env), now);
    await bulkUpsertExternalTasks(env.DB, tasks, now);
    await Promise.all([
      setState(env.DB, 'lastSyncAt', now),
      setState(env.DB, 'lastSyncCount', tasks.length),
      setState(env.DB, 'lastSyncError', '')
    ]);
    return tasks.length;
  } catch (error) {
    await setState(env.DB, 'lastSyncError', error.message);
    throw error;
  }
}

async function runNotificationCheck(env, now = Date.now()) {
  const tasks = await listActiveTasks(env.DB, now);
  const sentKeys = await getNotificationKeys(env.DB, tasks.map(task => task.id));
  const results = [];
  for (const task of tasks) {
    const pending = dueNotifications(task, now)
      .filter(notification => !sentKeys.has(`${task.id}:${notification.key}`));
    if (!pending.length) continue;
    try {
      await sendLineWithQuota(formatNotification(task, env.TIMEZONE || 'Asia/Tokyo'), env, now);
      await recordNotifications(env.DB, task.id, pending, now);
      results.push(...pending.map(notification => ({
        taskId: task.id, key: notification.key, status: 'sent'
      })));
    } catch (error) {
      if (error.code === 'LINE_QUOTA') {
        await recordNotifications(env.DB, task.id, pending, now, 'quota_skipped');
      }
      results.push(...pending.map(notification => ({
        taskId: task.id, key: notification.key, status: 'failed', error: error.message
      })));
    }
  }
  return results;
}

async function sendLineWithQuota(message, env, now = Date.now()) {
  if (env.DRY_RUN !== 'false') return sendLine(message, env);
  const monthKey = formatMonthKey(now, env.TIMEZONE || 'Asia/Tokyo');
  const usage = await getLineUsage(env.DB, monthKey);
  const limit = Math.max(1, Number(env.LINE_MONTHLY_LIMIT) || 180);
  if (usage >= limit) {
    const error = new Error(`LINE月間安全上限（${limit}通）に達しました`);
    error.code = 'LINE_QUOTA';
    throw error;
  }
  await sendLine(message, env);
  await incrementLineUsage(env.DB, monthKey);
}

async function sendLine(message, env) {
  if (env.DRY_RUN !== 'false') {
    console.log(`[DRY RUN]\n${message}`);
    return;
  }
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_USER_ID) {
    throw new Error('LINEのsecretが未設定です');
  }
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'X-Line-Retry-Key': crypto.randomUUID()
    },
    body: JSON.stringify({
      to: env.LINE_USER_ID,
      messages: [{ type: 'text', text: message }]
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE API error: HTTP ${response.status} ${detail.slice(0, 500)}`);
  }
}

async function isAuthorized(request, expectedPassword) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 0 || decoded.slice(0, separator) !== 'admin') return false;
  return constantTimeEqual(decoded.slice(separator + 1), expectedPassword);
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length')) || 0;
  if (length > 1_000_000) throw new Error('Request body is too large');
  return request.json();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function withSecurityHeaders(response) {
  const secured = new Response(response.body, response);
  secured.headers.set('Cache-Control', 'no-store');
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  secured.headers.set('X-Frame-Options', 'DENY');
  secured.headers.set('Referrer-Policy', 'no-referrer');
  secured.headers.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  return secured;
}

function formatMonthKey(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit'
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function cloudLmsConfig(env) {
  return {
    moodleIcalUrl: env.MOODLE_ICAL_URL || '',
    moodleSyncDays: Number(env.MOODLE_SYNC_DAYS) || 120,
    timezone: env.TIMEZONE || 'Asia/Tokyo'
  };
}
