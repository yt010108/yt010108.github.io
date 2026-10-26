import { DashboardRepository } from "../../src/dashboard-repository.js";
import { REPOSITORY, BRANCH, SITE, RepositoryConflict } from "./github.js";
import { SHA } from "../../shared/posts.js";
import { SITE_PATH, validateSite, siteText, mergeSite } from "../../shared/site.js";
import { MEDIA_PATH, MEDIA_FORMAT, validateMedia, mediaText, mediaPath, verifyImageBytes, referencesPath } from "../../shared/media.js";

const root = "/repos/" + REPOSITORY;
const decode = value => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.replace(/\s/g, "")), char => char.charCodeAt(0)));
const base64 = bytes => { let raw = ""; for (let offset = 0; offset < bytes.length; offset += 32768) raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(raw); };
const imagePath = path => /^assets\/uploads\/(?:[a-f0-9-]{36}|library)\/[a-f0-9-]{36}\.(?:png|jpg|gif|webp)$/.test(path);
export class SiteRepository extends DashboardRepository {
  async readJSON(path, ref = BRANCH) {
    if (![SITE_PATH, MEDIA_PATH, "blog/dashboard.json"].includes(path)) throw new Error("허용되지 않는 설정 파일이에요.");
    const generation = this.generation, file = await this.request(root + "/contents/" + path + "?ref=" + encodeURIComponent(ref));
    if (!this.connected || generation !== this.generation) throw new Error("관리자 연결이 변경됐어요. 다시 연결해 주세요.");
    if (!SHA.test(file.sha)) throw new Error("파일 버전을 확인할 수 없어요.");
    const content = file.encoding === "base64" && typeof file.content === "string" ? file.content : await this.blob(file.sha);
    if (content.length > 1500000) throw new Error("설정 파일이 너무 커요.");
    return { value: JSON.parse(decode(content)), sha: file.sha };
  }
  async readSite(ref = BRANCH) { const file = await this.readJSON(SITE_PATH, ref); return { value: validateSite(file.value), sha: file.sha }; }
  async readMedia(ref = BRANCH) {
    try { const file = await this.readJSON(MEDIA_PATH, ref); return { value: validateMedia(file.value), sha: file.sha }; }
    catch (error) { if (error.status === 404) return { value: { format: MEDIA_FORMAT, version: 1, files: [] }, sha: null }; throw error; }
  }
  async commitFiles(snapshot, files, message) {
    if (!this.connected) throw new Error("관리자에 로그인해 주세요.");
    if (files.some(file => ![SITE_PATH, MEDIA_PATH].includes(file.path) && !/^assets\/uploads\/library\/[a-f0-9-]{36}\.(?:png|jpg|gif|webp)$/.test(file.path))) throw new Error("허용되지 않는 저장 경로예요.");
    const generation = this.generation;
    const tree = await this.request(root + "/git/trees", { method: "POST", body: { base_tree: snapshot.tree, tree: files } });
    if (!SHA.test(tree.sha)) throw new Error("GitHub 저장 결과를 확인하지 못했어요.");
    const commit = await this.request(root + "/git/commits", { method: "POST", body: { message, tree: tree.sha, parents: [snapshot.head] } });
    if (!SHA.test(commit.sha) || !this.connected || generation !== this.generation) throw new Error("저장 전에 관리자 연결이 변경됐어요.");
    try { await this.request(root + "/git/refs/heads/" + BRANCH, { method: "PATCH", body: { sha: commit.sha, force: false } }); }
    catch (error) {
      let current; try { current = await this.head(); } catch {}
      if (current === commit.sha) return commit.sha;
      if (current && current !== snapshot.head || [409, 422].includes(error.status)) throw new RepositoryConflict();
      throw error;
    }
    return commit.sha;
  }
  async saveSite(base, value) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(), latest = await this.readSite(snapshot.head), merged = mergeSite(base, value, latest.value);
      if (siteText(merged) === siteText(latest.value)) return { ...latest, commit: null };
      merged.updatedAt = new Date().toISOString();
      try {
        const commit = await this.commitFiles(snapshot, [{ path: SITE_PATH, mode: "100644", type: "blob", content: siteText(merged) }], "Update pages and projects");
        return { value: merged, commit, sha: null };
      } catch (error) { if (!(error instanceof RepositoryConflict) || attempt === 2) throw error; }
    }
  }
  async mediaLibrary() {
    const snapshot = await this.snapshot(), [registry, response] = await Promise.all([this.readMedia(snapshot.head), this.request(root + "/git/trees/" + snapshot.tree + "?recursive=1")]);
    if (!Array.isArray(response.tree) || response.truncated) throw new Error("이미지 목록을 끝까지 읽지 못했어요. 잠시 후 다시 불러와 주세요.");
    const registered = new Map(registry.value.files.map(file => [file.path, file]));
    const files = response.tree.filter(file => file.type === "blob" && imagePath(file.path) && SHA.test(file.sha)).map(file => {
      const stored = registered.get(file.path), post = snapshot.index.entries.find(item => file.path.startsWith("assets/uploads/" + item.id + "/"));
      registered.delete(file.path);
      return { ...(stored || { id: file.path, name: file.path.split("/").at(-1), alt: "", type: "image/" + file.path.split(".").at(-1).replace("jpg", "jpeg"), createdAt: post?.updatedAt || "" }), path: file.path, sha: file.sha, size: file.size || stored?.size || 0, managed: Boolean(stored), missing: false, post: post ? { id: post.id, title: post.title, kind: post.kind, status: post.status } : null, url: new URL(file.path, SITE).href, preview: "https://raw.githubusercontent.com/" + REPOSITORY + "/" + snapshot.head + "/" + file.path };
    });
    for (const file of registered.values()) files.push({ ...file, managed: true, missing: true, post: null, url: new URL(file.path, SITE).href, preview: "" });
    files.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || a.name.localeCompare(b.name));
    return { files, registry: registry.value, snapshot };
  }
  async uploadMedia(images, progress = () => {}) {
    if (!this.connected || !images.length || images.length > 20 || images.reduce((sum, image) => sum + image.bytes.length, 0) > 50 * 1024 * 1024) throw new Error("한 번에 최대 20장, 합계 50MB까지 올릴 수 있어요.");
    const generation = this.generation, added = [];
    for (const [index, image] of images.entries()) {
      const bytes = verifyImageBytes(image.bytes, image.type), id = crypto.randomUUID();
      progress("이미지 업로드 중 · " + (index + 1) + "/" + images.length);
      const sha = await this.createBlob(base64(bytes), "base64");
      if (!SHA.test(sha) || !this.connected || generation !== this.generation) throw new Error("업로드 중 연결이 변경됐어요.");
      added.push({ id, path: mediaPath(id, image.type), name: String(image.name || "이미지").slice(0, 200), alt: "", type: image.type, size: bytes.length, sha, createdAt: new Date().toISOString() });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(), latest = await this.readMedia(snapshot.head);
      const value = validateMedia({ ...latest.value, files: [...latest.value.files, ...added] });
      const files = [...added.map(file => ({ path: file.path, mode: "100644", type: "blob", sha: file.sha })), { path: MEDIA_PATH, mode: "100644", type: "blob", content: mediaText(value) }];
      try { const commit = await this.commitFiles(snapshot, files, "Upload " + added.length + " media image(s)"); return { value, added, commit }; }
      catch (error) { if (!(error instanceof RepositoryConflict) || attempt === 2) throw error; }
    }
  }
  async renameMedia(id, name, alt) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.snapshot(), latest = await this.readMedia(snapshot.head), file = latest.value.files.find(item => item.id === id);
      if (!file) throw new Error("라이브러리에 올린 이미지의 정보만 수정할 수 있어요.");
      file.name = name; file.alt = alt; const value = validateMedia(latest.value);
      try { const commit = await this.commitFiles(snapshot, [{ path: MEDIA_PATH, mode: "100644", type: "blob", content: mediaText(value) }], "Update media details"); return { value, commit }; }
      catch (error) { if (!(error instanceof RepositoryConflict) || attempt === 2) throw error; }
    }
  }
  async deleteMedia(id, { confirmDelete, localDrafts = [], progress = () => {} }) {
    const library = await this.mediaLibrary(), file = library.registry.files.find(item => item.id === id);
    if (!file) throw new Error("글에 첨부된 이미지는 해당 글에서 관리해 주세요. 라이브러리에 직접 올린 파일만 삭제할 수 있어요.");
    const current = library.files.find(item => item.id === id);
    if (!current || !current.missing && current.sha !== file.sha) throw new Error("이미지 파일이 변경됐어요. 새로고침한 뒤 확인해 주세요.");
    const snapshot = library.snapshot, path = "/" + file.path;
    const uses = [];
    const site = await this.readSite(snapshot.head); if (referencesPath(site.value, path)) uses.push("페이지·프로젝트");
    try { if (referencesPath((await this.readJSON("blog/dashboard.json", snapshot.head)).value, path)) uses.push("대시보드"); } catch (error) { if (error.status !== 404) throw error; }
    if (localDrafts.some(draft => referencesPath(draft.doc, path) || referencesPath(draft.markdown, path))) uses.push("이 브라우저의 임시글");
    let checked = 0;
    const pending = [...snapshot.index.entries];
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
      while (pending.length) { const item = pending.shift(), record = await this.record(item); if (referencesPath(record, path)) uses.push(item.title); progress("사용 중인지 확인하는 중 · " + (++checked) + "/" + snapshot.index.entries.length); }
    }));
    if (uses.length) throw new Error("사용 중인 이미지라 삭제하지 않았어요: " + [...new Set(uses)].slice(0, 5).join(", "));
    if (!await confirmDelete(file)) return { cancelled: true };
    const value = validateMedia({ ...library.registry, files: library.registry.files.filter(item => item.id !== id) });
    const files = [{ path: MEDIA_PATH, mode: "100644", type: "blob", content: mediaText(value) }];
    if (!current.missing) files.push({ path: file.path, mode: "100644", type: "blob", sha: null });
    const commit = await this.commitFiles(snapshot, files, "Delete unused media: " + file.name);
    return { value, commit };
  }
}
