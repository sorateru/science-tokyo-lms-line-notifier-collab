const tasksElement = document.querySelector('#tasks');
const statusElement = document.querySelector('#status');
const dialog = document.querySelector('#task-dialog');
const form = document.querySelector('#task-form');
let tasks = [];
let filter = 'active';

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '処理に失敗しました');
  return data;
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function render() {
  const visible = filter === 'active' ? tasks.filter(task => !task.completed) : tasks;
  if (!visible.length) {
    tasksElement.innerHTML = '<div class="empty">登録中の課題はありません。</div>';
    return;
  }
  tasksElement.innerHTML = visible.map(task => {
    const due = new Date(task.dueAt);
    const remaining = Math.ceil((task.dueAt - Date.now()) / 86_400_000);
    const source = task.source.startsWith('moodle') ? 'LMSから同期' : '手動登録';
    return `<article class="task ${task.completed ? 'done' : ''}">
      <div class="date"><strong>${due.getDate()}</strong>${due.toLocaleDateString('ja-JP', { month: 'short' })}</div>
      <div>
        <p class="course">${escapeHtml(task.course || source)}</p>
        <h3>${task.url ? `<a href="${escapeHtml(task.url)}" target="_blank" rel="noreferrer">${escapeHtml(task.title)}</a>` : escapeHtml(task.title)}</h3>
        <p class="meta">${due.toLocaleString('ja-JP', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ・ ${remaining >= 0 ? `あと${remaining}日` : '締切済み'} ・ ${source}${task.repeatIntervalMinutes ? ` ・ ${task.repeatIntervalMinutes}分ごとに再通知` : ''}</p>
      </div>
      <div class="task-controls">
        <button data-edit="${task.id}">編集</button>
        <button data-toggle="${task.id}">${task.completed ? '戻す' : '完了'}</button>
        <button data-delete="${task.id}">削除</button>
      </div>
    </article>`;
  }).join('');
}

async function load() {
  const [{ tasks: loaded }, status] = await Promise.all([api('/api/tasks'), api('/api/status')]);
  tasks = loaded;
  statusElement.innerHTML = [
    `<span class="badge ${status.lmsConfigured ? 'ok' : 'warn'}">LMS ${status.lmsConfigured ? status.lmsSource === 'ical' ? 'カレンダー接続' : 'API接続' : '未設定'}</span>`,
    `<span class="badge ${status.lineConfigured && !status.dryRun ? 'ok' : 'warn'}">LINE ${status.dryRun ? 'テストモード' : status.lineConfigured ? '接続設定済み' : '未設定'}</span>`,
    `<span class="badge">${escapeHtml(status.timezone)}</span>`,
    status.lastSyncAt
      ? `<span class="badge ${status.lastSyncError ? 'warn' : 'ok'}">最終同期 ${new Date(status.lastSyncAt).toLocaleString('ja-JP')}</span>`
      : '<span class="badge">LMS同期 未実行</span>',
    status.lastSyncError ? `<span class="badge warn">同期エラー: ${escapeHtml(status.lastSyncError)}</span>` : '',
    status.lineMonthlyLimit
      ? `<span class="badge">LINE ${status.lineUsage}/${status.lineMonthlyLimit}通</span>`
      : ''
  ].join('');
  render();
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2800);
}

function resetForm() {
  form.reset();
  delete form.dataset.editId;
  document.querySelector('#form-title').textContent = '課題を手動登録';
  document.querySelector('#form-submit').textContent = '登録する';
}

function toLocalInput(timestamp) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

document.querySelector('#open-form').onclick = () => { resetForm(); dialog.showModal(); };
document.querySelector('#close-form').onclick = () => { dialog.close(); resetForm(); };
document.querySelector('#sync').onclick = async () => {
  try { const data = await api('/api/sync', { method: 'POST' }); toast(`${data.imported}件を同期しました`); await load(); }
  catch (error) { toast(error.message); }
};
document.querySelector('#test').onclick = async () => {
  try { const data = await api('/api/notify/test', { method: 'POST' }); toast(data.dryRun ? 'ターミナルにテスト出力しました' : 'LINEへ送信しました'); }
  catch (error) { toast(error.message); }
};
document.querySelectorAll('.filter').forEach(button => button.onclick = () => {
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  filter = button.dataset.filter;
  render();
});

tasksElement.onclick = async event => {
  const edit = event.target.closest('[data-edit]');
  const toggle = event.target.closest('[data-toggle]');
  const remove = event.target.closest('[data-delete]');
  try {
    if (edit) {
      const task = tasks.find(item => item.id === Number(edit.dataset.edit));
      form.dataset.editId = task.id;
      form.elements.course.value = task.course;
      form.elements.title.value = task.title;
      form.elements.dueAt.value = toLocalInput(task.dueAt);
      form.elements.url.value = task.url;
      form.elements.offsets.value = task.reminderOffsets.join(', ');
      form.elements.repeatIntervalMinutes.value = task.repeatIntervalMinutes;
      form.elements.repeatWindowMinutes.value = task.repeatWindowMinutes;
      document.querySelector('#form-title').textContent = '課題を編集';
      document.querySelector('#form-submit').textContent = '変更を保存';
      dialog.showModal();
      return;
    }
    if (toggle) {
      const task = tasks.find(item => item.id === Number(toggle.dataset.toggle));
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: !task.completed }) });
    }
    if (remove && confirm('この課題を削除しますか？')) {
      await api(`/api/tasks/${remove.dataset.delete}`, { method: 'DELETE' });
    }
    await load();
  } catch (error) { toast(error.message); }
};

form.onsubmit = async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  try {
    const editId = form.dataset.editId;
    await api(editId ? `/api/tasks/${editId}` : '/api/tasks', {
      method: editId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        ...values,
        dueAt: new Date(values.dueAt).toISOString(),
        reminderOffsets: values.offsets.split(',').map(value => Number(value.trim())),
        repeatIntervalMinutes: Number(values.repeatIntervalMinutes),
        repeatWindowMinutes: Number(values.repeatWindowMinutes)
      })
    });
    form.reset();
    delete form.dataset.editId;
    dialog.close();
    toast(editId ? '課題を更新しました' : '課題を登録しました');
    await load();
  } catch (error) { toast(error.message); }
};

load().catch(error => toast(error.message));
