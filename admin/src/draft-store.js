const DATABASE = "yt010108-writing";
let connection;

export class DraftConflict extends Error {
  constructor() { super("다른 탭에서 이 글이 변경됐어요. 현재 내용을 복사본으로 저장해 주세요."); this.name = "DraftConflict"; }
}

function database() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts", { keyPath: "id" });
      request.result.createObjectStore("summaries", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("다른 탭을 닫은 뒤 다시 저장해 주세요."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

export async function readDraft(id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listDrafts() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("summaries").objectStore("summaries").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}

export async function writeDraft(entry, expectedRevision) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["drafts", "summaries"], "readwrite");
    const store = tx.objectStore("drafts");
    const request = store.get(entry.id);
    let result, conflict;
    request.onsuccess = () => {
      if ((request.result?.revision || 0) !== expectedRevision) {
        conflict = new DraftConflict();
        tx.abort();
        return;
      }
      result = { ...entry, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
      store.put(result);
      tx.objectStore("summaries").put({
        id: result.id, title: result.title, kind: result.kind, category: result.category,
        updatedAt: result.updatedAt, revision: result.revision
      });
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(conflict || tx.error || new Error("임시저장에 실패했어요."));
    tx.onerror = () => {};
  });
}
