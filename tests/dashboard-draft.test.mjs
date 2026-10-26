import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_FORMAT } from "../shared/dashboard.js";
import { newDashboardDraft, validateDashboardDraft, draftIsDirty, reconcileDashboardDraft, mergeDashboardDraft, WorkspaceConflict } from "../shared/dashboard-draft.js";

const initial = {
  format: DASHBOARD_FORMAT, version: 1, memo: "", tasks: [], updatedAt: null,
  shortcuts: [{ id: "00000000-0000-4000-8000-000000000001", title: "GitHub", url: "https://github.com/yt010108/" }]
};
const task = text => ({ id: crypto.randomUUID(), text, done: false });

test("Browser draft serialization keeps memo and tasks without credentials or shortcut edits", () => {
  const draft = newDashboardDraft(initial);
  draft.value.memo = "브라우저에 남긴 생각 📝"; draft.value.tasks.push(task("글 쓰기"));
  const restored = validateDashboardDraft({ ...JSON.parse(JSON.stringify(draft)), token: "must not persist", shortcuts: initial.shortcuts });
  assert.deepEqual(restored.value, draft.value);
  assert.equal(restored.token, undefined); assert.equal(restored.shortcuts, undefined);
  assert.equal(draftIsDirty(restored), true);
  assert.throws(() => validateDashboardDraft({ ...draft, value: { ...draft.value, memo: "a".repeat(20001) } }));
});
test("Unsaved browser drafts survive receiving a newer deployed version", () => {
  const draft = newDashboardDraft(initial); draft.value.memo = "계속 작성할 초안";
  assert.deepEqual(reconcileDashboardDraft(draft, { ...initial, memo: "다른 기기에서 저장" }), draft);
});
test("A clean API save stays visible while the public deployment is older", () => {
  const saved = { ...initial, memo: "방금 저장", updatedAt: "2026-10-26T08:00:00Z" };
  const draft = newDashboardDraft(saved);
  assert.deepEqual(reconcileDashboardDraft(draft, initial), draft);
  const newer = { ...saved, memo: "이후 수정", updatedAt: "2026-10-26T09:00:00Z" };
  assert.equal(reconcileDashboardDraft(draft, newer).value.memo, "이후 수정");
});
test("A Dashboard save preserves remote shortcuts and independently changed tasks", () => {
  const draft = newDashboardDraft(initial); draft.value.memo = "내 메모";
  const latest = { ...initial, tasks: [task("다른 기기의 할 일")], shortcuts: initial.shortcuts.map((item, i) => i ? item : { ...item, title: "CMS에서 바꾼 이름" }) };
  const merged = mergeDashboardDraft(draft, latest);
  assert.equal(merged.memo, "내 메모"); assert.deepEqual(merged.tasks, latest.tasks); assert.deepEqual(merged.shortcuts, latest.shortcuts);
  assert.deepEqual(draft.base, newDashboardDraft(initial).base);
});
test("Conflicting remote memo or task edits are rejected without altering the browser draft", () => {
  const draft = newDashboardDraft(initial); draft.value.memo = "내 수정";
  assert.throws(() => mergeDashboardDraft(draft, { ...initial, memo: "원격 수정" }), WorkspaceConflict);
  assert.equal(draft.value.memo, "내 수정");
  const tasks = newDashboardDraft(initial); tasks.value.tasks.push(task("내 할 일"));
  assert.throws(() => mergeDashboardDraft(tasks, { ...initial, tasks: [task("원격 할 일")] }), WorkspaceConflict);
  assert.equal(tasks.value.tasks[0].text, "내 할 일");
});
test("Matching remote saves and independent remote memo changes reconcile safely", () => {
  const draft = newDashboardDraft(initial); draft.value.memo = "동일한 변경";
  assert.equal(mergeDashboardDraft(draft, { ...initial, memo: "동일한 변경" }).memo, "동일한 변경");
  const tasks = newDashboardDraft(initial); tasks.value.tasks.push(task("내 할 일"));
  const merged = mergeDashboardDraft(tasks, { ...initial, memo: "다른 기기의 메모" });
  assert.equal(merged.memo, "다른 기기의 메모"); assert.deepEqual(merged.tasks, tasks.value.tasks);
});
