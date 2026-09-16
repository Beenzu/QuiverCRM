window.addEventListener('error', (event) => {
  const app = document.getElementById('app');
  if (app && !app.innerHTML.trim()) {
    app.innerHTML = `<div class="wrap"><div class="panel"><h2>QuiverCRM</h2><p>There was a problem loading the app.</p><p class="muted">Please refresh the page.</p></div></div>`;
  }
});

const state = {
  loading: true,
  hasAdmin: false,
  me: null, // { id, username, name, role, active }
  view: 'auth', // auth | app
  tab: 'orders', // orders | customers | tasks | users
  orders: [],
  customers: [],
  tasks: [],
  users: [],
  authError: '',
  toast: null,
  creatingTask: false,
  creatingUser: false,
  editingTaskId: null,
};

/* ---------------- API helper ---------------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong');
    err.status = res.status;
    throw err;
  }
  return data;
}

function showToast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => { state.toast = null; render(); }, 2500);
}

/* ---------------- Init ---------------- */
async function init() {
  try {
    const status = await api('/api/status');
    state.hasAdmin = status.hasAdmin;
    try {
      state.me = await api('/api/me');
      state.view = 'app';
      await loadAppData();
    } catch (e) { state.view = 'auth'; }
  } catch (e) {
    showToast('Could not reach the server: ' + e.message);
  }
  state.loading = false;
  render();
}

async function loadAppData() {
  const calls = [api('/api/orders'), api('/api/customers'), api('/api/tasks')];
  if (state.me.role === 'admin') calls.push(api('/api/admin/users'));
  const results = await Promise.all(calls);
  state.orders = results[0];
  state.customers = results[1];
  state.tasks = results[2];
  if (state.me.role === 'admin') state.users = results[3];
}

/* ---------------- Auth ---------------- */
async function handleAuthSubmit(formEl) {
  const data = new FormData(formEl);
  const username = (data.get('username') || '').trim();
  const password = (data.get('password') || '').trim();
  if (!username || !password) { showToast('Enter a username and password'); return; }
  state.authError = '';
  try {
    if (!state.hasAdmin) {
      const setupKey = (data.get('setupKey') || '').trim();
      const name = (data.get('name') || '').trim();
      const result = await api('/api/setup', { method: 'POST', body: { username, password, setupKey, name } });
      state.me = result.user;
      state.hasAdmin = true;
    } else {
      const result = await api('/api/login', { method: 'POST', body: { username, password } });
      state.me = result.user;
    }
    state.view = 'app';
    await loadAppData();
    render();
  } catch (e) {
    state.authError = e.message;
    render();
  }
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  state.me = null;
  state.view = 'auth';
  render();
}

/* ---------------- Orders ---------------- */
async function setOrderStatus(orderId, status) {
  try {
    const updated = await api('/api/orders/' + orderId, { method: 'PATCH', body: { status } });
    const idx = state.orders.findIndex(o => o.id === orderId);
    state.orders[idx] = updated;
    render();
  } catch (e) { showToast(e.message); }
}

/* ---------------- Customers ---------------- */
async function saveCustomerNotes(id, formEl) {
  const data = new FormData(formEl);
  try {
    const updated = await api('/api/customers/' + id, { method: 'PATCH', body: { notes: (data.get('notes') || '').trim() } });
    const idx = state.customers.findIndex(c => c.id === id);
    state.customers[idx] = updated;
    showToast('Note saved');
  } catch (e) { showToast(e.message); }
}

/* ---------------- Tasks ---------------- */
function startCreateTask() { state.creatingTask = true; render(); }
function cancelCreateTask() { state.creatingTask = false; render(); }
async function submitNewTask(formEl) {
  const data = new FormData(formEl);
  const body = {
    title: (data.get('title') || '').trim(),
    description: (data.get('description') || '').trim(),
    assignedTo: data.get('assignedTo') || null,
    dueDate: data.get('dueDate') || null,
    priority: data.get('priority') || 'medium',
    relatedOrderId: (data.get('relatedOrderId') || '').trim(),
  };
  if (!body.title) { showToast('Task title is required'); return; }
  try {
    const task = await api('/api/tasks', { method: 'POST', body });
    state.tasks.unshift(task);
    state.creatingTask = false;
    showToast('Task assigned');
    render();
  } catch (e) { showToast(e.message); }
}
async function setTaskStatus(taskId, status) {
  try {
    const updated = await api('/api/tasks/' + taskId, { method: 'PATCH', body: { status } });
    const idx = state.tasks.findIndex(t => t.id === taskId);
    state.tasks[idx] = updated;
    render();
  } catch (e) { showToast(e.message); }
}
async function reassignTask(taskId, assignedTo) {
  try {
    const updated = await api('/api/tasks/' + taskId, { method: 'PATCH', body: { assignedTo: assignedTo || null } });
    const idx = state.tasks.findIndex(t => t.id === taskId);
    state.tasks[idx] = updated;
    showToast('Task reassigned');
    render();
  } catch (e) { showToast(e.message); }
}
async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    await api('/api/tasks/' + taskId, { method: 'DELETE' });
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    render();
  } catch (e) { showToast(e.message); }
}

/* ---------------- Users (admin) ---------------- */
function startCreateUser() { state.creatingUser = true; render(); }
function cancelCreateUser() { state.creatingUser = false; render(); }
async function submitNewUser(formEl) {
  const data = new FormData(formEl);
  const body = {
    username: (data.get('username') || '').trim(),
    password: (data.get('password') || '').trim(),
    name: (data.get('name') || '').trim(),
    role: data.get('role') || 'agent',
  };
  if (!body.username || !body.password) { showToast('Enter a username and password'); return; }
  try {
    const user = await api('/api/admin/users', { method: 'POST', body });
    state.users.push(user);
    state.creatingUser = false;
    showToast('User created');
    render();
  } catch (e) { showToast(e.message); }
}
async function toggleUserActive(id, active) {
  try {
    const updated = await api('/api/admin/users/' + id, { method: 'PATCH', body: { active } });
    const idx = state.users.findIndex(u => u.id === id);
    state.users[idx] = updated;
    render();
  } catch (e) { showToast(e.message); }
}
async function deleteUser(id) {
  if (!confirm('Remove this user? Their assigned tasks will become unassigned.')) return;
  try {
    await api('/api/admin/users/' + id, { method: 'DELETE' });
    state.users = state.users.filter(u => u.id !== id);
    render();
  } catch (e) { showToast(e.message); }
}

/* ---------------- Render ---------------- */
function render() {
  const app = document.getElementById('app');
  if (state.loading) { app.innerHTML = '<div class="wrap"><p class="muted">Loading QuiverCRM…</p></div>'; return; }
  if (state.view === 'auth') return renderAuth(app);
  return renderApp(app);
}

function topbar() {
  return `
  <div class="topbar">
    <div><p class="brand">QuiverCRM<small>${state.me ? escapeHtml(state.me.name) + ' · ' + escapeHtml(state.me.role) : 'Sales &amp; task management'}</small></p></div>
    ${state.me ? `<div class="topbar-right"><a class="icon-link" href="#" onclick="event.preventDefault(); logout();">Log out</a></div>` : ''}
  </div>`;
}

function renderAuth(app) {
  const needsSetup = !state.hasAdmin;
  app.innerHTML = `
  ${topbar()}
  <div class="wrap">
    <div class="login-wrap">
      <h2>${needsSetup ? 'Set up QuiverCRM' : 'Log in'}</h2>
      ${needsSetup ? `<p class="muted">No admin account exists yet — create one now to manage users and tasks.</p>` : ''}
      <form onsubmit="event.preventDefault(); handleAuthSubmit(this);">
        ${needsSetup ? `<div class="field"><label>Private setup key</label><input name="setupKey" type="password" required autocomplete="off"><small class="muted">Set in your hosting environment, not your login password.</small></div>` : ''}
        ${needsSetup ? `<div class="field"><label>Your name</label><input name="name" required></div>` : ''}
        <div class="field"><label>Username</label><input name="username" required autocomplete="username"></div>
        <div class="field"><label>Password</label><input name="password" type="password" required minlength="${needsSetup ? 10 : 1}"></div>
        <button class="btn full" type="submit">${needsSetup ? 'Create admin account' : 'Log in'}</button>
        ${state.authError ? `<p class="error-text">${escapeHtml(state.authError)}</p>` : ''}
      </form>
    </div>
  </div>`;
}

function renderApp(app) {
  const isAdmin = state.me.role === 'admin';
  const newOrders = state.orders.filter(o => o.status === 'new').length;
  const myOpenTasks = state.tasks.filter(t => t.status !== 'done' && (isAdmin || t.assignedTo === state.me.id)).length;
  app.innerHTML = `
  ${topbar()}
  <div class="wrap">
    <div class="top-admin-bar"><h2 style="margin:0;">${isAdmin ? 'Dashboard' : 'My workspace'}</h2><span class="muted">${newOrders} new order${newOrders===1?'':'s'} · ${myOpenTasks} open task${myOpenTasks===1?'':'s'}</span></div>
    <div class="tabbar">
      <button class="${state.tab==='orders'?'active':''}" onclick="state.tab='orders'; render();">Orders</button>
      <button class="${state.tab==='customers'?'active':''}" onclick="state.tab='customers'; render();">Customers</button>
      <button class="${state.tab==='tasks'?'active':''}" onclick="state.tab='tasks'; render();">${isAdmin ? 'Tasks' : 'My tasks'}</button>
      ${isAdmin ? `<button class="${state.tab==='users'?'active':''}" onclick="state.tab='users'; render();">Users</button>` : ''}
    </div>
    ${state.tab === 'orders' ? renderOrdersTab() : ''}
    ${state.tab === 'customers' ? renderCustomersTab() : ''}
    ${state.tab === 'tasks' ? renderTasksTab(isAdmin) : ''}
    ${state.tab === 'users' && isAdmin ? renderUsersTab() : ''}
  </div>
  ${toastHtml()}`;
}

function money(n, currency) { return (currency || '') + ' ' + Number(n || 0).toFixed(2); }

function renderOrdersTab() {
  if (state.orders.length === 0) return `<div class="empty-state">No orders yet. Orders placed on connected stores will appear here automatically.</div>`;
  return state.orders.map(o => `
    <div class="panel">
      <div class="section-head">
        <div>
          <h3 style="margin:0;">${escapeHtml(o.externalId || o.id)}</h3>
          <span class="muted">${escapeHtml(o.source)} · ${new Date(o.createdAt).toLocaleString()}</span>
        </div>
        <span class="badge ${o.status}">${o.status}</span>
      </div>

      <div class="order-meta">
        <div><strong>${escapeHtml(o.customerName)}</strong></div>
        <div class="muted">${escapeHtml(o.phone)}${o.altPhone ? ' · alt: ' + escapeHtml(o.altPhone) : ''}</div>
        ${o.town || o.province ? `<div class="muted">${escapeHtml([o.town, o.province].filter(Boolean).join(', '))}</div>` : ''}
        ${o.address ? `<div class="muted">${escapeHtml(o.address)}</div>` : ''}
        ${o.deliveryDate || o.deliveryWindow ? `<div class="muted">Preferred delivery: ${escapeHtml([o.deliveryDate, o.deliveryWindow].filter(Boolean).join(' · '))}</div>` : ''}
        ${o.notes ? `<div class="muted">Notes: ${escapeHtml(o.notes)}</div>` : ''}
      </div>

      <table style="margin-top:12px;">
        <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Unit price</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${(o.items || []).length === 0 ? `<tr><td colspan="5" class="muted">No item details received</td></tr>` : o.items.map(i => `
          <tr>
            <td>${escapeHtml(i.name || i.id || '—')}</td>
            <td>${escapeHtml(i.category || '—')}</td>
            <td>${i.qty}</td>
            <td>${money(i.price, o.currency)}</td>
            <td>${money(i.price * i.qty, o.currency)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="total-row" style="margin-top:8px;"><span>Total</span><span>${money(o.total, o.currency)}</span></div>

      <div class="row-actions" style="margin-top:10px;">
        <select onchange="setOrderStatus('${o.id}', this.value)">${['new','contacted','won','lost'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
    </div>`).join('');
}

function renderCustomersTab() {
  if (state.customers.length === 0) return `<div class="empty-state">No customers yet — they'll appear after their first order comes in.</div>`;
  const sorted = [...state.customers].sort((a, b) => new Date(b.lastOrderAt) - new Date(a.lastOrderAt));
  return sorted.map(c => `
    <div class="panel">
      <div class="section-head">
        <div><h3 style="margin:0;">${escapeHtml(c.name)}</h3><span class="muted">${escapeHtml(c.phone)}${c.town || c.province ? ' · ' + escapeHtml([c.town, c.province].filter(Boolean).join(', ')) : ''}${c.address ? ' · ' + escapeHtml(c.address) : ''} · via ${escapeHtml(c.source||'—')}</span></div>
        <div style="text-align:right;"><div>${c.orderCount} order${c.orderCount===1?'':'s'} · ${money(c.totalSpent, '')}</div><div class="muted">Last order: ${new Date(c.lastOrderAt).toLocaleDateString()}</div></div>
      </div>
      <form onsubmit="event.preventDefault(); saveCustomerNotes('${c.id}', this);">
        <div class="field"><label>Notes</label><textarea name="notes" placeholder="e.g. prefers WhatsApp, follow up next week...">${escapeHtml(c.notes||'')}</textarea></div>
        <button class="btn small" type="submit">Save note</button>
      </form>
    </div>`).join('');
}

function priorityBadge(p) { return `<span class="badge ${p==='high'?'cancelled':p==='medium'?'new':'contacted'}">${p}</span>`; }

function renderTasksTab(isAdmin) {
  const activeUsers = state.users.filter(u => u.active);
  const createForm = isAdmin ? `
    <div class="section-head"><h2>Tasks</h2><button class="btn" onclick="startCreateTask()">+ Assign task</button></div>
    ${state.creatingTask ? `
    <div class="panel">
      <h3 style="margin-top:0;">New task</h3>
      <form onsubmit="event.preventDefault(); submitNewTask(this);">
        <div class="form-grid">
          <div class="field"><label>Title</label><input name="title" required></div>
          <div class="field"><label>Assign to</label>
            <select name="assignedTo"><option value="">Unassigned</option>${activeUsers.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} (${u.role})</option>`).join('')}</select>
          </div>
          <div class="field"><label>Priority</label>
            <select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
          </div>
          <div class="field"><label>Due date (optional)</label><input name="dueDate" type="date"></div>
          <div class="field"><label>Related order ID (optional)</label><input name="relatedOrderId" placeholder="e.g. ORD-abc123"></div>
        </div>
        <div class="field"><label>Description</label><textarea name="description" placeholder="What needs to happen"></textarea></div>
        <div class="row-actions">
          <button class="btn" type="submit">Assign task</button>
          <button class="btn ghost" type="button" onclick="cancelCreateTask()">Cancel</button>
        </div>
      </form>
    </div>` : ''}
  ` : `<div class="section-head"><h2>My tasks</h2></div>`;

  if (state.tasks.length === 0) return createForm + `<div class="empty-state">No tasks ${isAdmin ? 'yet — assign the first one above.' : 'assigned to you yet.'}</div>`;

  const sorted = [...state.tasks].sort((a, b) => (a.status==='done')-(b.status==='done') || new Date(b.createdAt) - new Date(a.createdAt));
  const cards = sorted.map(t => `
    <div class="panel">
      <div class="section-head">
        <div>
          <h3 style="margin:0;">${escapeHtml(t.title)} ${priorityBadge(t.priority)}</h3>
          <span class="muted">${t.assignedToName ? 'Assigned to ' + escapeHtml(t.assignedToName) : 'Unassigned'}${t.dueDate ? ' · due ' + new Date(t.dueDate).toLocaleDateString() : ''}${isAdmin ? ' · by ' + escapeHtml(t.createdByName||'—') : ''}</span>
        </div>
        <span class="badge ${t.status==='done'?'delivered':t.status==='in_progress'?'contacted':'new'}">${t.status.replace('_',' ')}</span>
      </div>
      ${t.description ? `<p class="muted">${escapeHtml(t.description)}</p>` : ''}
      ${t.relatedOrderId ? `<p class="muted">Related order: ${escapeHtml(t.relatedOrderId)}</p>` : ''}
      <div class="row-actions" style="margin-top:10px;">
        <select onchange="setTaskStatus('${t.id}', this.value)">
          ${['open','in_progress','done'].map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
        </select>
        ${isAdmin ? `
        <select onchange="reassignTask('${t.id}', this.value)">
          <option value="">Unassigned</option>
          ${activeUsers.map(u=>`<option value="${u.id}" ${t.assignedTo===u.id?'selected':''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
        <button class="btn small alert" onclick="deleteTask('${t.id}')">Delete</button>` : ''}
      </div>
    </div>`).join('');
  return createForm + cards;
}

function renderUsersTab() {
  return `
    <div class="section-head"><h2>Users</h2><button class="btn" onclick="startCreateUser()">+ Add user</button></div>
    ${state.creatingUser ? `
    <div class="panel">
      <h3 style="margin-top:0;">New user</h3>
      <form onsubmit="event.preventDefault(); submitNewUser(this);">
        <div class="form-grid">
          <div class="field"><label>Full name</label><input name="name" required></div>
          <div class="field"><label>Username</label><input name="username" required></div>
          <div class="field"><label>Temporary password</label><input name="password" type="password" required minlength="8"></div>
          <div class="field"><label>Role</label><select name="role"><option value="agent">Agent</option><option value="admin">Admin</option></select></div>
        </div>
        <div class="row-actions">
          <button class="btn" type="submit">Create user</button>
          <button class="btn ghost" type="button" onclick="cancelCreateUser()">Cancel</button>
        </div>
      </form>
    </div>` : ''}
    <table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${state.users.map(u => `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.role)}</td>
          <td><span class="badge ${u.active?'delivered':'cancelled'}">${u.active?'active':'inactive'}</span></td>
          <td class="row-actions">
            ${u.active
              ? `<button class="btn small ghost" onclick="toggleUserActive('${u.id}', false)">Deactivate</button>`
              : `<button class="btn small ghost" onclick="toggleUserActive('${u.id}', true)">Reactivate</button>`}
            <button class="btn small alert" onclick="deleteUser('${u.id}')">Remove</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function toastHtml() { return state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''; }
function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

init();
