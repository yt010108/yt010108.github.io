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

export async function listDrafts({ includeTrash = false } = {}) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("summaries").objectStore("summaries").getAll();
    request.onsuccess = () => resolve(request.result.filter(item => includeTrash || !item.trashedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}

export async function writeDraft(entry, expectedRevision) {
  const sourceDigest = await draftDigest(entry);
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
      result = { ...entry, sourceDigest, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
      store.put(result);
      tx.objectStore("summaries").put(summary(result));
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(conflict || tx.error || new Error("임시저장에 실패했어요."));
    tx.onerror = () => {};
  });
}
import { draftDigest } from "../../shared/posts.js";


function summary(entry) {
  const { id, title, kind, category, tags, date, updatedAt, revision, trashedAt, publication, sourceDigest } = entry;
  return { id, title, kind, category, tags, date, updatedAt, revision, trashedAt, publication, sourceDigest };
}

export async function trashDrafts(items, restore = false, publications = new Map()) {
  if (!items.length) return [];
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["drafts", "summaries"], "readwrite");
    const store = tx.objectStore("drafts"), found = [];
    let remaining = items.length, failure;
    items.forEach(item => {
      const request = store.get(item.id);
      request.onsuccess = () => {
        if (!request.result || request.result.revision !== item.revision) {
          failure = new DraftConflict(); tx.abort(); return;
        }
        found.push(request.result);
        if (--remaining) return;
        const now = new Date().toISOString();
        found.forEach(entry => {
          entry.trashedAt = restore ? null : now;
          if (publications.has(entry.id)) entry.publication = { ...entry.publication, ...publications.get(entry.id) };
          entry.revision++;
          entry.updatedAt = now;
          store.put(entry); tx.objectStore("summaries").put(summary(entry));
        });
      };
    });
    tx.oncomplete = () => resolve(found);
    tx.onabort = () => reject(failure || tx.error || new Error("글 상태를 변경하지 못했어요."));
    tx.onerror = () => {};
  });
}
