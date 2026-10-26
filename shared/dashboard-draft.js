import { DASHBOARD_FORMAT, validateDashboard } from "./dashboard.js";

export const DASHBOARD_DRAFT_KEY = "yt010108-dashboard-draft-v1";
const format = "yt010108-dashboard-draft";
export function workspace(value) {
  const config = validateDashboard({ format: DASHBOARD_FORMAT, version: 1, memo: value?.memo, tasks: value?.tasks, shortcuts: [], updatedAt: null });
  return { memo: config.memo, tasks: config.tasks };
}
export const sameWorkspace = (a, b) => JSON.stringify(workspace(a)) === JSON.stringify(workspace(b));
export function newDashboardDraft(config) {
  const value = validateDashboard(config);
  return { format, version: 1, base: workspace(value), value: workspace(value), baseUpdatedAt: value.updatedAt };
}
export function validateDashboardDraft(draft) {
  if (draft?.format !== format || draft.version !== 1) throw new Error("브라우저 초안 형식을 확인해 주세요.");
  const base = workspace(draft.base), value = workspace(draft.value);
  const checked = validateDashboard({ format: DASHBOARD_FORMAT, version: 1, ...base, shortcuts: [], updatedAt: draft.baseUpdatedAt });
  return { format, version: 1, base, value, baseUpdatedAt: checked.updatedAt };
}
export const draftIsDirty = draft => !sameWorkspace(draft.base, draft.value);
export function reconcileDashboardDraft(draft, config) {
  const current = validateDashboard(config);
  if (!draft) return newDashboardDraft(current);
  const restored = validateDashboardDraft(draft);
  if (draftIsDirty(restored)) return restored;
  // A successful API save can be newer than the still-deploying public JSON.
  if (Date.parse(restored.baseUpdatedAt || "") > (Date.parse(current.updatedAt || "") || 0)) return restored;
  return newDashboardDraft(current);
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
