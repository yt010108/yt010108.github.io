import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { SiteRepository } from "../admin/src/site-repository.js";
import { REPOSITORY, RepositoryConflict } from "../admin/src/github.js";
import { newEntry } from "../admin/src/document.js";
import { INDEX_FORMAT } from "../shared/posts.js";
import { validateSite, publicSite, mergeSite, SITE_PATH, SITE_FORMAT } from "../shared/site.js";
import { MEDIA_FORMAT, MEDIA_PATH, MAX_MEDIA_BYTES, verifyImageBytes, validateMedia } from "../shared/media.js";

const context = { window: {} }; vm.runInNewContext(await readFile(new URL("../content.js", import.meta.url), "utf8"), context);
const originalContent = JSON.parse(JSON.stringify(context.window.BLOG_DATA));
const initialSite = validateSite({ format: SITE_FORMAT, version: 1, profile: originalContent.profile, projects: originalContent.projects, pages: [], updatedAt: null });
const initialDashboard = JSON.parse(await readFile(new URL("../blog/dashboard.json", import.meta.url), "utf8"));
const root = "/repos/" + REPOSITORY, token = "github_pat_" + "testonly".repeat(5);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
const image = () => ({ name: "화면.png", type: "image/png", bytes: png });
const hash = bytes => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
function server() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), calls = [];
  const blob = bytes => { const sha = hash(bytes); blobs.set(sha, bytes); return sha; };
  let serial = 1; const sha = () => hash(Buffer.from("test " + serial++));
  const firstTree = sha(), firstHead = sha();
  trees.set(firstTree, new Map([[SITE_PATH, blob(json(initialSite))], [MEDIA_PATH, blob(json({ format: MEDIA_FORMAT, version: 1, files: [] }))], ["blog/index.json", blob(json({ format: INDEX_FORMAT, version: 1, entries: [] }))], ["blog/dashboard.json", blob(json(initialDashboard))], ["index.html", blob(Buffer.from("Original home"))]]));
  commits.set(firstHead, { tree: { sha: firstTree }, parents: [] });
  const state = { head: firstHead, race: null, failBlob: false, lostPatch: false, truncated: false };
  const files = () => trees.get(commits.get(state.head).tree.sha);
  const data = path => JSON.parse(blobs.get(files().get(path)).toString());
  const external = (path, value) => { const next = new Map(files()); value === null ? next.delete(path) : next.set(path, blob(json(value))); const tree = sha(), head = sha(); trees.set(tree, next); commits.set(head, { tree: { sha: tree }, parents: [state.head] }); state.head = head; };
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher = async (url, options = {}) => {
    const endpoint = new URL(url), path = endpoint.pathname, method = options.method || "GET", body = options.body ? JSON.parse(options.body) : null; calls.push({ path, method, body });
    if (path === "/user") return reply({ login: "yt010108" });
    if (path === root) return reply({ full_name: REPOSITORY, permissions: { push: true } });
    if (path === root + "/git/ref/heads/main") return reply({ object: { sha: state.head } });
    if (path.startsWith(root + "/git/commits/")) return reply(commits.get(path.split("/").at(-1)));
    if (path.startsWith(root + "/contents/")) {
      const target = path.slice((root + "/contents/").length), ref = endpoint.searchParams.get("ref"), head = !ref || ref === "main" ? state.head : ref;
      const version = trees.get(commits.get(head)?.tree.sha)?.get(target); return version ? reply({ sha: version, encoding: "base64", content: blobs.get(version).toString("base64") }) : reply({}, 404);
    }
    if (path.startsWith(root + "/git/blobs/")) { const bytes = blobs.get(path.split("/").at(-1)); return bytes ? reply({ encoding: "base64", content: bytes.toString("base64") }) : reply({}, 404); }
    if (path.startsWith(root + "/git/trees/")) { const tree = trees.get(path.split("/").at(-1)); return reply({ truncated: state.truncated, tree: [...tree].map(([path, sha]) => ({ path, sha, type: "blob", size: blobs.get(sha).length })) }); }
    if (path === root + "/git/blobs" && method === "POST") return state.failBlob ? reply({}, 403) : reply({ sha: blob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) }, 201);
    if (path === root + "/git/trees" && method === "POST") {
      assert.ok(trees.has(body.base_tree)); const next = new Map(trees.get(body.base_tree));
      for (const file of body.tree) { if (file.sha === null) next.delete(file.path); else next.set(file.path, file.content === undefined ? file.sha : blob(Buffer.from(file.content))); }
      const id = sha(); trees.set(id, next); return reply({ sha: id }, 201);
    }
    if (path === root + "/git/commits" && method === "POST") { const id = sha(); commits.set(id, { tree: { sha: body.tree }, parents: body.parents }); return reply({ sha: id }, 201); }
    if (path === root + "/git/refs/heads/main" && method === "PATCH") {
      assert.equal(body.force, false);
      if (state.race) { const race = state.race; state.race = null; race(); return reply({}, 422); }
      if (!commits.get(body.sha).parents.includes(state.head)) return reply({}, 422);
      state.head = body.sha; if (state.lostPatch) { state.lostPatch = false; throw new TypeError("Lost successful response"); } return reply({ object: { sha: state.head } });
    }
    throw new Error("Unexpected request " + method + " " + path);
  };
  const store = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
  const client = new SiteRepository({ fetcher, storage: store(), persistentStorage: store() });
  return { client, calls, state, files, data, external, blobs };
}
const connected = async () => { const s = server(); await s.client.connect(token); return s; };

test("The initial CMS configuration preserves the existing profile and all project contents", async () => {
  const original = originalContent, actual = validateSite(initialSite);
  validateSite(JSON.parse(await readFile(new URL("../blog/site.json", import.meta.url), "utf8")));
  const preserved = (actual, expected) => { if (Array.isArray(expected)) { assert.equal(actual.length, expected.length); expected.forEach((value, index) => preserved(actual[index], value)); } else if (expected && typeof expected === "object") { for (const [key, value] of Object.entries(expected)) preserved(actual[key], value); } else assert.deepEqual(actual, expected); };
  preserved(actual.profile, original.profile);
  assert.equal(actual.projects.length, original.projects.length);
  for (const [index, project] of original.projects.entries()) for (const [key, value] of Object.entries(project)) assert.deepEqual(actual.projects[index][key], value, "Preserved " + project.id + "." + key);
});

test("Site validation excludes hidden projects from the reader and rejects unsafe links and duplicate addresses", () => {
  const value = structuredClone(initialSite); value.projects[0].published = false;
  assert.equal(publicSite(value).projects.length, value.projects.length - 1);
  for (const address of ["javascript:alert(1)", "data:text/html,x", "https://user:secret@example.com/"]) assert.throws(() => validateSite({ ...value, profile: { ...value.profile, github: address } }));
  assert.throws(() => validateSite({ ...value, projects: [value.projects[0], value.projects[0]] }));
  assert.throws(() => validateSite({ ...value, projects: [{ ...value.projects[0], id: "../../index" }] }));
});

test("Site saves merge independent sections and reject concurrent changes to the same section", () => {
  const local = structuredClone(initialSite), remote = structuredClone(initialSite); local.projects[0].description = "프로젝트 수정"; remote.profile.intro = "다른 기기의 소개 수정";
  const merged = mergeSite(initialSite, local, remote); assert.deepEqual(merged.projects, local.projects); assert.deepEqual(merged.profile, remote.profile);
  remote.projects[0].description = "다른 수정"; assert.throws(() => mergeSite(initialSite, local, remote), /다른 기기/);
});

test("Saving pages and projects commits only the site configuration and treats identical saves as no-ops", async () => {
  const s = await connected(), original = new Map(s.files()), edited = structuredClone(initialSite); edited.profile.about += "\n추가 소개";
  const result = await s.client.saveSite(initialSite, edited); assert.equal(s.state.head, result.commit); assert.equal(s.data(SITE_PATH).profile.about, edited.profile.about);
  for (const [path, version] of original) if (path !== SITE_PATH) assert.equal(s.files().get(path), version, "Preserved " + path);
  const count = s.calls.length; assert.equal((await s.client.saveSite(result.value, result.value)).commit, null); assert.ok(!s.calls.slice(count).some(call => call.method === "PATCH"));
  await assert.rejects(async () => s.client.commitFiles(await s.client.snapshot(), [{ path: "index.html", content: "unsafe" }], "bad"));
});

test("Site saving safely retries an unrelated branch race and never overwrites a concurrent project edit", async () => {
  const s = await connected(), local = structuredClone(initialSite); local.projects[0].name += " 수정";
  s.state.race = () => s.external("blog/dashboard.json", { ...initialDashboard, memo: "동시에 저장한 메모" });
  await s.client.saveSite(initialSite, local); assert.equal(s.data("blog/dashboard.json").memo, "동시에 저장한 메모");
  const before = s.data(SITE_PATH), second = structuredClone(before); second.projects[0].name += " 두 번째";
  s.state.race = () => { const latest = s.data(SITE_PATH); latest.projects[0].name = "다른 기기 프로젝트"; s.external(SITE_PATH, latest); };
  await assert.rejects(() => s.client.saveSite(before, second), /다른 기기/); assert.equal(s.data(SITE_PATH).projects[0].name, "다른 기기 프로젝트");
});

test("Image checks reject executable files, mismatched formats, oversized data and traversal metadata", () => {
  assert.equal(verifyImageBytes(png, "image/png"), png);
  for (const [bytes, type] of [[Buffer.from('<svg onload="alert(1)">'), "image/svg+xml"], [png, "image/jpeg"], [new Uint8Array(MAX_MEDIA_BYTES + 1), "image/png"]]) assert.throws(() => verifyImageBytes(bytes, type));
  assert.throws(() => validateMedia({ format: MEDIA_FORMAT, version: 1, files: [{ id: crypto.randomUUID(), path: "../../index.html", type: "image/png" }] }));
});

test("A media upload commits the registry and binary together while preserving other files", async () => {
  const s = await connected(), before = new Map(s.files()), result = await s.client.uploadMedia([image(), { ...image(), name: "두 번째.png" }]);
  assert.equal(result.added.length, 2); assert.equal(s.calls.filter(call => call.method === "PATCH").length, 1);
  for (const file of result.added) assert.deepEqual(s.blobs.get(s.files().get(file.path)), png);
  assert.equal(s.data(MEDIA_PATH).files.length, 2);
  for (const [path, version] of before) if (path !== MEDIA_PATH) assert.equal(s.files().get(path), version);
  const library = await s.client.mediaLibrary(); assert.equal(library.files.length, 2); assert.ok(library.files.every(file => file.managed && file.url.startsWith("https://yt010108.github.io/assets/uploads/library/")));
});

test("Failed image uploads leave both the published files and media registry unchanged", async () => {
  const s = await connected(), head = s.state.head; s.state.failBlob = true;
  await assert.rejects(() => s.client.uploadMedia([image()]), /권한/); assert.equal(s.state.head, head); assert.equal(s.data(MEDIA_PATH).files.length, 0);
  assert.equal(s.calls.filter(call => call.method === "PATCH").length, 0);
});

test("Media uploads retry branch races without duplicating files and recover a lost successful response", async () => {
  const s = await connected(); s.state.race = () => s.external("blog/dashboard.json", { ...initialDashboard, memo: "보존할 메모" }); s.state.lostPatch = true;
  const uploaded = await s.client.uploadMedia([image()]); assert.equal(s.data(MEDIA_PATH).files.length, 1); assert.equal(s.data("blog/dashboard.json").memo, "보존할 메모"); assert.equal(s.state.head, uploaded.commit);
});

test("Media metadata changes keep image bytes and addresses intact", async () => {
  const s = await connected(), uploaded = (await s.client.uploadMedia([image()])).added[0];
  await s.client.renameMedia(uploaded.id, "분석 화면.png", "HTTP 요청 흐름"); const saved = s.data(MEDIA_PATH).files[0];
  assert.equal(saved.path, uploaded.path); assert.equal(saved.sha, uploaded.sha); assert.equal(saved.alt, "HTTP 요청 흐름"); assert.deepEqual(s.blobs.get(saved.sha), png);
});

test("The library includes existing post images with their article and never permits their physical deletion", async () => {
  const s = await connected(), draft = newEntry(), assetId = crypto.randomUUID(); draft.title = "기존 첨부 글";
  draft.assets = [{ id: assetId, path: "images/" + assetId + ".png", name: "첨부.png", type: "image/png", data: "data:image/png;base64," + png.toString("base64") }]; draft.doc.content = [{ type: "image", attrs: { src: draft.assets[0].path, assetId } }];
  await s.client.publish(draft); const library = await s.client.mediaLibrary(), file = library.files[0]; assert.equal(file.post.title, draft.title); assert.equal(file.managed, false);
  await assert.rejects(() => s.client.deleteMedia(file.id, { confirmDelete: () => true }), /직접 올린/);
  s.state.truncated = true; await assert.rejects(() => s.client.mediaLibrary(), /끝까지/);
});

test("A library image referenced by a local draft, page or remote post cannot be deleted", async () => {
  const s = await connected(), file = (await s.client.uploadMedia([image()])).added[0], url = "https://yt010108.github.io/" + file.path; let asked = false;
  const options = { confirmDelete: () => { asked = true; return true; }, localDrafts: [{ doc: { type: "doc", content: [{ type: "image", attrs: { src: url } }] } }] };
  await assert.rejects(() => s.client.deleteMedia(file.id, options), /임시글/); assert.equal(asked, false);
  const config = s.data(SITE_PATH); config.profile.about += url; s.external(SITE_PATH, config);
  await assert.rejects(() => s.client.deleteMedia(file.id, { confirmDelete: () => true }), /페이지·프로젝트/);
  config.profile.about = initialSite.profile.about; s.external(SITE_PATH, config);
  const draft = newEntry(); draft.title = "이미지를 쓰는 글"; draft.doc.content = [{ type: "image", attrs: { src: url } }]; await s.client.publish(draft);
  await assert.rejects(() => s.client.deleteMedia(file.id, { confirmDelete: () => true }), /이미지를 쓰는 글/);
});

test("Only a confirmed unused library file is removed and a new reference during confirmation wins", async () => {
  const s = await connected(), file = (await s.client.uploadMedia([image()])).added[0];
  assert.equal((await s.client.deleteMedia(file.id, { confirmDelete: () => false })).cancelled, true); assert.ok(s.files().has(file.path));
  await assert.rejects(() => s.client.deleteMedia(file.id, { confirmDelete: () => { const config = s.data(SITE_PATH); config.profile.about += "/" + file.path; s.external(SITE_PATH, config); return true; } }), RepositoryConflict);
  assert.ok(s.files().has(file.path)); const config = s.data(SITE_PATH); config.profile.about = initialSite.profile.about; s.external(SITE_PATH, config);
  await s.client.deleteMedia(file.id, { confirmDelete: () => true }); assert.equal(s.files().has(file.path), false); assert.equal(s.data(MEDIA_PATH).files.length, 0);
});

test("Site and media writes require the existing verified owner connection", async () => {
  const s = server(); await assert.rejects(() => s.client.uploadMedia([image()])); await assert.rejects(() => s.client.saveSite(initialSite, initialSite)); assert.equal(s.calls.length, 0);
});
