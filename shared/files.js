export const FILE_TYPE = "application/octet-stream";
export const FILE_PATH = /^files\/[a-f0-9-]{36}\.bin$/;
export const PUBLIC_FILE_PATH = /^\/assets\/uploads\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.bin$/;
export const localAssetPath = asset => (asset.type === FILE_TYPE ? "files/" : "images/") + asset.path.split("/").at(-1);

export function safeFileData(data) {
  if (typeof data !== "string" || !data.startsWith("data:" + FILE_TYPE + ";base64,")) return false;
  const value = data.slice(data.indexOf(",") + 1);
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function createFileAsset(data, name) {
  if (!safeFileData(data)) throw new Error("첨부 파일 형식을 확인해 주세요.");
  const id = crypto.randomUUID();
  // Serve arbitrary attachments as binary; HTML/SVG must never execute on the blog origin.
  return { id, name: String(name || "첨부 파일").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").slice(0, 200), type: FILE_TYPE, path: "files/" + id + ".bin", data };
}
