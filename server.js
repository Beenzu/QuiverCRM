require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const SETUP_KEY = process.env.SETUP_KEY;
const INTEGRATION_KEY = process.env.INTEGRATION_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Missing/weak JWT_SECRET. Set a random secret of at least 32 characters.');
  process.exit(1);
}
if (!SETUP_KEY || SETUP_KEY.length < 12) {
  console.error('Missing/weak SETUP_KEY. Set a private setup key of at least 12 characters.');
  process.exit(1);
}
if (!INTEGRATION_KEY || INTEGRATION_KEY.length < 16) {
  console.error('Missing/weak INTEGRATION_KEY. Set a private key of at least 16 characters — this is what connected stores (e.g. Godwyn Stores) use to push orders in.');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render/Railway sit behind a reverse proxy

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Please try again later.' } });
const setupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many setup attempts. Please try again later.' } });
const integrationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many integration requests. Please slow down.' } });

function newId(prefix) { return prefix + '-' + crypto.randomBytes(5).toString('hex'); }
function cleanText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function normalizePhone(value) { return String(value ?? '').replace(/[^\d+]/g, '').slice(0, 20); }

/* ---------- Auth ---------- */
function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };
}
function issueSession(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('qc_token', token, cookieOptions());
}
function requireAuth(req, res, next) {
  const token = req.cookies.qc_token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = store.getData().users.find(u => u.id === payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or deactivated' });
    req.user = user;
    next();
  } catch {
    res.clearCookie('qc_token', cookieOptions());
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}
function requireIntegrationKey(req, res, next) {
  const key = req.get('X-QuiverCRM-Key') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!key || key !== INTEGRATION_KEY) return res.status(401).json({ error: 'Invalid or missing integration key' });
  next();
}
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt }; }

app.get('/api/status', (_req, res) => res.json({ hasAdmin: store.getData().users.some(u => u.role === 'admin') }));

app.post('/api/setup', setupLimiter, async (req, res) => {
  const data = store.getData();
  if (data.users.some(u => u.role === 'admin')) return res.status(400).json({ error: 'An admin account already exists' });
  const { username, password, setupKey, name } = req.body || {};
  if (setupKey !== SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(String(username || ''))) return res.status(400).json({ error: 'Username must be 3–40 letters, numbers, dots, dashes or underscores' });
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'Use a password of at least 10 characters' });
  const user = {
    id: newId('U'), username: String(username), passwordHash: await bcrypt.hash(String(password), 12),
    name: cleanText(name, 80) || String(username), role: 'admin', active: true, createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  await store.save();
  issueSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const data = store.getData();
  const { username, password } = req.body || {};
  const user = data.users.find(u => u.username === username);
  if (!user || !user.active) return res.status(401).json({ error: 'Incorrect username or password' });
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password' });
  issueSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('qc_token', cookieOptions());
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

/* ---------- Admin: user management ---------- */
app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(store.getData().users.map(publicUser));
});
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const data = store.getData();
  const { username, password, name, role } = req.body || {};
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(String(username || ''))) return res.status(400).json({ error: 'Username must be 3–40 letters, numbers, dots, dashes or underscores' });
  if (data.users.some(u => u.username === username)) return res.status(400).json({ error: 'That username is already taken' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters' });
  if (!['admin', 'agent'].includes(role)) return res.status(400).json({ error: 'Role must be admin or agent' });
  const user = {
    id: newId('U'), username: String(username), passwordHash: await bcrypt.hash(String(password), 12),
    name: cleanText(name, 80) || String(username), role, active: true, createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  await store.save();
  res.json(publicUser(user));
});
app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const data = store.getData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, role, active, password } = req.body || {};
  if (name !== undefined) user.name = cleanText(name, 80) || user.name;
  if (role !== undefined) {
    if (!['admin', 'agent'].includes(role)) return res.status(400).json({ error: 'Role must be admin or agent' });
    if (user.role === 'admin' && role !== 'admin' && data.users.filter(u => u.role === 'admin' && u.active).length <= 1) {
      return res.status(400).json({ error: 'At least one active admin must remain' });
    }
    user.role = role;
  }
  if (active !== undefined) {
    if (user.role === 'admin' && active === false && data.users.filter(u => u.role === 'admin' && u.active).length <= 1) {
      return res.status(400).json({ error: 'At least one active admin must remain' });
    }
    user.active = !!active;
  }
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters' });
    user.passwordHash = await bcrypt.hash(String(password), 12);
  }
  await store.save();
  res.json(publicUser(user));
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const data = store.getData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin' && data.users.filter(u => u.role === 'admin').length <= 1) {
    return res.status(400).json({ error: 'At least one admin must remain' });
  }
  data.users = data.users.filter(u => u.id !== req.params.id);
  // Unassign any tasks that pointed at this user rather than leaving dangling refs
  data.tasks.forEach(t => { if (t.assignedTo === req.params.id) { t.assignedTo = null; t.assignedToName = null; } });
  await store.save();
  res.json({ ok: true });
});

/* ---------- Orders (populated by connected stores) ---------- */
app.get('/api/orders', requireAuth, (_req, res) => res.json(store.getData().orders));
app.patch('/api/orders/:id', requireAuth, async (req, res) => {
  const order = store.getData().orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status } = req.body || {};
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  order.status = status;
  await store.save();
  res.json(order);
});

/* ---------- Customers ---------- */
app.get('/api/customers', requireAuth, (_req, res) => res.json(store.getData().customers));
app.patch('/api/customers/:id', requireAuth, async (req, res) => {
  const customer = store.getData().customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (req.body?.notes !== undefined) customer.notes = cleanText(req.body.notes, 1000);
  await store.save();
  res.json(customer);
});

/* ---------- Tasks ---------- */
app.get('/api/tasks', requireAuth, (req, res) => {
  const tasks = store.getData().tasks;
  if (req.user.role === 'admin') return res.json(tasks);
  res.json(tasks.filter(t => t.assignedTo === req.user.id));
});
app.post('/api/tasks', requireAuth, requireAdmin, async (req, res) => {
  const data = store.getData();
  const { title, description, assignedTo, relatedOrderId, relatedCustomerId, dueDate, priority } = req.body || {};
  const titleClean = cleanText(title, 150);
  if (!titleClean) return res.status(400).json({ error: 'Task title is required' });
  const assignee = assignedTo ? data.users.find(u => u.id === assignedTo && u.active) : null;
  if (assignedTo && !assignee) return res.status(400).json({ error: 'Assigned user not found or inactive' });
  if (!['low', 'medium', 'high'].includes(priority)) return res.status(400).json({ error: 'Priority must be low, medium or high' });
  let dueIso = null;
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid due date' });
    dueIso = parsed.toISOString();
  }
  const task = {
    id: newId('T'), title: titleClean, description: cleanText(description, 1000),
    assignedTo: assignee ? assignee.id : null, assignedToName: assignee ? assignee.name : null,
    createdBy: req.user.id, createdByName: req.user.name,
    relatedOrderId: cleanText(relatedOrderId, 100) || null, relatedCustomerId: cleanText(relatedCustomerId, 100) || null,
    dueDate: dueIso, priority, status: 'open',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  data.tasks.push(task);
  await store.save();
  res.json(task);
});
app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const data = store.getData();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const isAdmin = req.user.role === 'admin';
  const isAssignee = task.assignedTo === req.user.id;
  if (!isAdmin && !isAssignee) return res.status(403).json({ error: 'Not your task' });

  const { title, description, assignedTo, dueDate, priority, status } = req.body || {};
  if (!isAdmin) {
    // Agents may only move their own task through its status.
    if (status !== undefined) {
      if (!['open', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      task.status = status;
    }
  } else {
    if (title !== undefined) { const t = cleanText(title, 150); if (!t) return res.status(400).json({ error: 'Task title is required' }); task.title = t; }
    if (description !== undefined) task.description = cleanText(description, 1000);
    if (priority !== undefined) { if (!['low', 'medium', 'high'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' }); task.priority = priority; }
    if (status !== undefined) { if (!['open', 'in_progress', 'done'].includes(status)) return res.status(400).json({ error: 'Invalid status' }); task.status = status; }
    if (dueDate !== undefined) {
      if (!dueDate) task.dueDate = null;
      else { const parsed = new Date(dueDate); if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid due date' }); task.dueDate = parsed.toISOString(); }
    }
    if (assignedTo !== undefined) {
      if (!assignedTo) { task.assignedTo = null; task.assignedToName = null; }
      else {
        const assignee = data.users.find(u => u.id === assignedTo && u.active);
        if (!assignee) return res.status(400).json({ error: 'Assigned user not found or inactive' });
        task.assignedTo = assignee.id; task.assignedToName = assignee.name;
      }
    }
  }
  task.updatedAt = new Date().toISOString();
  await store.save();
  res.json(task);
});
app.delete('/api/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  const data = store.getData();
  data.tasks = data.tasks.filter(t => t.id !== req.params.id);
  await store.save();
  res.json({ ok: true });
});

/* ---------- Integration: inbound orders from connected stores ----------
 * Called server-to-server (e.g. by Godwyn Stores right after it saves a new
 * order). Authenticated with a shared secret, not a user cookie, since the
 * caller is a backend, not a logged-in person.
 */
app.post('/api/integrations/orders', integrationLimiter, requireIntegrationKey, async (req, res) => {
  const data = store.getData();
  const b = req.body || {};
  const externalId = cleanText(b.externalId, 100);
  const source = cleanText(b.source, 60) || 'External store';
  const customerName = cleanText(b.customerName, 150);
  const phone = normalizePhone(b.phone);
  if (!customerName || !phone) return res.status(400).json({ error: 'customerName and phone are required' });

  if (externalId && data.orders.some(o => o.externalId === externalId && o.source === source)) {
    return res.json({ ok: true, duplicate: true });
  }

  const items = Array.isArray(b.items) ? b.items.slice(0, 50).map(i => ({
    id: cleanText(i?.id, 100), name: cleanText(i?.name, 150),
    price: Number.isFinite(Number(i?.price)) ? Number(i.price) : 0,
    qty: Number.isInteger(Number(i?.qty)) ? Number(i.qty) : 0,
  })) : [];
  const total = Number.isFinite(Number(b.total)) ? Number(b.total) : items.reduce((s, i) => s + i.price * i.qty, 0);
  const createdAt = b.createdAt && !isNaN(Date.parse(b.createdAt)) ? new Date(b.createdAt).toISOString() : new Date().toISOString();

  const order = {
    id: newId('QORD'), externalId: externalId || null, source, items, total,
    currency: cleanText(b.currency, 10) || 'USD',
    customerName, phone, address: cleanText(b.address, 500), notes: cleanText(b.notes, 500),
    status: 'new', createdAt, receivedAt: new Date().toISOString(),
  };
  data.orders.unshift(order);

  let customer = data.customers.find(c => c.phone === phone);
  if (customer) {
    customer.name = customerName;
    if (order.address) customer.address = order.address;
    customer.orderCount = (customer.orderCount || 0) + 1;
    customer.totalSpent = (customer.totalSpent || 0) + total;
    customer.lastOrderAt = order.createdAt;
  } else {
    data.customers.push({
      id: newId('C'), name: customerName, phone, address: order.address, source,
      orderCount: 1, totalSpent: total, lastOrderAt: order.createdAt, notes: '',
    });
  }
  await store.save();
  res.json({ ok: true, orderId: order.id });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`QuiverCRM running on http://localhost:${PORT}`));
