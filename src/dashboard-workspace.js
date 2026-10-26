import { createIcons, Plus, X, Save, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight } from "lucide";
import { esc } from "../shared/posts.js";
import { DASHBOARD_DRAFT_KEY, validateDashboardDraft, draftIsDirty, reconcileDashboardDraft, mergeDashboardMemo, applyTaskOperation, replayTasks, legacyTaskOperations, acknowledgeDashboardSave, validateTaskOperation } from "../shared/dashboard-draft.js";
import { DashboardRepository } from "./dashboard-repository.js";
import { REMEMBER_KEY } from "../admin/src/github.js";

export function createDashboardWorkspace({ root, signal, siteBase, onSaved }) {
  const repository = new DashboardRepository(), $ = selector => root.querySelector(selector);
  const icons = () => createIcons({ icons: { Plus, X, Save, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight }, attrs: { width: 16, height: 16, "stroke-width": 1.5 } });
  let draft, processing = false, processingMemo = false, redirecting = false, destroyed = false, storageConflict = false, storageWarning = "", lastRaw = null;
  let store = null;
  try { localStorage.getItem(DASHBOARD_DRAFT_KEY); store = localStorage; } catch { try { sessionStorage.getItem(DASHBOARD_DRAFT_KEY); store = sessionStorage; } catch {} }
  const memoDirty = () => Boolean(draft && draft.base.memo !== draft.value.memo);
  function status(field, text, error = false) {
    if (destroyed) return;
    const node = $(field === "memo" ? "[data-memo-status]" : "[data-task-status]");
    node.textContent = text; node.hidden = !text; node.dataset.error = String(error); node.setAttribute("role", error ? "alert" : "status");
  }
  function controls() {
    if (destroyed) return;
    const blocked = !draft || storageConflict || redirecting, full = (draft?.pendingTasks.length || 0) >= 300;
    $("[data-workspace-fields]").disabled = blocked;
    $("[data-dashboard-memo]").disabled = blocked || processingMemo;
    $("[data-memo-save]").disabled = blocked || processingMemo || !(memoDirty() || draft?.pendingMemo);
    $("[data-memo-save]").setAttribute("aria-busy", String(processingMemo));
    $("[data-workspace-task-new]").disabled = blocked || full || draft.value.tasks.length >= 100;
    $("[data-workspace-task-add]").disabled = blocked || full || draft.value.tasks.length >= 100;
    root.querySelectorAll("[data-workspace-task-done],[data-workspace-task-delete]").forEach(node => { node.disabled = blocked || full; });
  }
  function persist() {
    if (storageConflict) return false;
    try {
      if (!store) throw new Error("Storage unavailable");
      if (store.getItem(DASHBOARD_DRAFT_KEY) !== lastRaw) {
        storageConflict = true;
        for (const field of ["memo", "tasks"]) status(field, "다른 탭에서 초안이 바뀌었어요. 현재 입력을 복사해 둔 뒤 F5로 새로고침해 주세요.", true);
        controls(); return false;
      }
      const raw = JSON.stringify(validateDashboardDraft(draft)); store.setItem(DASHBOARD_DRAFT_KEY, raw); lastRaw = raw; storageWarning = "";
    } catch { storageWarning = "브라우저에 초안을 보관하지 못했어요. 화면을 닫기 전에 저장해 주세요."; }
    return true;
  }
  function resizeMemo() {
    if (destroyed || !root.isConnected) return;
    const node = $("[data-dashboard-memo]"); node.style.height = "auto"; node.style.height = node.scrollHeight + 2 + "px";
  }
  function renderTasks() {
    if (destroyed) return;
    const tasks = draft?.value.tasks || [];
    $("[data-dashboard-tasks]").innerHTML = tasks.length ? tasks.map((task, index) => '<div class="dashboard-task"><label><input type="checkbox" data-workspace-task-done="' + task.id + '" ' + (task.done ? "checked" : "") + '><span>' + esc(task.text) + '</span></label><button class="dashboard-task-delete" type="button" data-workspace-task-delete="' + task.id + '" aria-label="할 일 ' + (index + 1) + ' 삭제"><i data-lucide="x" aria-hidden="true"></i></button></div>').join("") : '<p class="dashboard-empty">등록한 할 일이 없어요.</p>';
    $("[data-dashboard-task-count]").textContent = tasks.filter(task => task.done).length + "/" + tasks.length; icons(); controls();
  }
  function render() { if (destroyed) return; $("[data-dashboard-memo]").value = draft?.value.memo || ""; resizeMemo(); renderTasks(); }
  function toAdmin(field) {
    if (!persist() || storageConflict) return false;
    if (storageWarning) {
      status(field, "초안을 보관하지 못했어요. 내용을 복사한 뒤 관리자에서 연결해 주세요.", true);
      if (!destroyed) { const link = document.createElement("a"); link.href = new URL("admin/#dashboard", siteBase).href; link.textContent = " 관리자 열기 ↗"; $(field === "memo" ? "[data-memo-status]" : "[data-task-status]").append(link); }
      return false;
    }
    redirecting = true; controls(); status(field, "관리자 로그인으로 이동하는 중…");
    location.assign(new URL("admin/?from=dashboard#dashboard", siteBase)); return false;
  }
  async function connect(field) {
    if (repository.connected) return true;
    if (!repository.hasSavedConnection) return toAdmin(field);
    try { return await repository.restore(); }
    catch (error) { if (error.authInvalid || [401, 403, 404].includes(error.status)) { repository.disconnect(); return toAdmin(field); } throw error; }
  }
  async function process() {
    if (processing || !draft || storageConflict || destroyed || redirecting || !(draft.pendingMemo || draft.pendingTasks.length)) return;
    processing = true;
    let field = draft.pendingMemo ? "memo" : "tasks";
    try {
      if (!await connect(field)) return;
      while (!destroyed && !storageConflict && !redirecting && (draft.pendingMemo || draft.pendingTasks.length)) {
        field = draft.pendingMemo ? "memo" : "tasks";
        processingMemo = field === "memo"; controls(); status(field, "저장 중…");
        const snapshot = validateDashboardDraft(draft), operation = field === "tasks" ? snapshot.pendingTasks[0] : null;
        const result = await repository.mutateDashboard(latest => operation ? applyTaskOperation(latest, operation) : mergeDashboardMemo(snapshot, latest));
        if (destroyed) return;
        draft = acknowledgeDashboardSave(draft, result.config, operation?.id || null);
        persist(); render(); onSaved(result.config);
        if (storageConflict) break;
        status(field, storageWarning || (field === "tasks" && draft.pendingTasks.length ? "저장 중…" : "저장됨"), Boolean(storageWarning));
        processingMemo = false;
      }
    } catch (error) {
      if ([401, 403, 404].includes(error.status) || error.authInvalid) { repository.disconnect(); toAdmin(field); }
      else status(field, error.message + " 입력은 유지했어요. F5로 새로고침하면 대기 중인 저장을 다시 시도해요.", true);
    } finally { processing = false; processingMemo = false; controls(); }
  }
  function queueTask(operation) {
    if (!draft || storageConflict || redirecting) return;
    try {
      const previous = draft.pendingTasks.length ? draft.pendingTasks : legacyTaskOperations(draft), checked = validateTaskOperation(operation);
      if (previous.length >= 300) throw new Error("저장 대기 중인 할 일이 많아요. 저장을 마친 뒤 다시 시도해 주세요.");
      const pending = [...previous, checked], tasks = replayTasks(draft.base.tasks, pending);
      draft.pendingTasks = pending; draft.value.tasks = tasks;
      if (!persist()) return;
      renderTasks(); status("tasks", "저장 대기 중…"); process();
    } catch (error) { status("tasks", error.message, true); }
  }
  $("[data-dashboard-memo]").addEventListener("input", event => {
    if (!draft || processingMemo || storageConflict) return;
    draft.value.memo = event.target.value; draft.pendingMemo = false; resizeMemo(); persist();
    status("memo", storageWarning || (memoDirty() ? "저장하지 않은 변경이 있어요." : ""), Boolean(storageWarning)); controls();
  }, { signal });
  $("[data-memo-save]").addEventListener("click", () => {
    if (!draft || processingMemo || storageConflict || !(memoDirty() || draft.pendingMemo)) return;
    draft.pendingMemo = true; if (!persist()) return;
    status("memo", "저장 대기 중…"); controls(); process();
  }, { signal });
  $("[data-workspace-task-form]").addEventListener("submit", event => {
    event.preventDefault(); if (!draft || draft.value.tasks.length >= 100) return;
    const input = $("[data-workspace-task-new]"), text = input.value.trim(); if (!text) return;
    queueTask({ id: crypto.randomUUID(), kind: "add", task: { id: crypto.randomUUID(), text, done: false } }); input.value = "";
    if (!redirecting) input.focus();
  }, { signal });
  root.addEventListener("change", event => {
    const id = event.target.dataset?.workspaceTaskDone; if (id) queueTask({ id: crypto.randomUUID(), kind: "set", taskId: id, done: event.target.checked });
  }, { signal });
  root.addEventListener("click", event => {
    const button = event.target.closest?.("[data-workspace-task-delete]"); if (button) queueTask({ id: crypto.randomUUID(), kind: "delete", taskId: button.dataset.workspaceTaskDelete });
  }, { signal });
  window.addEventListener("resize", resizeMemo, { signal });
  repository.addEventListener("change", controls, { signal });
  window.addEventListener("storage", event => {
    if (event.key === REMEMBER_KEY || event.key === null) repository.disconnect({ forget: false });
    if ((event.key === DASHBOARD_DRAFT_KEY || event.key === null) && event.newValue !== lastRaw) {
      if (draft && draftIsDirty(draft)) {
        storageConflict = true; for (const field of ["memo", "tasks"]) status(field, "다른 탭에서 초안이 바뀌었어요. 입력을 복사해 둔 뒤 F5로 새로고침해 주세요.", true);
      } else {
        try { lastRaw = event.newValue; if (lastRaw) { draft = validateDashboardDraft(JSON.parse(lastRaw)); render(); } }
        catch { status("memo", "다른 탭의 초안을 읽지 못했어요. 현재 입력을 유지했어요.", true); }
      }
      controls();
    }
  }, { signal });
  window.addEventListener("beforeunload", event => { if (!redirecting && draft && draftIsDirty(draft) && (storageWarning || storageConflict)) { event.preventDefault(); event.returnValue = ""; } }, { signal });
  signal.addEventListener("abort", () => { destroyed = true; repository.disconnect({ forget: false }); }, { once: true });
  controls();
  return {
    load(config) {
      if (draft) { if (!processing) { draft = reconcileDashboardDraft(draft, config); render(); } return; }
      let restored;
      try { lastRaw = store?.getItem(DASHBOARD_DRAFT_KEY) || null; if (lastRaw && lastRaw.length < 300000) restored = validateDashboardDraft(JSON.parse(lastRaw)); }
      catch { storageWarning = "브라우저 초안을 불러오지 못했어요. 저장본을 표시하고 있어요."; }
      draft = reconcileDashboardDraft(restored, config); render();
      status("memo", storageWarning || (memoDirty() ? "저장하지 않은 변경이 있어요." : ""), Boolean(storageWarning));
      if (draft.pendingTasks.length) status("tasks", "저장 대기 중…");
      if (draft.pendingMemo || draft.pendingTasks.length) queueMicrotask(process);
    }
  };
}
