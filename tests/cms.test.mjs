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

test("imported heading levels stay intact in the article and table of contents", () => {
  const doc = { type: "doc", content: [1, 2, 3, 4, 5, 6].map(level => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: "Section <" + level + ">" }] })) };
  const { html, headings } = renderDocument(doc);
  assert.deepEqual(headings.map(({ level, id }) => ({ level, id })), [1, 2, 3, 4, 5, 6].map(level => ({ level, id: "section-" + level })));
  for (const level of [1, 2, 3, 4, 5, 6]) assert.ok(html.includes(`<h${level} id="section-${level}">Section &lt;${level}&gt;</h${level}>`));
});
function server() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), requests = [];
  const addBlob = bytes => { const sha = hash(bytes); blobs.set(sha, bytes); return sha; };
  const initialIndex = addBlob(json({ format: INDEX_FORMAT, version: 1, entries: [] }));
  const original = addBlob(Buffer.from("original site"));
  const initialTree = hash(Buffer.from("initial tree")), initialHead = hash(Buffer.from("initial commit"));
  trees.set(initialTree, new Map([["blog/index.json", initialIndex], ["index.html", original]]));
  commits.set(initialHead, { tree: { sha: initialTree }, parents: [] });
  const state = { head: initialHead, race: false, blobFailure: false, ambiguousPatch: false, wrongUser: false, expired: false, offline: false, storageFailure: false };
  const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher = async (url, options = {}) => {
    if (state.offline) throw new TypeError("Offline");
    const endpoint = new URL(url), path = endpoint.pathname, method = options.method || "GET", body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, method, body, headers: options.headers });
    if (path === "/user") return state.expired ? respond({}, 401) : respond({ login: state.wrongUser ? "someone-else" : "yt010108" });
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
  const storage = new Map(), persistent = new Map();
  const sessionStore = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const persistentStore = { getItem: key => persistent.get(key), setItem: (key, value) => { if (state.storageFailure) throw new Error("Storage blocked"); persistent.set(key, value); }, removeItem: key => persistent.delete(key) };
  const client = new GitHubRepository({ fetcher, storage: sessionStore, persistentStorage: persistentStore });
  return { client, state, requests, blobs, trees, commits, initialHead, original, storage, persistent, fetcher, sessionStore, persistentStore };
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
test("Remembered connections survive a new session and are verified again before repository reads", async () => {
  const s = server();
  await assert.rejects(() => s.client.readIndex(), /로그인/);
  assert.equal(s.requests.length, 0);
  await s.client.connect(TOKEN, { remember: true });
  assert.equal(s.storage.size, 0); assert.equal(s.persistent.size, 1);
  const changes = [];
  const trackedStore = { ...s.persistentStore, setItem: (...args) => { changes.push("set"); s.persistentStore.setItem(...args); }, removeItem: (...args) => { changes.push("remove"); s.persistentStore.removeItem(...args); } };
  const next = new GitHubRepository({ fetcher: s.fetcher, storage: null, persistentStorage: trackedStore });
  assert.equal(next.connected, false);
  const before = s.requests.length;
  assert.equal(await next.restore(), true);
  assert.equal(next.connected, true); assert.equal(next.remembered, true);
  assert.deepEqual(s.requests.slice(before).map(call => call.path), ["/user", ROOT]);
  assert.deepEqual(changes, [], "Revalidation must not remove and recreate the shared token and log out other tabs");
  next.disconnect();
  assert.equal(s.persistent.size, 0); assert.equal(next.connected, false);
});
test("Expired remembered tokens are removed instead of granting access", async () => {
  const s = server(); await s.client.connect(TOKEN, { remember: true }); s.state.expired = true;
  const next = new GitHubRepository({ fetcher: s.fetcher, storage: s.sessionStore, persistentStorage: s.persistentStore });
  await assert.rejects(() => next.restore(), /만료/);
  assert.equal(next.connected, false); assert.equal(next.hasSavedConnection, false);
  assert.equal(s.storage.size, 0); assert.equal(s.persistent.size, 0);
  await assert.rejects(() => next.readIndex(), /로그인/);
});
test("An offline verification remains locked and preserves the token for a deliberate retry", async () => {
  const s = server(); await s.client.connect(TOKEN, { remember: true }); s.state.offline = true;
  const next = new GitHubRepository({ fetcher: s.fetcher, storage: s.sessionStore, persistentStorage: s.persistentStore });
  await assert.rejects(() => next.restore(), /네트워크/);
  assert.equal(next.connected, false); assert.equal(next.hasSavedConnection, true);
  await assert.rejects(() => next.readIndex(), /로그인/);
  s.state.offline = false;
  await next.restore(); assert.equal(next.connected, true);
});
test("Remember preference can move an existing connection to session storage and logout clears both", async () => {
  const s = server(); await s.client.connect(TOKEN, { remember: true });
  const requests = s.requests.length;
  s.client.rememberConnection(false);
  assert.equal(s.client.remembered, false); assert.equal(s.persistent.size, 0); assert.equal(s.storage.size, 1);
  s.client.rememberConnection(true);
  assert.equal(s.client.remembered, true); assert.equal(s.persistent.size, 1); assert.equal(s.storage.size, 0);
  assert.equal(s.requests.length, requests);
  s.storage.set("yt010108-cms-github-session", TOKEN);
  s.client.disconnect();
  assert.equal(s.storage.size, 0); assert.equal(s.persistent.size, 0);
});
test("Blocked persistent storage falls back to the tab with an explicit warning", async () => {
  const s = server(); s.state.storageFailure = true;
  await s.client.connect(TOKEN, { remember: true });
  assert.equal(s.client.connected, true); assert.equal(s.client.remembered, false);
  assert.equal(s.storage.size, 1); assert.equal(s.persistent.size, 0);
  assert.match(s.client.storageWarning, /현재 탭/);
});
test("Turning remember off removes persistent credentials even if session storage fails", async () => {
  const s = server(); await s.client.connect(TOKEN, { remember: true });
  s.sessionStore.setItem = () => { throw new Error("Storage blocked"); };
  s.client.rememberConnection(false);
  assert.equal(s.persistent.size, 0); assert.equal(s.client.remembered, false);
  assert.match(s.client.storageWarning, /다시 로그인/);
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
    const output = await readFile(resolve(temp, "published.json"), "utf8");
    const feed = JSON.parse(output);
    assert.equal(feed.format, "yt010108-public-content");
    assert.equal(feed.version, 1);
    assert.equal(feed.posts.length, 1);
    assert.deepEqual(feed.managedKinds.sort(), ["notes", "posts"]);
    assert.doesNotMatch(await readFile(resolve(temp, "published.js"), "utf8"), /보안 연구 기록/);
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

test("Category creation persists across clients and later publication preserves the registry", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const created = await s.client.changeTaxonomy({ type: "categories", action: "add", name: "Network", expectedIndex: await s.client.readIndex() });
  assert.deepEqual(created.index.taxonomy.categories, ["Network"]);
  assert.deepEqual(created.items, []);
  const another = new GitHubRepository({ fetcher: s.fetcher, storage: s.sessionStore, persistentStorage: s.persistentStore });
  await another.connect(TOKEN);
  assert.deepEqual((await another.readIndex()).taxonomy.categories, ["Network"]);
  const published = await another.publish({ ...draft(), category: "Network" });
  assert.deepEqual(published.index.taxonomy.categories, ["Network"]);
  assert.equal(s.trees.get(s.commits.get(s.state.head).tree.sha).get("index.html"), s.original);
});

test("Renaming a used category updates records and their digests without changing the body or image blobs", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const entry = draft(), imageId = crypto.randomUUID();
  entry.assets = [{ id: imageId, path: "images/" + imageId + ".png", name: "image.png", type: "image/png", data: "data:image/png;base64,aW1hZ2U=" }];
  entry.doc.content.push({ type: "image", attrs: { assetId: imageId, src: entry.assets[0].path, alt: "이미지" } });
  const published = await s.client.publish(entry), before = await s.client.record(published.item);
  const result = await s.client.changeTaxonomy({ type: "categories", action: "rename", name: entry.category, replacement: "Web Security", expectedIndex: await s.client.readIndex() });
  const record = await s.client.record(result.items[0]);
  assert.equal(record.category, "Web Security"); assert.deepEqual(record.tags, before.tags);
  assert.deepEqual(record.doc, before.doc); assert.deepEqual(record.assets, before.assets);
  assert.equal(record.sourceDigest, await draftDigest(await s.client.loadDraft(result.items[0])));
  assert.notEqual(record.sourceDigest, before.sourceDigest);
  assert.deepEqual(result.index.taxonomy.categories, ["Web Security"]);
});

test("Deleting classifications keeps posts, bodies, unrelated tags and trash state intact", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const entry = draft(), published = await s.client.publish(entry);
  await s.client.changeStatus([published.item]);
  const removedTag = await s.client.changeTaxonomy({ type: "tags", action: "delete", name: "http", expectedIndex: await s.client.readIndex() });
  let record = await s.client.record(removedTag.items[0]);
  assert.deepEqual(record.tags, ["보안"]); assert.equal(record.status, "trash"); assert.deepEqual(record.doc, entry.doc);
  const removedCategory = await s.client.changeTaxonomy({ type: "categories", action: "delete", name: entry.category, expectedIndex: await s.client.readIndex() });
  record = await s.client.record(removedCategory.items[0]);
  assert.equal(record.category, ""); assert.equal(record.status, "trash"); assert.equal(removedCategory.index.entries.length, 1);
});

test("Taxonomy changes reject stale previews and never overwrite a concurrent publication", async () => {
  const s = server(); await s.client.connect(TOKEN);
  const stale = await s.client.readIndex(); await s.client.publish(draft());
  await assert.rejects(() => s.client.changeTaxonomy({ type: "categories", action: "add", name: "Network", expectedIndex: stale }), RepositoryConflict);
  const current = await s.client.readIndex(); s.state.race = true;
  await assert.rejects(() => s.client.changeTaxonomy({ type: "categories", action: "rename", name: "Security / Web", replacement: "Web", expectedIndex: current }), RepositoryConflict);
  assert.equal((await s.client.readIndex()).entries[0].category, "Security / Web");
  assert.ok(s.requests.filter(request => request.method === "PATCH").every(request => request.body.force === false));
});

test("Invalid registry data and empty classification names are rejected before writing", async () => {
  const s = server(); await s.client.connect(TOKEN);
  await assert.rejects(async () => s.client.changeTaxonomy({ type: "categories", action: "add", name: " ", expectedIndex: await s.client.readIndex() }));
  assert.equal(s.requests.filter(request => request.method !== "GET").length, 0);
  assert.throws(() => validateIndex({ format: INDEX_FORMAT, version: 1, entries: [], taxonomy: { categories: ["same", "same"], tags: [] } }));
  assert.throws(() => validateIndex({ format: INDEX_FORMAT, version: 1, entries: [], taxonomy: { categories: [], tags: [null] } }));
});
