// Upstash Redis-backed datastore for QuiverCRM.
const { Redis } = require('@upstash/redis');
const DEFAULT_DATA = { vendors: [], users: [], customers: [], orders: [], tasks: [], activity: [] };
const redis = Redis.fromEnv();
const DATA_KEY = process.env.UPSTASH_DATA_KEY || 'quivercrm:data:v2';
let data = null;
let writeQueue = Promise.resolve();
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cloneDefault() { return clone(DEFAULT_DATA); }
async function init() {
  const parsed = await redis.get(DATA_KEY);
  if (parsed && typeof parsed === 'object') data = { ...cloneDefault(), ...clone(parsed) };
  else { data = cloneDefault(); await persist(); }
  return data;
}
function getData() { if (!data) throw new Error('QuiverCRM datastore is not initialized'); return data; }
function persist() {
  const snapshot = clone(getData());
  writeQueue = writeQueue.catch(() => {}).then(() => redis.set(DATA_KEY, snapshot));
  return writeQueue;
}
async function health() { await redis.get(DATA_KEY); return true; }
module.exports = { init, getData, save: persist, health, dataKey: DATA_KEY };
