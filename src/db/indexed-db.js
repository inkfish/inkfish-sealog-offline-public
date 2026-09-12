/**
 * IndexedDB wrapper for the sealog-offline database. Uses a singleton Promise
 * for the connection. All public functions are async and interact with the
 * browser IndexedDB API.
 * @module
 */

import { DB_NAME, DB_VERSION, EVENT_STORE, META_STORE, TEMPLATE_STORE } from '../config/constants.js';

/** @type {Promise<IDBDatabase>|null} Singleton connection promise. */
let dbPromise = null;

/**
 * Await the singleton dbPromise, returning null if it rejects.
 * @returns {Promise<IDBDatabase|null>} The open database, or null if opening failed.
 */
async function resolveDbPromise() {
  try {
    return await dbPromise;
  } catch {
    return null;
  }
}

/**
 * Close the open IndexedDB connection and clear the singleton promise.
 * Swallows close errors (logs a warning).
 * @returns {Promise<void>}
 */
export async function closeDb() {
  if (!dbPromise) return;
  const db = await resolveDbPromise();
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.warn('[indexedDb] close failed', err);
    }
  }
  dbPromise = null;
}

/**
 * Lazily open and cache the IndexedDB connection. Creates object stores
 * on upgrade: events (keyPath: client_uuid), meta (keyPath: k),
 * templates (keyPath: id).
 * @returns {Promise<IDBDatabase>} The open database instance.
 * @throws {DOMException} If the IndexedDB open request fails.
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const openReq = indexedDB.open(DB_NAME, DB_VERSION);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(EVENT_STORE)) {
          db.createObjectStore(EVENT_STORE, { keyPath: 'client_uuid' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
          db.createObjectStore(TEMPLATE_STORE, { keyPath: 'id' });
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
  }
  return dbPromise;
}

/**
 * Open a transaction and return the requested object store.
 * @param {string} store - Object store name (EVENT_STORE, META_STORE, or TEMPLATE_STORE).
 * @param {'readonly'|'readwrite'|'versionchange'} mode - IndexedDB transaction mode.
 * @returns {Promise<IDBObjectStore>} The object store from the opened transaction.
 */
export async function storeTransaction(store, mode) {
  return (await getDb()).transaction(store, mode).objectStore(store);
}

/**
 * Retrieve all records from an object store.
 * @param {string} store - Object store name.
 * @returns {Promise<Array<object>>} All records in the store.
 */
export async function getAll(store) {
  const tx = await storeTransaction(store, 'readonly');
  return new Promise((resolve, reject) => {
    const req = tx.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve a single record by key.
 * @param {string} store - Object store name.
 * @param {*} key - Primary key value.
 * @returns {Promise<object | undefined>} The record, or undefined if not found.
 */
export async function get(store, key) {
  const tx = await storeTransaction(store, 'readonly');
  return new Promise((resolve, reject) => {
    const req = tx.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Insert or update a single record. The value must contain the store's
 * keyPath property (e.g. client_uuid for events).
 * @param {string} store - Object store name.
 * @param {object} value - Record to store.
 * @returns {Promise<void>}
 */
export async function put(store, value) {
  const tx = await storeTransaction(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = tx.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Insert or update multiple records in a single transaction.
 * No-op if values is empty or not an array.
 * @param {string} store - Object store name.
 * @param {Array<object>} values - Records to store.
 * @returns {Promise<void>}
 * @throws {DOMException} If the transaction aborts or errors.
 */
export async function putMany(store, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    values.forEach((value) => {
      objectStore.put(value);
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Delete a record by key.
 * @param {string} store - Object store name.
 * @param {*} key - Primary key of the record to delete.
 * @returns {Promise<void>}
 */
export async function del(store, key) {
  const tx = await storeTransaction(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = tx.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
