import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.mjs';
import {
  createTask, deleteTask, getState, listTasks, openDatabase, setState, updateTask,
  upsertExternalTask
} from './db.mjs';
import { fetchConfiguredLmsTasks, lmsSource } from './lms.mjs';
import { runNotificationCheck, sendLine } from './notifier.mjs';

const config = getConfig();
const db = openDatabase(config.databasePath);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1_000_000) throw new Error('Request body is too large');
  }
  return text ? JSON.parse(text) : {};
}

async function syncMoodle() {
  try {
    const tasks = await fetchConfiguredLmsTasks(config);
    for (const task of tasks) upsertExternalTask(db, task);
    setState(db, 'lastSyncAt', Date.now());
    setState(db, 'lastSyncCount', tasks.length);
    setState(db, 'lastSyncError', '');
    return tasks.length;
  } catch (error) {
    setState(db, 'lastSyncError', error.message);
    throw error;
  }
}

async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      return json(response, 200, { tasks: listTasks(db) });
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const state = getState(db);
      return json(response, 200, {
        lmsConfigured: Boolean(lmsSource(config)),
        lmsSource: lmsSource(config),
        lineConfigured: Boolean(config.lineChannelAccessToken && config.lineUserId),
        dryRun: config.dryRun,
        timezone: config.timezone,
        lastSyncAt: Number(state.lastSyncAt) || null,
        lastSyncCount: Number(state.lastSyncCount) || 0,
        lastSyncError: state.lastSyncError || ''
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      return json(response, 201, { task: createTask(db, await body(request)) });
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && request.method === 'PATCH') {
      const task = updateTask(db, Number(taskMatch[1]), await body(request));
      return task ? json(response, 200, { task }) : json(response, 404, { error: 'Not found' });
    }
    if (taskMatch && request.method === 'DELETE') {
      return deleteTask(db, Number(taskMatch[1]))
        ? json(response, 200, { ok: true })
        : json(response, 404, { error: 'Not found' });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') {
      return json(response, 200, { imported: await syncMoodle() });
    }
    if (request.method === 'POST' && url.pathname === '/api/notify/test') {
      await sendLine('✅ 課題リマインダーのテスト通知です。', config);
      return json(response, 200, { ok: true, dryRun: config.dryRun });
    }
    if (request.method === 'POST' && url.pathname === '/api/notify/check') {
      return json(response, 200, { results: await runNotificationCheck(db, config) });
    }

    if (request.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const filename = path.resolve(publicDir, `.${requested}`);
      if (filename.startsWith(`${publicDir}${path.sep}`) && fs.existsSync(filename)) {
        const extension = path.extname(filename);
        const contentType = extension === '.css' ? 'text/css' : extension === '.js'
          ? 'text/javascript' : 'text/html';
        response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
        return fs.createReadStream(filename).pipe(response);
      }
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(response, 400, { error: error.message });
  }
}

let syncing = false;
async function scheduledSync() {
  if (syncing || !lmsSource(config)) return;
  syncing = true;
  try {
    const count = await syncMoodle();
    console.log(`LMS sync completed: ${count} events`);
  } catch (error) {
    console.error(`LMS sync failed: ${error.message}`);
  } finally {
    syncing = false;
  }
}

setInterval(scheduledSync, config.syncIntervalMinutes * 60_000).unref();
setInterval(() => runNotificationCheck(db, config).catch(console.error),
  config.notifyIntervalMinutes * 60_000).unref();

await scheduledSync();
await runNotificationCheck(db, config);
http.createServer(handler).listen(config.port, config.host, () => {
  console.log(`課題リマインダー: http://${config.host}:${config.port}`);
  console.log(config.dryRun ? 'LINE: dry-run mode' : 'LINE: enabled');
});
