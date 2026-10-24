import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { GitHubRepository, REPOSITORY, RepositoryConflict } from "../admin/src/github.js";
import { newEntry } from "../admin/src/document.js";
import { INDEX_FORMAT, validateRecord, validateIndex, renderDocument, draftDigest } from "../shared/posts.js";

const hash = bytes => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const TOKEN = "github_pat_" + "testonly".repeat(5);
const ROOT = "/repos/" + REPOSITORY;
function server() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), requests = [];
  const addBlob = bytes => { const sha = hash(bytes); blobs.set(sha, bytes); return sha; };
  const initialIndex = addBlob(json({ format: INDEX_FORMAT, version: 1, entries: [] }));
  const original = addBlob(Buffer.from("original site"));
  const initialTree = hash(Buffer.from("initial tree")), initialHead = hash(Buffer.from("initial commit"));
  trees.set(initialTree, new Map([["blog/index.json", initialIndex], ["index.html", original]]));
  commits.set(initialHead, { tree: { sha: initialTree }, parents: [] });
  const state = { head: initialHead, race: false, blobFailure: false, ambiguousPatch: false, wrongUser: false };
  const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher = async (url, options = {}) => {
    const endpoint = new URL(url), path = endpoint.pathname, method = options.method || "GET", body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, method, body, headers: options.headers });
    if (path === "/user") return respond({ login: state.wrongUser ? "someone-else" : "yt010108" });
    if (path === ROOT) return respond({ full_name: REPOSITORY, permissions: { push: true } });
    if (path === ROOT + "/git/ref/heads/main") return respond({ object: { sha: state.head } });
    if (path.startsWith(ROOT + "/git/commits/")) return respond(commits.get(path.split("/").at(-1)));
    if (path === ROOT + "/contents/blog/index.json") {
      const ref = endpoint.searchParams.get("ref"), head = ref === "main" ? state.head : ref;
      const sha = trees.get(commits.get(head).tree.sha).get("blog/index.json");
      return respond({ encoding: "base64", content: blobs.get(sha).toString("base64"), sha });
    }
    if (path.startsWith(ROOT + "/git/blobs/")) {
      const bytes = blobs.get(path.split("/").at(-1));
      return bytes ? respond({ encoding: "base64", content: bytes.toString("base64") }) : respond({}, 404);
    }
    if (path === ROOT + "/git/blobs" && method === "POST") {
      if (state.blobFailure) return respond({}, 403);
      return respond({ sha: addBlob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) }, 201);
    }
    if (path === ROOT + "/git/trees" && method === "POST") {
      assert.ok(body.base_tree && trees.has(body.base_tree), "Every write must preserve the current base tree");
      const files = new Map(trees.get(body.base_tree));
      for (const item of body.tree) {
        assert.ok(item.path === "blog/index.json" || /^blog\/entries\/[a-f0-9-]+\.json$/.test(item.path) || /^assets\/uploads\/[a-f0-9-]+\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(item.path));
        const sha = item.content === undefined ? item.sha : addBlob(Buffer.from(item.content));
        assert.ok(blobs.has(sha)); files.set(item.path, sha);
      }
      const sha = hash(Buffer.from(JSON.stringify([...files])));
      trees.set(sha, files); return respond({ sha }, 201);
    }
    if (path === ROOT + "/git/commits" && method === "POST") {
      const sha = hash(json(body)); commits.set(sha, { tree: { sha: body.tree }, parents: body.parents });
      return respond({ sha }, 201);
    }
    if (path === ROOT + "/git/refs/heads/main" && method === "PATCH") {
      assert.equal(body.force, false);
      if (state.race) {
        const external = hash(Buffer.from("another editor"));
        commits.set(external, commits.get(state.head)); state.head = external; return respond({}, 422);
      }
      if (!commits.get(body.sha).parents.includes(state.head)) return respond({}, 422);
      state.head = body.sha;
      if (state.ambiguousPatch) throw new TypeError("Response lost after successful update");
      return respond({ object: { sha: body.sha } });
    }
    throw new Error("Unexpected request " + method + " " + path);
  };
  const storage = new Map();
  const client = new GitHubRepository({ fetcher, storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  return { client, state, requests, blobs, trees, commits, initialHead, original, storage };
}
function draft() {
  return { ...newEntry(), title: "보안 연구 기록", slug: "security-notes", category: "Security / Web", tags: ["http", "보안"], doc: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "요청 분석" }] },
    { type: "paragraph", content: [{ type: "text", text: "검색으로 찾을 수 있는 본문" }] },
    { type: "codeBlock", attrs: { language: "http" }, content: [{ type: "text", text: "GET /<script>alert(1)</script> HTTP/1.1" }] },
    { type: "linkPreview", attrs: { id: crypto.randomUUID(), href: "https://example.com/", title: "Example", description: "참고 자료", state: "ready" } }
  ] } };
}
test("Publishing commits the record, index, and image together without replacing unrelated site files", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const entry = draft(), id = crypto.randomUUID(), path = "images/" + id + ".png";
  entry.assets = [{ id, path, name: "request.png", type: "image/png", data: "data:image/png;base64,aW1hZ2U=" }];
  entry.doc.content.push({ type: "image", attrs: { assetId: id, src: path, alt: "요청 화면" } });
  const result = await s.client.publish(entry);
  assert.equal(s.state.head, result.commit);
  const files = s.trees.get(s.commits.get(result.commit).tree.sha);
  assert.equal(files.get("index.html"), s.original);
  assert.equal(files.get(result.item.path), result.item.sha);
  const record = await s.client.record(result.item);
  assert.equal(record.assets[0].path, "/assets/uploads/" + entry.id + "/" + id + ".png");
  assert.equal(record.doc.content.at(-1).attrs.src, record.assets[0].path);
  assert.equal(record.sourceDigest, await draftDigest(entry));
  const loaded = await s.client.loadDraft(result.item);
  assert.equal(loaded.assets[0].data, entry.assets[0].data);
  assert.equal(loaded.doc.content.at(-1).attrs.src, path);
  assert.equal(loaded.publication.sha, result.item.sha);
  assert.equal(loaded.publication.sourceDigest, await draftDigest(loaded));
  assert.equal(s.requests.filter(r => r.method === "PATCH").length, 1);
});
test("Editing, trashing, and restoring use the expected remote version", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const first = await s.client.publish(draft());
  const editable = await s.client.loadDraft(first.item);
  editable.title = "수정한 제목";
  const second = await s.client.publish(editable);
  assert.notEqual(first.item.sha, second.item.sha);
  await assert.rejects(() => s.client.publish(editable), RepositoryConflict);
  const trashed = await s.client.changeStatus([second.item]);
  assert.equal(trashed.index.entries[0].status, "trash");
  const restored = await s.client.changeStatus(trashed.index.entries, true);
  assert.equal(restored.index.entries[0].status, "published");
  assert.equal((await s.client.record(restored.index.entries[0])).title, "수정한 제목");
});
test("A concurrent branch update is never force overwritten", async () => {
  const s = server(); await s.client.connect(TOKEN); s.state.race = true;
  await assert.rejects(() => s.client.publish(draft()), RepositoryConflict);
  assert.equal(s.state.head, hash(Buffer.from("another editor")));
  assert.ok(s.requests.filter(r => r.method === "PATCH").every(r => r.body.force === false));
});
test("A failed image or record upload cannot publish a partial post", async () => {
  const s = server(); await s.client.connect(TOKEN); s.state.blobFailure = true;
  await assert.rejects(() => s.client.publish(draft()), /권한/);
  assert.equal(s.state.head, s.initialHead);
  assert.equal(s.requests.filter(r => r.method === "PATCH").length, 0);
});
test("A lost reference-update response is reconciled with the actual branch head", async () => {
  const s = server(); await s.client.connect(TOKEN); s.state.ambiguousPatch = true;
  const result = await s.client.publish(draft());
  assert.equal(result.commit, s.state.head);
  assert.equal(s.requests.filter(r => r.method === "PATCH").length, 1);
});
test("Authentication is restricted to the owner and cleared by disconnect", async () => {
  const s = server();
  await assert.rejects(() => s.client.publish(draft()), /연결/);
  await s.client.connect(TOKEN); assert.equal(s.storage.size, 1);
  s.client.disconnect(); assert.equal(s.storage.size, 0);
  s.state.wrongUser = true;
  await assert.rejects(() => s.client.connect(TOKEN), /yt010108/);
  assert.equal(s.client.connected, false); assert.equal(s.storage.size, 0);
  assert.ok(s.requests.every(r => r.path === "/user" || r.path.startsWith(ROOT)));
});
test("Reader rendering escapes hostile text and URLs while preserving headings, tables, cards, and code", () => {
  const entry = draft();
  entry.doc.content.push({ type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] });
  entry.doc.content.push({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "프로토콜" }] }] }] }] });
  const result = renderDocument(entry.doc);
  assert.equal(result.headings.length, 1); assert.equal(result.headings[0].text, "요청 분석");
  assert.match(result.html, /<table>/); assert.match(result.html, /writer-link-card/);
  assert.match(result.html, /language-http/); assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /<script|href="javascript:|<img src=x/);
  assert.match(result.text, /검색으로 찾을 수 있는 본문/);
});
test("Invalid metadata and traversal paths are rejected before writing", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const entry = draft(); entry.id = "../outside";
  await assert.rejects(() => s.client.publish(entry));
  assert.equal(s.requests.filter(r => r.method !== "GET").length, 0);
  assert.throws(() => validateIndex({ format: INDEX_FORMAT, version: 1, entries: [{ id: "../bad" }] }));
});
test("The production content build includes published entries and excludes trash", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const entry = draft(), imageId = crypto.randomUUID();
  entry.assets = [{ id: imageId, path: "images/" + imageId + ".png", name: "image.png", type: "image/png", data: "data:image/png;base64,aW1hZ2U=" }];
  entry.doc.content.push({ type: "image", attrs: { assetId: imageId, src: entry.assets[0].path, alt: "이미지" } });
  const first = await s.client.publish(entry), second = await s.client.publish({ ...draft(), kind: "notes", title: "비공개 목록 테스트" });
  await s.client.changeStatus([second.item]);
  const files = s.trees.get(s.commits.get(s.state.head).tree.sha);
  const temp = await mkdtemp(resolve(tmpdir(), "blog-cms-build-"));
  try {
    for (const [name, sha] of files) {
      await mkdir(dirname(resolve(temp, name)), { recursive: true });
      await writeFile(resolve(temp, name), s.blobs.get(sha));
    }
    const script = resolve("scripts/build-content.mjs");
    const built = spawnSync(process.execPath, [script], { cwd: temp, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const output = await readFile(resolve(temp, "published.js"), "utf8");
    assert.match(output, /보안 연구 기록/); assert.doesNotMatch(output, /비공개 목록 테스트/);
    const imagePath = "assets/uploads/" + entry.id + "/" + imageId + ".png";
    assert.ok(output.includes("/" + imagePath));
    await writeFile(resolve(temp, imagePath), "corrupted image");
    const brokenImage = spawnSync(process.execPath, [script], { cwd: temp, encoding: "utf8" });
    assert.notEqual(brokenImage.status, 0, "A mismatched image must fail the build");
    await writeFile(resolve(temp, first.item.path), "{}");
    const invalid = spawnSync(process.execPath, [script], { cwd: temp, encoding: "utf8" });
    assert.notEqual(invalid.status, 0, "A corrupted index must fail the build");
  } finally {
    assert.equal(dirname(temp), resolve(tmpdir())); assert.ok(basename(temp).startsWith("blog-cms-build-"));
    await rm(temp, { recursive: true, force: true });
  }
});
