import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateIndex, validateRecord, indexEntry, plainText } from "../shared/posts.js";

const index = validateIndex(JSON.parse(await readFile("blog/index.json", "utf8")));
const posts = [];
const blobSHA = bytes => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
for (const item of index.entries) {
  const bytes = await readFile(item.path), record = validateRecord(JSON.parse(bytes));
  if (blobSHA(bytes) !== item.sha || Object.entries(indexEntry(record, item.sha)).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(item[key]))) throw new Error("Post index does not match its file: " + item.id);
  for (const asset of record.assets) {
    const bytes = await readFile(asset.path.slice(1));
    if (blobSHA(bytes) !== asset.sha) throw new Error("Image does not match its stored version: " + asset.path);
  }
  if (record.status !== "published") continue;
  const text = plainText(record.doc);
  posts.push({ ...record, sha: item.sha, searchText: text, readTime: Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 200)), sample: false });
}
posts.sort((a, b) => b.date.localeCompare(a.date) || b.publishedAt.localeCompare(a.publishedAt));
await writeFile("published.js", "window.BLOG_PUBLISHED = " + JSON.stringify(posts).replaceAll("<", "\\u003c") + ";\nwindow.BLOG_MANAGED_KINDS = " + JSON.stringify([...new Set(index.entries.map(item => item.kind))]) + ";\n");
console.log("Prepared " + posts.length + " published post(s); " + (index.entries.length - posts.length) + " in trash.");
