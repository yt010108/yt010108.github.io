import { POST_FORMAT, INDEX_FORMAT, UUID, SHA, entryPath, uploadPath, validateRecord, validateIndex, indexEntry, draftDigest } from "../../shared/posts.js";
import { newEntry, safeImageData, MAX_IMAGE_SIZE } from "./document.js";

export const REPOSITORY = "yt010108/yt010108.github.io";
export const BRANCH = "main";
export const SITE = "https://yt010108.github.io/";
const API = "https://api.github.com";
const ROOT = "/repos/" + REPOSITORY;
const TOKEN_KEY = "yt010108-cms-github-session";
export const REMEMBER_KEY = "yt010108-cms-github-remember";
const emptyIndex = () => ({ format: INDEX_FORMAT, version: 1, entries: [] });
const jsonText = value => JSON.stringify(value, null, 2) + "\n";
export const publicLink = (entry, commit = "") => SITE + (commit ? "?v=" + encodeURIComponent(commit) : "") + "#/" + (entry.kind === "notes" ? "note" : "post") + "/" + encodeURIComponent(entry.id);

export class RepositoryConflict extends Error {
  constructor() { super("GitHub에서 이 글이나 저장소가 변경됐어요. 글 관리를 새로고침하고 최신 공개본을 확인해 주세요. 현재 수정본은 브라우저에 남아 있어요."); this.name = "RepositoryConflict"; }
}
export class GitHubError extends Error {
  constructor(status) {
    super(status === 401 ? "GitHub 연결이 만료됐거나 토큰이 올바르지 않아요. 다시 연결해 주세요."
      : status === 403 ? "GitHub 권한이나 API 사용 한도를 확인해 주세요. 이 저장소의 Contents 읽기·쓰기 권한이 필요해요."
      : status === 404 ? "GitHub 저장소 또는 파일을 찾지 못했어요. 토큰의 저장소 선택을 확인해 주세요."
      : "GitHub 요청에 실패했어요 (" + status + "). 현재 글은 브라우저에 보관돼요.");
    this.name = "GitHubError"; this.status = status;
  }
}
function decode(value) {
  const raw = atob(value.replace(/\s/g, ""));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, char => char.charCodeAt(0)));
}
function mapImages(doc, assets) {
  const copy = { ...doc };
  if (doc.attrs) copy.attrs = { ...doc.attrs };
  if (doc.type === "image") {
    const asset = assets.get(doc.attrs?.assetId);
    if (asset) copy.attrs.src = asset.path;
    else if (!/^https:\/\//i.test(doc.attrs?.src || "")) throw new Error("본문 이미지 파일이 없어요. 이미지를 다시 첨부해 주세요.");
  }
  if (doc.content) copy.content = doc.content.map(child => mapImages(child, assets));
  return copy;
}
export class GitHubRepository extends EventTarget {
  constructor({ fetcher = (...args) => fetch(...args), storage, persistentStorage } = {}) {
    super();
    this.fetcher = fetcher;
    try { this.storage = storage === undefined ? sessionStorage : storage; } catch { this.storage = null; }
    try { this.persistentStorage = persistentStorage === undefined ? localStorage : persistentStorage; } catch { this.persistentStorage = null; }
    this.token = ""; this.user = null;
    this.remembered = false; this.storageWarning = ""; this.generation = 0;
  }
  get connected() { return Boolean(this.user && this.token); }
  notify() { this.dispatchEvent(new Event("change")); }
  savedConnection() {
    try { const token = this.persistentStorage?.getItem(REMEMBER_KEY); if (token) return { token, remember: true }; } catch {}
    try { const token = this.storage?.getItem(TOKEN_KEY); if (token) return { token, remember: false }; } catch {}
    return null;
  }
  get hasSavedConnection() { return Boolean(this.savedConnection()); }
  forgetStored() {
    try { this.storage?.removeItem(TOKEN_KEY); } catch {}
    try { this.persistentStorage?.removeItem(REMEMBER_KEY); } catch {}
  }
  disconnect({ forget = true } = {}) {
    this.generation++;
    this.token = ""; this.user = null;
    this.remembered = false;
    if (forget) this.forgetStored();
    this.notify();
  }
  rememberConnection(remember) {
    if (!this.connected) throw new Error("먼저 관리자에 로그인해 주세요.");
    this.storageWarning = ""; this.remembered = false;
    try {
      const target = remember ? this.persistentStorage : this.storage;
      if (!target) throw new Error("Storage unavailable");
      const key = remember ? REMEMBER_KEY : TOKEN_KEY;
      if (target.getItem(key) !== this.token) target.setItem(key, this.token);
      if (remember) this.storage?.removeItem(TOKEN_KEY);
      else this.persistentStorage?.removeItem(REMEMBER_KEY);
      this.remembered = Boolean(remember);
    } catch {
      if (!remember) { try { this.persistentStorage?.removeItem(REMEMBER_KEY); } catch {} }
      try { this.storage?.setItem(TOKEN_KEY, this.token); } catch {}
      this.storageWarning = remember ? "브라우저에 연결 정보를 저장하지 못했어요. 현재 탭에서만 연결돼요." : "연결 정보를 저장하지 못했어요. 새로고침하면 다시 로그인해야 해요.";
    }
    return this.remembered;
  }
  async restore() {
    const saved = this.savedConnection();
    if (!saved) return false;
    await this.connect(saved.token, { remember: saved.remember, restoring: true });
    return true;
  }
  async connect(value, { remember = false, restoring = false } = {}) {
    const generation = ++this.generation;
    this.token = ""; this.user = null; this.remembered = false;
    if (!restoring) this.forgetStored();
    const token = value.trim();
    this.notify();
    try {
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{16,}$/.test(token)) {
        const error = new Error("GitHub에서 만든 개인 액세스 토큰을 입력해 주세요."); error.authInvalid = true; throw error;
      }
      this.token = token;
      const user = await this.request("/user", { authorizing: true });
      const repo = await this.request(ROOT, { authorizing: true });
      if (generation !== this.generation) throw new Error("다른 로그인 요청으로 변경됐어요. 다시 시도해 주세요.");
      if (user.login?.toLowerCase() !== "yt010108" || repo.full_name?.toLowerCase() !== REPOSITORY.toLowerCase() || repo.permissions?.push === false) {
        const error = new Error("yt010108 계정과 이 블로그 저장소의 쓰기 권한으로 연결해 주세요."); error.authInvalid = true; throw error;
      }
      this.user = { login: user.login };
      this.rememberConnection(remember);
      this.notify();
      return this.user;
    } catch (error) {
      if (generation === this.generation) {
        this.token = ""; this.user = null; this.remembered = false;
        if (error.authInvalid || [401, 404].includes(error.status)) this.forgetStored();
        this.notify();
      }
      throw error;
    }
  }
  async request(path, { method = "GET", body, auth = true, authorizing = false } = {}) {
    if (!(path === "/user" || path === ROOT || path.startsWith(ROOT + "/"))) throw new Error("허용되지 않는 GitHub 요청이에요.");
    if (!this.connected && !(authorizing && method === "GET" && ["/user", ROOT].includes(path))) throw new Error("먼저 관리자에 로그인해 주세요.");
    const generation = this.generation, requestToken = this.token;
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (auth && this.token) headers.Authorization = "Bearer " + this.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.fetcher(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(authorizing ? 15000 : 90000) });
    } catch { throw new Error("GitHub에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요."); }
    if (!response.ok) {
      if (response.status === 401 && auth && generation === this.generation && requestToken === this.token) this.disconnect();
      throw new GitHubError(response.status);
    }
    return response.status === 204 ? null : response.json();
  }
  async readIndex(ref = BRANCH) {
    let file;
    try { file = await this.request(ROOT + "/contents/blog/index.json?ref=" + encodeURIComponent(ref)); }
    catch (error) { if (error.status === 404) return emptyIndex(); throw error; }
    const content = file.encoding === "base64" && typeof file.content === "string" ? file.content : SHA.test(file.sha) ? await this.blob(file.sha) : null;
    if (!content) throw new Error("GitHub 글 목록을 읽지 못했어요.");
    return validateIndex(JSON.parse(decode(content)));
  }
  async head() {
    const ref = await this.request(ROOT + "/git/ref/heads/" + BRANCH);
    if (!SHA.test(ref.object?.sha)) throw new Error("GitHub 브랜치를 확인할 수 없어요.");
    return ref.object.sha;
  }
  async snapshot() {
    const head = await this.head();
    const commit = await this.request(ROOT + "/git/commits/" + head);
    return { head, tree: commit.tree.sha, index: await this.readIndex(head) };
  }
  async blob(sha) {
    if (!SHA.test(sha)) throw new Error("파일 버전이 올바르지 않아요.");
    const blob = await this.request(ROOT + "/git/blobs/" + sha);
    if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new Error("GitHub 파일을 읽지 못했어요.");
    return blob.content.replace(/\s/g, "");
  }
  async record(item) {
    const record = validateRecord(JSON.parse(decode(await this.blob(item.sha))));
    if (record.id !== item.id) throw new Error("글 ID가 일치하지 않아요.");
    return record;
  }
  async loadDraft(item, onProgress = () => {}) {
    const record = await this.record(item), assets = [];
    for (const [index, asset] of record.assets.entries()) {
      onProgress("이미지를 불러오는 중 · " + (index + 1) + "/" + record.assets.length);
      const data = "data:" + asset.type + ";base64," + await this.blob(asset.sha);
      if (!safeImageData(data)) throw new Error("이미지를 불러올 수 없어요. 파일 크기를 확인해 주세요.");
      assets.push({ id: asset.id, name: asset.name, type: asset.type, path: "images/" + asset.path.split("/").at(-1), data });
    }
    const entry = { ...newEntry(), ...Object.fromEntries(["id", "title", "kind", "slug", "description", "category", "date", "tags"].map(key => [key, record[key]])), assets };
    entry.doc = mapImages(record.doc, new Map(assets.map(asset => [asset.id, asset])));
    entry.publication = { id: record.id, sha: item.sha, sourceDigest: await draftDigest(entry), publishedAt: record.publishedAt };
    return entry;
  }
  async createBlob(content, encoding = "utf-8") {
    return (await this.request(ROOT + "/git/blobs", { method: "POST", body: { content, encoding } })).sha;
  }
  async commit(snapshot, index, files, message) {
    const tree = await this.request(ROOT + "/git/trees", {
      method: "POST", body: { base_tree: snapshot.tree, tree: [...files, { path: "blog/index.json", mode: "100644", type: "blob", content: jsonText(index) }] }
    });
    const commit = await this.request(ROOT + "/git/commits", { method: "POST", body: { message, tree: tree.sha, parents: [snapshot.head] } });
    try {
      await this.request(ROOT + "/git/refs/heads/" + BRANCH, { method: "PATCH", body: { sha: commit.sha, force: false } });
    } catch (error) {
      let current;
      try { current = await this.head(); } catch {}
      if (current === commit.sha) return commit.sha;
      if (current && current !== snapshot.head) throw new RepositoryConflict();
      if ([409, 422].includes(error.status)) throw new RepositoryConflict();
      throw error;
    }
    return commit.sha;
  }
  async publish(draft, onProgress = () => {}) {
    if (!this.connected) throw new Error("먼저 GitHub에 연결해 주세요.");
    onProgress("GitHub의 최신 글을 확인하는 중…");
    const snapshot = await this.snapshot(), previous = snapshot.index.entries.find(item => item.id === draft.id);
    if ((previous?.sha || null) !== (draft.publication?.sha || null)) throw new RepositoryConflict();
    if (previous?.status === "trash") throw new Error("휴지통의 공개 글을 먼저 복원해 주세요.");
    const now = new Date().toISOString(), assets = draft.assets.map(asset => ({
      id: asset.id, name: String(asset.name || "첨부 이미지").slice(0, 200), type: asset.type,
      path: "/" + uploadPath(draft.id, asset.path), sha: "0".repeat(40)
    }));
    let total = 0;
    for (const asset of draft.assets) {
      const bytes = Math.floor((asset.data?.length || 0) * .75);
      if (!UUID.test(asset.id) || !safeImageData(asset.data) || bytes > MAX_IMAGE_SIZE + 100) throw new Error("발행 이미지 형식이나 크기를 확인해 주세요.");
      total += bytes;
    }
    if (total > 50 * 1024 * 1024 + 1000) throw new Error("한 글의 이미지는 합계 50MB까지 발행할 수 있어요.");
    const record = {
      format: POST_FORMAT, version: 1,
      ...Object.fromEntries(["id", "title", "kind", "slug", "description", "category", "date", "tags"].map(key => [key, draft[key]])),
      status: "published", trashedAt: null, publishedAt: previous?.publishedAt || now, updatedAt: now,
      sourceDigest: await draftDigest(draft), assets, doc: mapImages(draft.doc, new Map(assets.map(asset => [asset.id, asset])))
    };
    validateRecord(record);
    const files = [];
    for (let i = 0; i < assets.length; i++) {
      onProgress("이미지를 저장하는 중 · " + (i + 1) + "/" + assets.length);
      assets[i].sha = await this.createBlob(draft.assets[i].data.split(",")[1], "base64");
      files.push({ path: assets[i].path.slice(1), mode: "100644", type: "blob", sha: assets[i].sha });
    }
    onProgress("글과 이미지를 함께 발행하는 중…");
    const sha = await this.createBlob(jsonText(record)), item = indexEntry(record, sha);
    const index = { ...snapshot.index, entries: [...snapshot.index.entries.filter(other => other.id !== item.id), item] };
    files.push({ path: entryPath(item.id), mode: "100644", type: "blob", sha });
    const commit = await this.commit(snapshot, index, files, (previous ? "Update" : "Publish") + " blog post: " + record.title);
    return { commit, item, index, publication: { id: item.id, sha, sourceDigest: record.sourceDigest, publishedAt: record.publishedAt, commit } };
  }
  async changeStatus(items, restore = false) {
    if (!this.connected) throw new Error("먼저 GitHub에 연결해 주세요.");
    const snapshot = await this.snapshot(), files = [], replacements = new Map(), now = new Date().toISOString();
    for (const item of items) {
      const latest = snapshot.index.entries.find(other => other.id === item.id);
      if (!latest || latest.sha !== item.sha) throw new RepositoryConflict();
      const record = await this.record(latest);
      record.status = restore ? "published" : "trash"; record.trashedAt = restore ? null : now; record.updatedAt = now;
      const sha = await this.createBlob(jsonText(record));
      files.push({ path: entryPath(item.id), mode: "100644", type: "blob", sha });
      replacements.set(item.id, indexEntry(record, sha));
    }
    const index = { ...snapshot.index, entries: snapshot.index.entries.map(item => replacements.get(item.id) || item) };
    const commit = await this.commit(snapshot, index, files, (restore ? "Restore" : "Trash") + " " + items.length + " blog post(s)");
    return { commit, index };
  }
  async deployment(sha) {
    if (!SHA.test(sha)) throw new Error("배포 버전이 올바르지 않아요.");
    const data = await this.request(ROOT + "/actions/workflows/deploy.yml/runs?event=push&head_sha=" + sha + "&per_page=1", { auth: false });
    return data.workflow_runs?.[0] || null;
  }
}
