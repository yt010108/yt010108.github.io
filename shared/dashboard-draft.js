import { DASHBOARD_FORMAT, validateDashboard } from "./dashboard.js";
import { UUID } from "./posts.js";

export const DASHBOARD_DRAFT_KEY = "yt010108-dashboard-draft-v1";
const format = "yt010108-dashboard-draft";
export function workspace(value) {
  const config = validateDashboard({ format: DASHBOARD_FORMAT, version: 1, memo: value?.memo, tasks: value?.tasks, shortcuts: [], updatedAt: null });
  return { memo: config.memo, tasks: config.tasks };
}
export const sameWorkspace = (a, b) => JSON.stringify(workspace(a)) === JSON.stringify(workspace(b));
export function newDashboardDraft(config) {
  const value = validateDashboard(config);
  return { format, version: 2, base: workspace(value), value: workspace(value), baseUpdatedAt: value.updatedAt, pendingMemo: false, pendingTasks: [] };
}
export function validateDashboardDraft(draft) {
  if (draft?.format !== format || ![1, 2].includes(draft.version)) throw new Error("브라우저 초안 형식을 확인해 주세요.");
  const base = workspace(draft.base), value = workspace(draft.value);
  const checked = validateDashboard({ format: DASHBOARD_FORMAT, version: 1, ...base, shortcuts: [], updatedAt: draft.baseUpdatedAt });
  const pendingTasks = draft.version === 1 ? [] : draft.pendingTasks;
  const pendingMemo = draft.version === 1 ? false : draft.pendingMemo;
  if (!Array.isArray(pendingTasks) || pendingTasks.length > 300 || typeof pendingMemo !== "boolean") throw new Error("저장 대기 중인 항목을 확인해 주세요.");
  const used = new Set();
  const operations = pendingTasks.map(operation => { const checked = validateTaskOperation(operation); if (used.has(checked.id)) throw new Error("저장 작업 ID가 중복돼요."); used.add(checked.id); return checked; });
  return { format, version: 2, base, value, baseUpdatedAt: checked.updatedAt, pendingMemo, pendingTasks: operations };
}
export const draftIsDirty = draft => Boolean(draft.pendingMemo || draft.pendingTasks?.length || !sameWorkspace(draft.base, draft.value));
export function reconcileDashboardDraft(draft, config) {
  const current = validateDashboard(config);
  if (!draft) return newDashboardDraft(current);
  const restored = validateDashboardDraft(draft);
  // A successful API save can be newer than the still-deploying public JSON.
  if (Date.parse(restored.baseUpdatedAt || "") > (Date.parse(current.updatedAt || "") || 0)) return restored;
  if (restored.base.memo === restored.value.memo && !restored.pendingMemo) { restored.base.memo = current.memo; restored.value.memo = current.memo; }
  if (restored.pendingTasks.length) { restored.base.tasks = current.tasks; restored.value.tasks = replayTasks(current.tasks, restored.pendingTasks); }
  else if (JSON.stringify(restored.base.tasks) === JSON.stringify(restored.value.tasks)) { restored.base.tasks = current.tasks; restored.value.tasks = structuredClone(current.tasks); }
  restored.baseUpdatedAt = current.updatedAt;
  return restored;
}
export class WorkspaceConflict extends Error {
  constructor() { super("다른 기기에서 같은 메모 또는 할 일이 바뀌었어요. 현재 초안은 브라우저에 유지했어요. 내용을 복사해 둔 뒤 최신 저장본을 다시 불러와 주세요."); this.name = "WorkspaceConflict"; }
}
export function mergeDashboardDraft(draft, latest) {
  const checked = validateDashboardDraft(draft), remote = validateDashboard(latest), next = { ...remote };
  for (const key of ["memo", "tasks"]) {
    const base = JSON.stringify(checked.base[key]), local = JSON.stringify(checked.value[key]), saved = JSON.stringify(remote[key]);
    if (local !== base && saved !== base && local !== saved) throw new WorkspaceConflict();
    next[key] = structuredClone(local === base ? remote[key] : checked.value[key]);
  }
  // Shortcuts always come from GitHub, including changes made in the CMS.
  return validateDashboard(next);
}

export function mergeDashboardMemo(draft, latest) {
  const checked = validateDashboardDraft(draft), remote = validateDashboard(latest);
  if (checked.value.memo !== checked.base.memo && remote.memo !== checked.base.memo && remote.memo !== checked.value.memo) throw new WorkspaceConflict();
  return validateDashboard({ ...remote, memo: checked.value.memo });
}
export function validateTaskOperation(operation) {
  if (!operation || !UUID.test(operation.id)) throw new Error("할 일 저장 작업이 올바르지 않아요.");
  if (operation.kind === "add") return { id: operation.id, kind: "add", task: workspace({ memo: "", tasks: [operation.task] }).tasks[0] };
  if (!UUID.test(operation.taskId)) throw new Error("할 일 ID가 올바르지 않아요.");
  if (operation.kind === "delete") return { id: operation.id, kind: "delete", taskId: operation.taskId };
  if (operation.kind === "set" && typeof operation.done === "boolean") return { id: operation.id, kind: "set", taskId: operation.taskId, done: operation.done };
  throw new Error("할 일 저장 작업이 올바르지 않아요.");
}
export function applyTaskOperation(latest, operation) {
  const result = validateDashboard(latest), checked = validateTaskOperation(operation);
  if (checked.kind === "add") {
    const existing = result.tasks.find(task => task.id === checked.task.id);
    if (existing && existing.text !== checked.task.text) throw new WorkspaceConflict();
    if (!existing) result.tasks.push(checked.task);
  } else if (checked.kind === "delete") result.tasks = result.tasks.filter(task => task.id !== checked.taskId);
  else { const task = result.tasks.find(task => task.id === checked.taskId); if (task) task.done = checked.done; }
  return validateDashboard(result);
}
export function replayTasks(tasks, operations) {
  let config = { format: DASHBOARD_FORMAT, version: 1, memo: "", tasks, shortcuts: [], updatedAt: null };
  for (const operation of operations) config = applyTaskOperation(config, operation);
  return structuredClone(config.tasks);
}
export function legacyTaskOperations(draft) {
  const checked = validateDashboardDraft(draft), operations = [];
  for (const task of checked.base.tasks) if (!checked.value.tasks.some(item => item.id === task.id)) operations.push({ id: crypto.randomUUID(), kind: "delete", taskId: task.id });
  for (const task of checked.value.tasks) {
    const original = checked.base.tasks.find(item => item.id === task.id);
    if (!original) operations.push({ id: crypto.randomUUID(), kind: "add", task });
    else {
      if (original.text !== task.text) throw new WorkspaceConflict();
      if (original.done !== task.done) operations.push({ id: crypto.randomUUID(), kind: "set", taskId: task.id, done: task.done });
    }
  }
  return operations;
}
export function acknowledgeDashboardSave(draft, config, operationId = null) {
  const next = validateDashboardDraft(draft), saved = validateDashboard(config);
  if (operationId) {
    next.pendingTasks = next.pendingTasks.filter(operation => operation.id !== operationId);
    next.base.tasks = saved.tasks; next.value.tasks = replayTasks(saved.tasks, next.pendingTasks);
  } else { next.base.memo = saved.memo; next.value.memo = saved.memo; next.pendingMemo = false; }
  return reconcileDashboardDraft(next, saved);
}
