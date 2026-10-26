export const DASHBOARD_FORMAT = "yt010108-dashboard";
export const DASHBOARD_PATH = "blog/dashboard.json";
export const DEFAULT_WORKING_ON = [
  { id: "4da7442f-950b-4ea9-bcc8-360b36ff3b12", title: "블로그 개선", description: "글쓰기 · 대시보드 정리", url: "https://github.com/yt010108/yt010108.github.io" },
  { id: "b34b3a16-7147-41d8-9ec9-415dd7733471", title: "Reverser", description: "리버싱 CTF 하네스", url: "https://github.com/yt010108/Reverser" },
  { id: "7c05631b-4649-47cb-afcb-f8386326525d", title: "Recon", description: "웹 리콘 하네스", url: "https://github.com/yt010108/Recon" }
];
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
  if (!value || value.format !== DASHBOARD_FORMAT || ![1, 2].includes(value.version) || !Array.isArray(value.tasks) || value.tasks.length > 100 || !Array.isArray(value.shortcuts) || value.shortcuts.length > 24) throw new Error("대시보드 저장 형식을 확인해 주세요. 화면을 새로고침한 뒤 다시 시도해 주세요.");
  const sourceWorking = value.version === 1 && value.workingOn === undefined ? DEFAULT_WORKING_ON : value.workingOn;
  if (!Array.isArray(sourceWorking) || sourceWorking.length > 8) throw new Error("Working on 항목은 8개까지 저장할 수 있어요.");
  const used = new Set();
  const id = value => { if (!idPattern.test(value) || used.has(value)) throw new Error("대시보드 항목 ID가 올바르지 않아요."); used.add(value); return value; };
  const memo = text(value.memo, 20000, "메모", true);
  const tasks = value.tasks.map(task => {
    if (!task || typeof task.done !== "boolean") throw new Error("할 일 상태를 확인해 주세요.");
    return { id: id(task.id), text: text(task.text, 200, "할 일"), done: task.done };
  });
  const shortcuts = value.shortcuts.map(link => ({ id: id(link?.id), title: text(link?.title, 40, "사이트 이름"), url: shortcutURL(link?.url) }));
  const workingOn = sourceWorking.map(link => ({ id: id(link?.id), title: text(link?.title, 60, "Working on 이름"), description: text(link?.description, 160, "Working on 설명", true), url: shortcutURL(link?.url) }));
  if (value.updatedAt !== null && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || value.updatedAt.length > 40)) throw new Error("저장 시각을 확인해 주세요.");
  const result = { format: DASHBOARD_FORMAT, version: 2, memo, tasks, shortcuts, workingOn, updatedAt: value.updatedAt };
  if (JSON.stringify(result).length > 60000) throw new Error("대시보드 내용이 너무 길어요.");
  return result;
}
export const dashboardText = value => JSON.stringify(validateDashboard(value), null, 2) + "\n";
export function mergeDashboardSettings(base, value, latest) {
  const original = validateDashboard(base), local = validateDashboard(value), remote = validateDashboard(latest), result = { ...remote };
  for (const key of ["memo", "tasks", "shortcuts", "workingOn"]) {
    const a = JSON.stringify(original[key]), b = JSON.stringify(local[key]), c = JSON.stringify(remote[key]);
    if (b !== a && c !== a && b !== c) throw new Error("다른 기기에서 같은 항목을 수정했어요. 현재 입력은 유지했으니 내용을 복사한 뒤 최신 저장본을 다시 불러와 주세요.");
    result[key] = structuredClone(b === a ? remote[key] : local[key]);
  }
  return validateDashboard(result);
}
export function faviconURL(value) {
  const host = new URL(shortcutURL(value)).hostname;
  return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=64";
}
