export const DASHBOARD_FORMAT = "yt010108-dashboard";
export const DASHBOARD_PATH = "blog/dashboard.json";
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const text = (value, limit, label, blank = false) => {
  if (typeof value !== "string" || value.length > limit || (!blank && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(label + "을 확인해 주세요.");
  return blank ? value : value.trim();
};
export function shortcutURL(value) {
  const url = new URL(text(value, 1500, "사이트 주소"));
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("http 또는 https 사이트 주소를 입력해 주세요.");
  return url.href;
}
export function validateDashboard(value) {
  if (!value || value.format !== DASHBOARD_FORMAT || value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length > 100 || !Array.isArray(value.shortcuts) || value.shortcuts.length > 24) throw new Error("대시보드 저장 형식을 확인해 주세요.");
  const used = new Set();
  const id = value => { if (!idPattern.test(value) || used.has(value)) throw new Error("대시보드 항목 ID가 올바르지 않아요."); used.add(value); return value; };
  const memo = text(value.memo, 20000, "메모", true);
  const tasks = value.tasks.map(task => {
    if (!task || typeof task.done !== "boolean") throw new Error("할 일 상태를 확인해 주세요.");
    return { id: id(task.id), text: text(task.text, 200, "할 일"), done: task.done };
  });
  const shortcuts = value.shortcuts.map(link => ({ id: id(link?.id), title: text(link?.title, 40, "사이트 이름"), url: shortcutURL(link?.url) }));
  if (value.updatedAt !== null && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || value.updatedAt.length > 40)) throw new Error("저장 시각을 확인해 주세요.");
  const result = { format: DASHBOARD_FORMAT, version: 1, memo, tasks, shortcuts, updatedAt: value.updatedAt };
  if (JSON.stringify(result).length > 60000) throw new Error("대시보드 내용이 너무 길어요.");
  return result;
}
export const dashboardText = value => JSON.stringify(validateDashboard(value), null, 2) + "\n";
export function faviconURL(value) {
  const host = new URL(shortcutURL(value)).hostname;
  return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64";
}
