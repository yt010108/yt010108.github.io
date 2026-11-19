// Run from the repository root. stdin holds the verified names, one JSON array.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FILE_TYPE } from "../../shared/files.js";
import { POST_FORMAT, draftDigest, entryPath, indexEntry, uploadPath, validateIndex, validateRecord } from "../../shared/posts.js";

const category = "Archive / 개인정보보호법 결과 공표";
const folder = process.argv[2];
const notice = JSON.parse(await readFile(join(folder, "notice.json"), "utf8"));
const names = JSON.parse(readFileSync(0, "utf8"));
const { id, postId, fields, files } = notice;
assert(/^[0-9]+$/.test(id) && notice.url === "https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS258&mCode=C010040000&nttId=" + id);
assert(Array.isArray(names) && names.length && names.every(n => typeof n === "string" && n.trim() === n && n.length && n.length <= 150 && !/[\x00-\x1f\x7f]/.test(n)));
assert(files.length && files.length <= 150);
const json = value => JSON.stringify(value, null, 2) + "\n";
const gitHash = bytes => createHash("sha1").update("blob " + Buffer.byteLength(bytes) + "\0").update(bytes).digest("hex");
const indexPath = "blog/index.json";
const index = validateIndex(JSON.parse(await readFile(indexPath, "utf8")));
assert(index.taxonomy.categories.includes(category), "The PIPC category is missing");
assert(!index.entries.some(e => e.id === postId), "This PIPC notice already has an entry");
const local = [], assets = [], writes = [];
for (const [i, f] of files.entries()) {
  assert.equal(f.file, i + ".bin");
  const bytes = await readFile(join(folder, f.file));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, "Original attachment changed");
  assert(bytes.length && bytes.length <= 10 * 1024 * 1024);
  const assetId = randomUUID(), path = "files/" + assetId + ".bin";
  const file = { id: assetId, name: f.name, type: FILE_TYPE, path };
  local.push(file);
  const output = uploadPath(postId, path);
  assets.push({ ...file, path: "/" + output, sha: gitHash(bytes) });
  writes.push([output, bytes]);
}
assert(writes.reduce((sum, [, bytes]) => sum + bytes.length, 0) <= 50 * 1024 * 1024);
const now = new Date(), stamp = now.toISOString();
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
function paragraph(text, href) {
  if (!text) return { type: "paragraph" };
  const value = { type: "text", text };
  if (href) value.marks = [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer", class: null, title: null } }];
  return { type: "paragraph", content: [value] };
}
function cell(text, colspan = 1, header = false) {
  return { type: header ? "tableHeader" : "tableCell", attrs: { colspan, rowspan: 1, colwidth: null, align: header ? "center" : "left" },
    content: (Array.isArray(text) ? text : [text]).map(s => paragraph(s)) };
}
const label = key => cell(key, 1, true);
function doc(links) {
  const rows = [
    [label("제목"), cell(fields["제목"], 3)],
    [label("작성부서"), cell(fields["작성부서"]), label("작성자"), cell(fields["작성자"])],
    [label("작성일"), cell(fields["작성일"]), label("조회수"), cell(fields["조회수"])],
    [label("공표상태"), cell(fields["공표상태"], 3)],
    [label("공표마감일"), cell(fields["공표마감일"], 3)],
    [label("첨부파일 목록"), cell(files.map(f => f.name), 3)],
    [cell(notice.body, 4)]
  ];
  return { type: "doc", content: [
    { type: "table", content: rows.map(content => ({ type: "tableRow", content })) },
    ...links.map(f => paragraph(f.name, f.path)), paragraph(names.join(", ")),
    paragraph("개인정보보호위원회 원문 (" + notice.checked + " 확인)", notice.url)
  ] };
}
const baseTitle = fields["제목"] + "(" + fields["작성일"] + ")";
const title = index.entries.some(e => e.title.startsWith(baseTitle)) ? baseTitle + " · " + names[0] : baseTitle;
const draft = { id: postId, title, kind: "posts", slug: "pipc-" + id, description: names.length > 1 ? names[0] + " 등 " + names.length + "곳에 대한 결과 공표" : names[0] + "에 대한 결과 공표",
  category, date, tags: [], series: "", assets: local, doc: doc(local) };
const record = validateRecord({ ...draft, format: POST_FORMAT, version: 1, status: "published", trashedAt: null,
  publishedAt: stamp, updatedAt: stamp, assets, doc: doc(assets), sourceDigest: await draftDigest(draft) });
const body = json(record);
index.entries.push(indexEntry(record, gitHash(body)));
validateIndex(index);
for (const [path, bytes] of [...writes, [entryPath(postId), body]]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}
await writeFile(indexPath, json(index));
