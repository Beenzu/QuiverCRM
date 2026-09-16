// Upstash Redis-backed datastore for QuiverCRM.
const { Redis } = require('@upstash/redis');

const DEFAULT_DATA = {
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
  const parsed = await redis.get(DATA_KEY);
  if (parsed && typeof parsed === 'object') {
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
  writeQueue = writeQueue.then(() => redis.set(DATA_KEY, data));
  return writeQueue;
}

module.exports = { init, getData, save: persist, dataKey: DATA_KEY };
