// Upstash Redis-backed datastore for QuiverCRM.
const { Redis } = require('@upstash/redis');

const DEFAULT_DATA = {
  vendors: [],
  users: [],
  customers: [],
  orders: [],
  tasks: [],
  activity: [],
};

const redis = Redis.fromEnv();
const DATA_KEY = process.env.UPSTASH_DATA_KEY || 'quivercrm:data:v2';
let data = null;
let writeQueue = Promise.resolve();

function cloneDefault() { return JSON.parse(JSON.stringify(DEFAULT_DATA)); }

async function init() {
  const raw = await redis.get(DATA_KEY);
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    data = { ...cloneDefault(), ...parsed };
  } else {
    data = cloneDefault();
    await persist();
  }
  return data;
}

function getData() {
  if (!data) throw new Error('QuiverCRM datastore is not initialized');
  return data;
}

function persist() {
  // Persist an immutable snapshot, not the live object. This prevents a
  // later request from changing the object while an earlier Redis write is
  // still queued and accidentally overwriting newer data.
  const snapshot = JSON.parse(JSON.stringify(data));
  writeQueue = writeQueue.catch(() => undefined).then(() => redis.set(DATA_KEY, JSON.stringify(snapshot)));
  return writeQueue;
}

module.exports = { init, getData, save: persist, dataKey: DATA_KEY };
