const $ = (selector) => document.querySelector(selector);
let snapshot = { configured_instances: [], instances: [], whitelist: [], events: [], telegram: {} };
let toastTimer;
let telegramInitialized = false;

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function speed(kib) {
  return kib >= 1024 ? `${(kib / 1024).toFixed(1)} MiB/s` : `${Number(kib || 0).toFixed(1)} KiB/s`;
}

function cell(row, content, className = '') {
  const td = document.createElement('td');
  td.className = className;
  if (content instanceof Node) td.append(content); else td.textContent = content;
  row.append(td);
  return td;
}

function metric(primary, secondary) {
  const box = document.createElement('div');
  box.className = 'metric';
  const main = document.createElement('span'); main.textContent = primary;
  const small = document.createElement('small'); small.textContent = secondary;
  box.append(main, small);
  return box;
}

function renderInstances() {
  const body = $('#instances-body');
  body.replaceChildren();
  if (!snapshot.configured_instances.length) {
    const row = document.createElement('tr'); cell(row, '尚未配置 qBittorrent 实例', 'empty').colSpan = 7; body.append(row); return;
  }
  const runtime = new Map(snapshot.instances.map((item) => [item.name, item]));
  snapshot.configured_instances.forEach((config) => {
    const state = runtime.get(config.name) || {};
    const row = document.createElement('tr');
    const name = document.createElement('div'); name.className = 'instance-name';
    const dot = document.createElement('i'); dot.className = `dot ${state.connected ? 'ok' : ''}`;
    const label = document.createElement('span'); label.textContent = config.name; name.append(dot, label); cell(row, name);
    cell(row, metric(`↑ ${speed(state.upload_speed_kib)}`, `↓ ${speed(state.download_speed_kib)}`));
    cell(row, metric(`${state.active_downloads || 0} 活跃`, `${state.waiting_downloads || 0} 等待`));
    cell(row, metric(`${state.free_space_gib || 0} GiB`, `保留 ${state.reserved_space_gib || 0} GiB`));
    const traffic = state.traffic_limit_gib ? `${state.traffic_out_gib} / ${state.traffic_limit_gib} GiB` : '未限制';
    cell(row, traffic);
    cell(row, String(state.total_added_tasks || 0));
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const edit = document.createElement('button'); edit.className = 'button secondary'; edit.textContent = '编辑'; edit.onclick = () => openInstance(config);
    const remove = document.createElement('button'); remove.className = 'button danger'; remove.textContent = '删除'; remove.onclick = () => deleteInstance(config.name);
    actions.append(edit, remove); cell(row, actions); body.append(row);
  });
}

function renderWhitelist() {
  const list = $('#whitelist-list'); list.replaceChildren();
  const mode = $('#whitelist-mode');
  if (!snapshot.whitelist.length) {
    mode.textContent = '当前为空：Webhook 允许任意来源 IP（兼容旧版行为）'; mode.className = 'notice warning'; return;
  }
  mode.textContent = `已启用限制，仅允许以下 ${snapshot.whitelist.length} 个地址或网段`; mode.className = 'notice';
  snapshot.whitelist.forEach((entry) => {
    const tag = document.createElement('div'); tag.className = 'tag';
    const text = document.createElement('span'); text.textContent = entry;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = `移除 ${entry}`; remove.onclick = () => deleteWhitelist(entry);
    tag.append(text, remove); list.append(tag);
  });
}

const statusNames = { queued: '已入队', success: '已添加', error: '失败', blocked: '已拦截', config: '配置' };
function renderEvents() {
  const list = $('#events-list'); list.replaceChildren();
  if (!snapshot.events.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = '暂无事件'; list.append(empty); return; }
  snapshot.events.forEach((event) => {
    const item = document.createElement('li');
    const status = document.createElement('span'); status.className = `event-status ${event.status}`; status.textContent = statusNames[event.status] || event.status;
    const detail = document.createElement('div'); detail.className = 'event-detail'; detail.textContent = event.release_name;
    const small = document.createElement('small'); small.textContent = [event.detail, event.source_ip].filter(Boolean).join(' · '); detail.append(small);
    const time = document.createElement('time'); time.textContent = new Date(event.timestamp).toLocaleString();
    item.append(status, detail, time); list.append(item);
  });
}

function renderSummary() {
  const connected = snapshot.instances.filter((item) => item.connected).length;
  $('#connected-count').textContent = `${connected} / ${snapshot.instances.length}`;
  $('#total-upload').textContent = speed(snapshot.instances.reduce((sum, item) => sum + item.upload_speed_kib, 0));
  $('#total-download').textContent = speed(snapshot.instances.reduce((sum, item) => sum + item.download_speed_kib, 0));
  $('#pending-count').textContent = snapshot.pending_count;
  $('#updated-at').textContent = new Date(snapshot.updated_at).toLocaleString();
}

function renderTelegram() {
  const telegram = snapshot.telegram || {};
  $('#telegram-state').textContent = telegram.enabled ? `已启用 · ${telegram.chat_id}` : (telegram.bot_token_configured ? '已配置，当前停用' : '尚未配置 Token');
  $('#telegram-token').placeholder = telegram.bot_token_configured ? '已保存；留空则保持当前 Token' : '请输入 BotFather 提供的 Token';
  if (!telegramInitialized) {
    $('#telegram-enabled').checked = Boolean(telegram.enabled);
    $('#telegram-chat-id').value = telegram.chat_id || '';
    $('#telegram-timeout').value = telegram.timeout || 10;
    telegramInitialized = true;
  }
}

async function refresh() {
  try {
    snapshot = await api('/api/dashboard/status');
    renderSummary(); renderInstances(); renderWhitelist(); renderTelegram(); renderEvents();
    $('#connection-state').classList.remove('offline');
  } catch (error) {
    $('#connection-state').classList.add('offline'); notify(error.message);
  }
}

function openInstance(config = null) {
  $('#instance-form').reset(); $('#instance-error').textContent = '';
  $('#original-name').value = config?.name || '';
  $('#dialog-title').textContent = config ? `编辑 ${config.name}` : '添加实例';
  $('#instance-name').value = config?.name || '';
  $('#instance-url').value = config?.url || '';
  $('#instance-username').value = config?.username || '';
  $('#traffic-url').value = config?.traffic_check_url || '';
  $('#traffic-limit').value = config?.traffic_limit ?? 0;
  $('#reserved-space').value = config?.reserved_space ?? 21504;
  $('#password-hint').textContent = config?.has_password ? '留空则保持当前密码' : '新实例必须填写密码';
  $('#instance-password').required = !config?.has_password;
  $('#instance-dialog').showModal();
}

$('#instance-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-instance'); button.disabled = true; $('#instance-error').textContent = '';
  const payload = { original_name: $('#original-name').value, name: $('#instance-name').value, url: $('#instance-url').value, username: $('#instance-username').value, password: $('#instance-password').value, traffic_check_url: $('#traffic-url').value, traffic_limit: $('#traffic-limit').value, reserved_space: $('#reserved-space').value };
  try { const result = await api('/api/dashboard/instances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); $('#instance-dialog').close(); notify(`${result.name} 已保存${result.connected ? '并连接' : '，但连接失败'}`); await refresh(); }
  catch (error) { $('#instance-error').textContent = error.message; }
  finally { button.disabled = false; }
});

async function deleteInstance(name) {
  if (!confirm(`确认删除实例“${name}”？`)) return;
  try { await api('/api/dashboard/instances', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); notify(`${name} 已删除`); await refresh(); } catch (error) { notify(error.message); }
}

$('#whitelist-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const input = $('#whitelist-entry');
  try { await api('/api/dashboard/whitelist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: input.value }) }); input.value = ''; await refresh(); } catch (error) { notify(error.message); }
});

async function deleteWhitelist(entry) {
  if (!confirm(`移除白名单“${entry}”？`)) return;
  try { await api('/api/dashboard/whitelist', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry }) }); await refresh(); } catch (error) { notify(error.message); }
}

$('#config-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!confirm('导入将替换当前负载均衡配置并重建实例连接，确认继续？')) { event.target.value = ''; return; }
  const form = new FormData(); form.append('config', file);
  try { const result = await api('/api/dashboard/config/import', { method: 'POST', body: form }); notify(`已导入 ${result.instances} 个实例；端口等服务设置需重启生效`); await refresh(); } catch (error) { notify(error.message); }
  finally { event.target.value = ''; }
});

$('#telegram-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-telegram'); button.disabled = true; $('#telegram-error').textContent = '';
  const payload = { enabled: $('#telegram-enabled').checked, bot_token: $('#telegram-token').value, chat_id: $('#telegram-chat-id').value, timeout: $('#telegram-timeout').value };
  try { await api('/api/dashboard/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); $('#telegram-token').value = ''; telegramInitialized = false; notify('Telegram 配置已保存并立即生效'); await refresh(); }
  catch (error) { $('#telegram-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#test-telegram').addEventListener('click', async () => {
  const button = $('#test-telegram'); button.disabled = true; $('#telegram-error').textContent = '';
  try { await api('/api/dashboard/telegram/test', { method: 'POST' }); notify('测试通知已加入发送队列'); }
  catch (error) { $('#telegram-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#add-instance').addEventListener('click', () => openInstance());
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $('#instance-dialog').close()));
refresh(); setInterval(refresh, 5000);
