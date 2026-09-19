const DB_NAME = 'quick-hardsub-font-library';
const DB_VERSION = 1;
const STORE = 'fonts';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 操作失败'));
  });
}

function fontId(file) {
  return [
    String(file.name || '').toLowerCase(),
    Number(file.size || 0),
    Number(file.lastModified || 0)
  ].join('::');
}

export async function listSavedFonts() {
  if (!('indexedDB' in globalThis)) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const rows = await requestToPromise(tx.objectStore(STORE).getAll());
    return rows.map(row => new File(
      [row.blob],
      row.name,
      {
        type: row.type || row.blob?.type || 'application/octet-stream',
        lastModified: row.lastModified || Date.now()
      }
    ));
  } finally {
    db.close();
  }
}

export async function saveFonts(files = []) {
  if (!('indexedDB' in globalThis) || !files.length) return 0;
  const db = await openDb();
  let saved = 0;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const file of files) {
      const blob = file instanceof Blob
        ? file.slice(0, file.size, file.type || 'application/octet-stream')
        : new Blob([file]);
      store.put({
        id: fontId(file),
        name: file.name,
        type: file.type || blob.type,
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        blob
      });
      saved++;
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('保存字体失败'));
      tx.onabort = () => reject(tx.error || new Error('保存字体事务被中止'));
    });
    return saved;
  } finally {
    db.close();
  }
}

export async function deleteSavedFont(file) {
  if (!('indexedDB' in globalThis)) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(fontId(file));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('删除字体失败'));
      tx.onabort = () => reject(tx.error || new Error('删除字体事务被中止'));
    });
  } finally {
    db.close();
  }
}

export async function clearSavedFonts() {
  if (!('indexedDB' in globalThis)) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('清空字体库失败'));
      tx.onabort = () => reject(tx.error || new Error('清空字体库事务被中止'));
    });
  } finally {
    db.close();
  }
}
