// Upstash Redis-backed datastore for QuiverCRM.
const { Redis } = require('@upstash/redis');
const DEFAULT_DATA = { vendors: [], users: [], customers: [], orders: [], tasks: [], activity: [], passwordResetRequests: [] };
const COLLECTIONS = Object.keys(DEFAULT_DATA);
const redis = Redis.fromEnv();
const DATA_KEY = process.env.UPSTASH_DATA_KEY || 'quivercrm:data:v2';
let data = null;
let persistedSnapshot = null;
let writeQueue = Promise.resolve();
let lastLoadedAt = 0;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cloneDefault() { return clone(DEFAULT_DATA); }
function normalize(parsed) { return parsed && typeof parsed === 'object' ? { ...cloneDefault(), ...clone(parsed) } : cloneDefault(); }

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); })
    ]);
  } finally { clearTimeout(timer); }
}

async function readRemote() {
  return normalize(await withTimeout(redis.get(DATA_KEY), 10000, 'Redis read'));
}

async function init() {
  data = await readRemote();
  if (!data || typeof data !== 'object') data = cloneDefault();
  persistedSnapshot = clone(data);
  lastLoadedAt = Date.now();
  // Do not rewrite Redis on every boot. This is important during Render deploys,
  // where an old and new instance can briefly overlap.
  return data;
}

function getData() {
  if (!data) throw new Error('QuiverCRM datastore is not initialized');
  return data;
}

function collectionMap(list) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) if (item && item.id) map.set(item.id, item);
  return map;
}

// Merge only changes made by this process since its last persisted snapshot into
// the latest Redis snapshot. This prevents an older Render instance from
// overwriting a vendor/order created by a newer instance during a deploy.
function mergeLocalChanges(remote) {
  if (!persistedSnapshot) return clone(getData());
  const local = getData();
  const merged = normalize(remote);
  for (const key of COLLECTIONS) {
    const before = collectionMap(persistedSnapshot[key]);
    const current = collectionMap(local[key]);
    const remoteMap = collectionMap(remote[key]);
    const ids = new Set([...before.keys(), ...current.keys(), ...remoteMap.keys()]);

    for (const id of ids) {
      const was = before.get(id);
      const now = current.get(id);
      const remoteItem = remoteMap.get(id);
      const changed = JSON.stringify(was) !== JSON.stringify(now);
      const added = !was && !!now;
      const removed = !!was && !now;
      if (changed || added || removed) {
        if (removed) remoteMap.delete(id);
        else remoteMap.set(id, clone(now));
      }
    }
    merged[key] = Array.from(remoteMap.values());
  }
  return merged;
}

function persist() {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const remote = await readRemote();
    const snapshot = mergeLocalChanges(remote);
    await withTimeout(redis.set(DATA_KEY, snapshot), 10000, 'Redis write');
    data = snapshot;
    persistedSnapshot = clone(snapshot);
    lastLoadedAt = Date.now();
  });
  return writeQueue;
}

async function reload() {
  data = await readRemote();
  persistedSnapshot = clone(data);
  lastLoadedAt = Date.now();
  return data;
}

async function health() { await redis.get(DATA_KEY); return true; }
function info() { return { dataKey: DATA_KEY, initialized: !!data, lastLoadedAt }; }
module.exports = { init, reload, getData, save: persist, health, info, dataKey: DATA_KEY };
