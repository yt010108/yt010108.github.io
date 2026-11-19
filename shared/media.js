import { UUID, SHA } from "./posts.js";

export const MEDIA_PATH = "blog/media.json";
export const MEDIA_FORMAT = "yt010108-media";
export const MEDIA_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export function mediaPath(id, type) { if (!UUID.test(id) || !MEDIA_TYPES[type]) throw new Error("이미지 종류를 확인해 주세요."); return "assets/uploads/library/" + id + "." + MEDIA_TYPES[type]; }
export function validateMedia(value) {
  if (value?.format !== MEDIA_FORMAT || value.version !== 1 || !Array.isArray(value.files) || value.files.length > 1000) throw new Error("미디어 목록을 확인해 주세요.");
  const used = new Set();
  const files = value.files.map(item => {
    if (!UUID.test(item.id) || used.has(item.id) || item.path !== mediaPath(item.id, item.type) || !SHA.test(item.sha) || !Number.isSafeInteger(item.size) || item.size < 1 || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200 || typeof item.alt !== "string" || item.alt.length > 300 || !Number.isFinite(Date.parse(item.createdAt))) throw new Error("미디어 파일 정보를 확인해 주세요.");
    used.add(item.id); return { id: item.id, path: item.path, name: item.name, alt: item.alt, type: item.type, size: item.size, sha: item.sha, createdAt: item.createdAt };
  });
  return { format: MEDIA_FORMAT, version: 1, files };
}
export const mediaText = value => JSON.stringify(validateMedia(value), null, 2) + "\n";
export function verifyImageBytes(bytes, type) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("이미지 데이터를 읽을 수 없어요.");
  const starts = (...values) => values.every((byte, index) => bytes[index] === byte);
  const ascii = (offset, value) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  const valid = type === "image/png" ? starts(137,80,78,71,13,10,26,10) : type === "image/jpeg" ? starts(255,216,255) : type === "image/gif" ? ascii(0,"GIF87a") || ascii(0,"GIF89a") : type === "image/webp" ? ascii(0,"RIFF") && ascii(8,"WEBP") : false;
  if (!valid) throw new Error("실제 PNG·JPG·GIF·WebP 이미지 파일을 선택해 주세요.");
  return bytes;
}
export function referencesPath(value, path) {
  if (typeof value === "string") return value.includes(path) || value.includes(path.replace(/^\//, ""));
  if (Array.isArray(value)) return value.some(item => referencesPath(item, path));
  return value && typeof value === "object" ? Object.values(value).some(item => referencesPath(item, path)) : false;
}
