import test from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_FORMAT, validateDashboard, DEFAULT_WORKING_ON, mergeDashboardSettings } from "../shared/dashboard.js";
import { newDashboardDraft, validateDashboardDraft, mergeDashboardMemo, applyTaskOperation, acknowledgeDashboardSave, reconcileDashboardDraft, legacyTaskOperations } from "../shared/dashboard-draft.js";

const fixture = () => validateDashboard({ format: DASHBOARD_FORMAT, version: 1, memo: "기존 메모", tasks: [], shortcuts: [{ id: crypto.randomUUID(), title: "자료", url: "https://example.com/" }], updatedAt: null });
const add = text => ({ id: crypto.randomUUID(), kind: "add", task: { id: crypto.randomUUID(), text, done: false } });

test("Old Dashboard files gain editable Working on links without changing saved content", () => {
  const legacy = { ...fixture(), version: 1 }; delete legacy.workingOn;
  const migrated = validateDashboard(legacy);
  assert.equal(migrated.version, 2); assert.deepEqual(migrated.workingOn, DEFAULT_WORKING_ON);
  assert.equal(migrated.memo, legacy.memo); assert.deepEqual(migrated.tasks, legacy.tasks); assert.deepEqual(migrated.shortcuts, legacy.shortcuts);
  assert.throws(() => validateDashboard({ ...legacy, version: 2 }));
  assert.throws(() => validateDashboard({ ...legacy, version: 3 }));
});
test("Working on accepts an empty list and rejects executable URLs, duplicates and excessive entries", () => {
  const value = fixture();
  assert.deepEqual(validateDashboard({ ...value, workingOn: [] }).workingOn, []);
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:password@example.com/"]) assert.throws(() => validateDashboard({ ...value, workingOn: [{ ...value.workingOn[0], url }] }));
  assert.throws(() => validateDashboard({ ...value, workingOn: [value.workingOn[0], value.workingOn[0]] }));
  assert.throws(() => validateDashboard({ ...value, workingOn: Array.from({ length: 9 }, () => ({ ...value.workingOn[0], id: crypto.randomUUID() })) }));
});
test("Memo saving never publishes pending To-do changes or replaces current admin settings", () => {
  const original = fixture(), draft = newDashboardDraft(original), task = add("저장 대기 할 일");
  draft.value.memo = "메모만 저장"; draft.pendingMemo = true; draft.pendingTasks = [task]; draft.value.tasks = [task.task];
  const latest = { ...original, workingOn: original.workingOn.slice().reverse(), tasks: [add("다른 기기의 할 일").task] };
  const saved = mergeDashboardMemo(draft, latest);
  assert.equal(saved.memo, "메모만 저장"); assert.deepEqual(saved.tasks, latest.tasks); assert.deepEqual(saved.workingOn, latest.workingOn);
  const acknowledged = acknowledgeDashboardSave(draft, saved);
  assert.equal(acknowledged.pendingMemo, false); assert.equal(acknowledged.pendingTasks.length, 1);
  assert.deepEqual(acknowledged.value.tasks, [...latest.tasks, task.task]);
});
test("Each To-do operation preserves the unsaved memo and all unrelated remote fields", () => {
  const original = fixture(), operation = add("첫 번째 할 일"), draft = newDashboardDraft(original);
  draft.value.memo = "아직 저장하지 않은 메모"; draft.pendingTasks.push(operation); draft.value.tasks.push(operation.task);
  const saved = applyTaskOperation(original, operation), acknowledged = acknowledgeDashboardSave(draft, saved, operation.id);
  assert.equal(saved.memo, original.memo); assert.equal(acknowledged.value.memo, "아직 저장하지 않은 메모");
  assert.equal(acknowledged.base.memo, original.memo); assert.equal(acknowledged.pendingTasks.length, 0);
  assert.deepEqual(saved.shortcuts, original.shortcuts); assert.deepEqual(saved.workingOn, original.workingOn);
});
test("Rapid To-do operations remain separate and resume in order after draft serialization", () => {
  const original = fixture(), first = add("첫 번째"), second = add("두 번째"), completed = { id: crypto.randomUUID(), kind: "set", taskId: first.task.id, done: true }, removed = { id: crypto.randomUUID(), kind: "delete", taskId: second.task.id };
  let draft = newDashboardDraft(original), remote = original;
  draft.pendingTasks = [first, second, completed, removed];
  for (const operation of draft.pendingTasks) remote = applyTaskOperation(remote, operation);
  draft.value.tasks = remote.tasks; draft = validateDashboardDraft(JSON.parse(JSON.stringify(draft)));
  remote = original;
  for (const operation of [first, second, completed, removed]) { remote = applyTaskOperation(remote, operation); draft = acknowledgeDashboardSave(draft, remote, operation.id); }
  assert.deepEqual(remote.tasks, [{ ...first.task, done: true }]); assert.equal(draft.pendingTasks.length, 0); assert.deepEqual(draft.value.tasks, remote.tasks);
});
test("Retrying an already committed To-do operation never duplicates or resurrects tasks", () => {
  const original = fixture(), operation = add("한 번만 추가");
  const once = applyTaskOperation(original, operation), twice = applyTaskOperation(once, operation);
  assert.deepEqual(once, twice);
  const deleted = applyTaskOperation(twice, { id: crypto.randomUUID(), kind: "delete", taskId: operation.task.id });
  assert.deepEqual(applyTaskOperation(deleted, { id: crypto.randomUUID(), kind: "set", taskId: operation.task.id, done: true }).tasks, []);
});
test("Pending actions survive F5 while newer remote tasks are merged into the visible draft", () => {
  const original = fixture(), draft = newDashboardDraft(original), pending = add("내 대기 작업"), remoteTask = add("다른 기기의 작업").task;
  draft.pendingTasks = [pending]; draft.value.tasks = [pending.task]; draft.value.memo = "내 메모 초안"; draft.pendingMemo = true;
  const restored = reconcileDashboardDraft(JSON.parse(JSON.stringify(draft)), { ...original, tasks: [remoteTask], updatedAt: "2026-10-26T10:00:00Z" });
  assert.equal(restored.pendingMemo, true); assert.equal(restored.value.memo, "내 메모 초안"); assert.deepEqual(restored.value.tasks, [remoteTask, pending.task]);
});
test("Legacy browser drafts are preserved without starting automatic writes on load", () => {
  const original = fixture(), task = add("이전 초안").task;
  const legacy = { ...newDashboardDraft(original), version: 1, value: { memo: "이전 메모", tasks: [task] } }; delete legacy.pendingTasks; delete legacy.pendingMemo;
  const restored = validateDashboardDraft(legacy);
  assert.equal(restored.version, 2); assert.equal(restored.pendingMemo, false); assert.deepEqual(restored.pendingTasks, []);
  assert.equal(legacyTaskOperations(restored)[0].task.id, task.id);
});
test("Admin Working on edits merge with concurrent automatic To-do saves", () => {
  const original = fixture(), edited = structuredClone(original), remote = { ...original, tasks: [add("Dashboard에서 추가").task] };
  edited.workingOn = edited.workingOn.slice().reverse(); edited.workingOn[0].description = "관리자에서 편집";
  const merged = mergeDashboardSettings(original, edited, remote);
  assert.deepEqual(merged.tasks, remote.tasks); assert.deepEqual(merged.workingOn, edited.workingOn);
  assert.throws(() => mergeDashboardSettings(original, { ...original, memo: "내 편집" }, { ...remote, memo: "다른 기기 편집" }));
});
