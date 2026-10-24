export const FORMAT = "yt010108-writing-draft";
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

export function newEntry() {
  const now = new Date();
  const date = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return {
    format: FORMAT, version: 1, id: crypto.randomUUID(), revision: 0,
    title: "", kind: "posts", category: "", tags: [], slug: "", description: "", date,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
    doc: { type: "doc", content: [{ type: "paragraph" }] }, assets: [], mode: "rich", markdown: null
  };
}

export function safeSlug(value) {
  return value.normalize("NFKC").toLowerCase().trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "untitled";
}

export function safeImageData(value) {
  return typeof value === "string" && value.length <= MAX_IMAGE_SIZE * 1.4 + 100 && DATA_IMAGE.test(value);
}

export function createAsset(data, name = "첨부 이미지") {
  if (!safeImageData(data)) throw new Error("PNG, JPG, GIF, WebP 이미지를 첨부해 주세요.");
  const id = crypto.randomUUID();
  const type = data.slice(5, data.indexOf(";"));
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  return { id, name, type, path: "images/" + id + "." + ext, data };
}

export function imageBySource(assets, src) {
  for (const asset of assets.values()) if (asset.path === src || asset.data === src) return asset;
}

export function transformImages(doc, assets, hydrate) {
  const next = { ...doc };
  if (doc.attrs) next.attrs = { ...doc.attrs };
  if (doc.type === "image") {
    const asset = assets.get(doc.attrs?.assetId) || imageBySource(assets, doc.attrs?.src);
    if (asset) next.attrs = { ...next.attrs, assetId: asset.id, src: hydrate ? asset.data : asset.path, width: null, height: null };
    else if (!/^(https:\/\/|images\/)/i.test(next.attrs.src || "")) next.attrs.src = "";
  }
  if (doc.marks) next.marks = doc.marks.filter(mark => mark.type !== "link" || /^(https?:\/\/|mailto:|\/|#)/i.test(mark.attrs?.href || ""));
  if (doc.content) next.content = doc.content.map(child => transformImages(child, assets, hydrate));
  return next;
}

export function usedAssets(doc, assets, markdown = "") {
  const ids = new Set();
  const visit = node => {
    if (node.type === "image") {
      const asset = assets.get(node.attrs?.assetId) || imageBySource(assets, node.attrs?.src);
      if (asset) ids.add(asset.id);
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  for (const asset of assets.values()) if (markdown.includes(asset.path)) ids.add(asset.id);
  return [...ids].map(id => assets.get(id));
}

export function validateBackup(value) {
  if (!value || value.format !== FORMAT || value.version !== 1 || value.doc?.type !== "doc" || !Array.isArray(value.assets)) {
    throw new Error("이 글쓰기에서 내보낸 편집용 백업 파일을 선택해 주세요.");
  }
  if (value.assets.length > 150) throw new Error("첨부 이미지가 너무 많아요.");
  const assets = new Map();
  for (const asset of value.assets) {
    if (!asset || typeof asset.id !== "string" || !/^images\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(asset.path) || !safeImageData(asset.data) || assets.has(asset.id)) {
      throw new Error("백업 이미지 정보를 확인할 수 없어요.");
    }
    assets.set(asset.id, { ...asset, name: String(asset.name || "첨부 이미지").slice(0, 200) });
  }
  let count = 0;
  const visit = (node, depth) => {
    if (++count > 50000 || depth > 50 || !node || typeof node.type !== "string") throw new Error("백업 본문 형식을 확인할 수 없어요.");
    if (node.type === "image" && node.attrs?.assetId && !assets.has(node.attrs.assetId)) throw new Error("백업에 필요한 이미지가 없어요.");
    if (node.content !== undefined && !Array.isArray(node.content)) throw new Error("백업 본문 형식을 확인할 수 없어요.");
    node.content?.forEach(child => visit(child, depth + 1));
  };
  visit(value.doc, 0);
  const entry = newEntry();
  for (const field of ["title", "category", "slug", "description"]) entry[field] = String(value[field] || "").slice(0, field === "description" ? 500 : 200);
  entry.kind = value.kind === "notes" ? "notes" : "posts";
  entry.tags = [...new Set((Array.isArray(value.tags) ? value.tags : []).map(tag => String(tag).trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.date)) entry.date = value.date;
  entry.assets = [...assets.values()];
  entry.doc = transformImages(value.doc, assets, false);
  entry.mode = value.mode === "markdown" ? "markdown" : "rich";
  entry.markdown = entry.mode === "markdown" && typeof value.markdown === "string" ? value.markdown : null;
  return entry;
}

export function markdownDocument(entry, markdown) {
  const lines = [
    "---", "title: " + JSON.stringify(entry.title || "제목 없는 글"), "date: " + JSON.stringify(entry.date),
    "description: " + JSON.stringify(entry.description), "type: " + JSON.stringify(entry.kind),
    "category: " + JSON.stringify(entry.category), "tags: " + JSON.stringify(entry.tags), "draft: true", "---", "", markdown, ""
  ];
  return lines.join("\n");
}

export function assetBytes(asset) {
  const raw = atob(asset.data.slice(asset.data.indexOf(",") + 1));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
