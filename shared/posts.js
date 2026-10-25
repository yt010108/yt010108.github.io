import { validateTaxonomy } from "./taxonomy.js";

export const POST_FORMAT = "yt010108-published-post";
export const INDEX_FORMAT = "yt010108-post-index";
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const SHA = /^[a-f0-9]{40}$/;
const TYPES = new Set(["doc", "paragraph", "text", "heading", "hardBreak", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "horizontalRule", "image", "table", "tableRow", "tableHeader", "tableCell", "linkPreview"]);
export const entryPath = id => {
  if (!UUID.test(id)) throw new Error("글 ID가 올바르지 않아요.");
  return "blog/entries/" + id + ".json";
};
export const uploadPath = (id, path) => {
  entryPath(id);
  if (!/^images\/[a-f0-9-]{36}\.(png|jpg|gif|webp)$/.test(path)) throw new Error("이미지 경로가 올바르지 않아요.");
  return "assets/uploads/" + id + "/" + path.slice(7);
};
export const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export function safeURL(value, image = false) {
  if (typeof value !== "string" || value.length > 4096) return "";
  if (image && /^\/assets\/uploads\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|gif|webp)$/.test(value)) return value;
  try {
    const url = new URL(value);
    return (image ? url.protocol === "https:" : ["https:", "http:", "mailto:"].includes(url.protocol)) && !url.username && !url.password ? url.href : "";
  } catch { return !image && /^#[a-zA-Z0-9_-]+$/.test(value) ? value : ""; }
}
export function validateDocument(doc) {
  if (doc?.type !== "doc") throw new Error("본문 형식이 올바르지 않아요.");
  let count = 0;
  const visit = (node, depth) => {
    if (++count > 50000 || depth > 50 || !node || !TYPES.has(node.type)) throw new Error("지원하지 않는 본문 형식이에요.");
    if (node.text !== undefined && typeof node.text !== "string") throw new Error("본문 텍스트 형식이 올바르지 않아요.");
    if (node.content !== undefined && !Array.isArray(node.content)) throw new Error("본문 형식이 올바르지 않아요.");
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some(mark => !["bold", "italic", "strike", "code", "link"].includes(mark?.type)))) throw new Error("지원하지 않는 본문 서식이에요.");
    node.content?.forEach(child => visit(child, depth + 1));
  };
  visit(doc, 0);
  return doc;
}
function metadata(value) {
  if (!UUID.test(value?.id) || !["posts", "notes"].includes(value.kind) || !["published", "trash"].includes(value.status)) throw new Error("저장된 글 정보를 확인할 수 없어요.");
  for (const field of ["title", "slug", "description", "category", "date", "updatedAt", "publishedAt"]) {
    if (typeof value[field] !== "string" || value[field].length > (field === "description" ? 500 : 200)) throw new Error("저장된 글 정보가 올바르지 않아요.");
  }
  if (!value.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Array.isArray(value.tags) || value.tags.length > 30 || value.tags.some(tag => typeof tag !== "string" || tag.length > 80)) throw new Error("제목·날짜·태그를 확인해 주세요.");
  if (!/^[a-f0-9]{64}$/.test(value.sourceDigest || "")) throw new Error("글 버전 정보를 확인할 수 없어요.");
}
export function validateRecord(value) {
  if (value?.format !== POST_FORMAT || value.version !== 1) throw new Error("지원하지 않는 발행 글 형식이에요.");
  metadata(value);
  validateDocument(value.doc);
  if (!Array.isArray(value.assets) || value.assets.length > 150) throw new Error("이미지 목록을 확인할 수 없어요.");
  const ids = new Set();
  for (const asset of value.assets) {
    if (!UUID.test(asset.id) || ids.has(asset.id) || !SHA.test(asset.sha) || asset.path !== "/" + uploadPath(value.id, "images/" + asset.path.split("/").at(-1)) || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(asset.type)) throw new Error("발행 이미지 정보를 확인할 수 없어요.");
    ids.add(asset.id);
  }
  return value;
}
export function validateIndex(value) {
  if (value?.format !== INDEX_FORMAT || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 10000) throw new Error("글 목록 형식을 확인할 수 없어요.");
  if (value.taxonomy !== undefined) validateTaxonomy(value.taxonomy);
  const ids = new Set();
  for (const item of value.entries) {
    metadata(item);
    if (ids.has(item.id) || !SHA.test(item.sha) || item.path !== entryPath(item.id)) throw new Error("글 목록 정보가 올바르지 않아요.");
    ids.add(item.id);
  }
  return value;
}
export function indexEntry(record, sha) {
  const { id, kind, slug, title, description, category, tags, date, updatedAt, publishedAt, status, trashedAt, sourceDigest } = record;
  return { id, kind, slug, title, description, category, tags, date, updatedAt, publishedAt, status, sourceDigest, trashedAt: trashedAt || null, path: entryPath(id), sha };
}
export async function draftDigest(entry) {
  const value = JSON.stringify({
    title: entry.title, kind: entry.kind, slug: entry.slug, description: entry.description, category: entry.category,
    tags: entry.tags, date: entry.date, doc: entry.doc,
    assets: entry.assets.map(({ id, path, name }) => ({ id, path, name }))
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function plainText(doc) {
  if (doc.type === "text") return doc.text || "";
  if (doc.type === "hardBreak") return "\n";
  if (doc.type === "image") return doc.attrs?.alt || "";
  if (doc.type === "linkPreview") return [doc.attrs?.title, doc.attrs?.description, doc.attrs?.href].filter(Boolean).join(" ");
  const value = (doc.content || []).map(plainText).join("");
  return value + (["paragraph", "heading", "codeBlock", "listItem", "tableRow"].includes(doc.type) ? "\n" : "");
}
export function renderDocument(doc, { assets = [], preview = false } = {}) {
  validateDocument(doc);
  const headings = [], images = new Map(assets.map(asset => [asset.id, asset]));
  function render(node) {
    const attrs = node.attrs || {}, children = () => (node.content || []).map(render).join("");
    switch (node.type) {
      case "doc": return children();
      case "text": {
        let html = esc(node.text);
        for (const mark of node.marks || []) {
          const tag = { bold: "strong", italic: "em", strike: "s", code: "code" }[mark.type];
          if (tag) html = "<" + tag + ">" + html + "</" + tag + ">";
          else if (mark.type === "link") {
            const href = safeURL(mark.attrs?.href);
            if (href) html = '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + html + "</a>";
          }
        }
        return html;
      }
      case "paragraph": return "<p>" + (children() || "<br>") + "</p>";
      case "heading": {
        const level = [1, 2, 3, 4, 5, 6].includes(attrs.level) ? attrs.level : 2, id = "section-" + (headings.length + 1);
        headings.push({ id, level, text: plainText(node).trim() });
        return "<h" + level + ' id="' + id + '">' + children() + "</h" + level + ">";
      }
      case "hardBreak": return "<br>";
      case "bulletList": return "<ul>" + children() + "</ul>";
      case "orderedList": return '<ol start="' + (Number.isInteger(attrs.start) && attrs.start > 0 ? attrs.start : 1) + '">' + children() + "</ol>";
      case "listItem": return "<li>" + children() + "</li>";
      case "blockquote": return "<blockquote>" + children() + "</blockquote>";
      case "horizontalRule": return "<hr>";
      case "codeBlock": {
        const lang = typeof attrs.language === "string" ? attrs.language.slice(0, 50) : "";
        const code = (node.content || []).map(child => child.text || "").join("");
        return '<div class="article-code"><div class="code-heading"><span>' + esc(lang || "TEXT") + '</span><button class="copy-code" type="button" aria-live="polite">복사</button></div><pre><code class="language-' + esc(lang) + '">' + esc(code) + "</code></pre></div>";
      }
      case "image": {
        const asset = images.get(attrs.assetId);
        const source = preview && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(asset?.data || "") ? asset.data : safeURL(asset?.path || attrs.src, true);
        return source ? '<img class="post-image" src="' + esc(source) + '" alt="' + esc(attrs.alt || "") + '" loading="lazy" referrerpolicy="no-referrer">' : "";
      }
      case "table": return '<div class="article-table-wrap"><table><tbody>' + children() + "</tbody></table></div>";
      case "tableRow": return "<tr>" + children() + "</tr>";
      case "tableHeader":
      case "tableCell": {
        const tag = node.type === "tableHeader" ? "th" : "td";
        const span = key => Number.isInteger(attrs[key]) && attrs[key] > 1 && attrs[key] <= 20 ? " " + key + '="' + attrs[key] + '"' : "";
        return "<" + tag + span("colspan") + span("rowspan") + ">" + children() + "</" + tag + ">";
      }
      case "linkPreview": {
        const href = safeURL(attrs.href);
        if (!/^https?:/.test(href)) return "";
        const host = new URL(href).hostname, image = safeURL(attrs.image, true);
        return '<figure class="writer-link-preview"><a class="writer-link-card" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span class="writer-link-media" data-kind="' + (attrs.imageKind === "logo" ? "logo" : "image") + '"><span class="writer-link-placeholder" aria-hidden="true">↗</span>' + (image ? '<img class="writer-link-image" src="' + esc(image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : "") + '</span><span class="writer-link-copy"><span class="writer-link-title">' + esc(attrs.title || host) + '</span><span class="writer-link-description">' + esc(attrs.description || "") + '</span><span class="writer-link-site">' + esc(host) + "</span></span></a></figure>";
      }
      default: return "";
    }
  }
  return { html: render(doc), headings, text: plainText(doc) };
}
