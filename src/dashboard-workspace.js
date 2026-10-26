import { createIcons, Plus, X, Save, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight } from "lucide";
import { esc } from "../shared/posts.js";
import { dashboardText } from "../shared/dashboard.js";
import { DASHBOARD_DRAFT_KEY, newDashboardDraft, validateDashboardDraft, draftIsDirty, reconcileDashboardDraft, mergeDashboardDraft } from "../shared/dashboard-draft.js";
import { DashboardRepository } from "./dashboard-repository.js";
import { REMEMBER_KEY } from "../admin/src/github.js";

export function createDashboardWorkspace({ root, signal, readPublic, onSaved }) {
  const repository = new DashboardRepository(), $ = selector => root.querySelector(selector);
  const icons = () => createIcons({ icons: { Plus, X, Save, Search, NotebookPen, GitBranch, ListTodo, ArrowUpRight }, attrs: { width: 16, height: 16, "stroke-width": 1.5 } });
  let draft, busy = false, saveAfterConnect = false, lastRaw = null, storageWarning = "", storageConflict = false, destroyed = false;
  const dirty = () => Boolean(draft && draftIsDirty(draft));
  const status = (message, error = false) => { if (destroyed) return; const node = $("[data-workspace-status]"); node.textContent = message; node.dataset.error = String(error); node.setAttribute("role", error ? "alert" : "status"); };
  function controls() {
    if (destroyed) return;
    $("[data-workspace-fields]").disabled = !draft || busy;
    $("[data-workspace-save]").disabled = !draft || busy || !dirty() || storageConflict;
    $("[data-workspace-refresh]").disabled = !draft || busy;
    $("[data-workspace-connect]").disabled = busy;
    $("[data-workspace-connect]").textContent = repository.connected ? "GitHub 연결 해제" : "GitHub 연결";
    $("[data-workspace-submit]").disabled = busy;
    $("[data-workspace-token]").disabled = busy;
    $("[data-workspace-remember]").disabled = busy;
    $("[data-workspace-task-new]").disabled = !draft || busy || draft.value.tasks.length >= 100;
    $("[data-workspace-task-add]").disabled = !draft || busy || draft.value.tasks.length >= 100;
  }
  function persist() {
    if (storageConflict) return;
    try {
      if (localStorage.getItem(DASHBOARD_DRAFT_KEY) !== lastRaw) {
        storageConflict = true;
        status("다른 탭에서 초안이 바뀌었어요. 현재 입력은 화면에 유지했어요. 내용을 복사해 둔 뒤 다시 불러와 주세요.", true);
        return;
      }
      const raw = JSON.stringify(validateDashboardDraft(draft));
      localStorage.setItem(DASHBOARD_DRAFT_KEY, raw); lastRaw = raw; storageWarning = "";
    } catch { storageWarning = "브라우저에 초안을 보관하지 못했어요. 탭을 닫기 전에 GitHub에 저장해 주세요."; }
  }
  function changed() {
    persist();
    if (!storageConflict) status(storageWarning || (dirty() ? "브라우저 초안 · GitHub에 저장하지 않은 변경이 있어요." : "GitHub 저장본과 같아요."), Boolean(storageWarning));
    controls();
  }
  function renderTasks() {
    if (destroyed) return;
    const tasks = draft?.value.tasks || [];
    $("[data-dashboard-tasks]").innerHTML = tasks.length ? tasks.map((task, index) => '<div class="dashboard-task"><label><input type="checkbox" data-workspace-task-done="' + task.id + '" ' + (task.done ? "checked" : "") + '><span>' + esc(task.text) + '</span></label><button class="dashboard-task-delete" type="button" data-workspace-task-delete="' + task.id + '" aria-label="할 일 ' + (index + 1) + ' 삭제"><i data-lucide="x" aria-hidden="true"></i></button></div>').join("") : '<p class="dashboard-empty">등록한 할 일이 없어요.</p>';
    $("[data-dashboard-task-count]").textContent = tasks.filter(task => task.done).length + "/" + tasks.length; icons(); controls();
  }
  function resizeMemo() {
    if (destroyed || !root.isConnected) return;
    const node = $("[data-dashboard-memo]"); node.style.height = "auto"; node.style.height = node.scrollHeight + 2 + "px";
  }
  function render() { if (destroyed) return; $("[data-dashboard-memo]").value = draft?.value.memo || ""; resizeMemo(); renderTasks(); }
  function openConnection(saving = false) {
    saveAfterConnect = saving;
    $("[data-workspace-auth-error]").textContent = "";
    $("[data-workspace-token]").value = "";
    $("[data-workspace-remember]").checked = false;
    $("[data-workspace-dialog]").showModal();
    $("[data-workspace-token]").focus();
  }
  async function save() {
    if (!draft || !dirty() || busy || storageConflict) return;
    busy = true; controls(); status("GitHub 연결과 최신 저장본을 확인하는 중…");
    try {
      if (!repository.connected) {
        if (!repository.hasSavedConnection) { busy = false; controls(); openConnection(true); return; }
        await repository.restore();
      }
      const latest = await repository.readDashboard(), merged = mergeDashboardDraft(draft, latest.config);
      const result = dashboardText(merged) === dashboardText(latest.config) ? latest : await repository.saveDashboard(merged, latest.sha);
      draft = newDashboardDraft(result.config); persist(); render(); onSaved(result.config);
      status("GitHub에 저장했어요. 배포가 끝나면 다른 기기에서도 볼 수 있어요." + (storageWarning ? " " + storageWarning : ""), Boolean(storageWarning));
    } catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
  }
  async function reload() {
    if (busy || (dirty() || storageConflict) && !confirm("브라우저의 메모·할 일 초안을 버리고 최신 저장본을 불러올까요?")) return;
    busy = true; controls(); status("저장본을 불러오는 중…");
    try {
      const config = repository.connected ? (await repository.readDashboard()).config : await readPublic();
      draft = newDashboardDraft(config); storageConflict = false;
      try { lastRaw = localStorage.getItem(DASHBOARD_DRAFT_KEY); } catch {}
      persist(); render(); onSaved(config); status(storageWarning || "저장본을 다시 불러왔어요.", Boolean(storageWarning));
    } catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
  }
  $("[data-workspace-task-form]").addEventListener("submit", event => {
    event.preventDefault(); if (!draft || busy || draft.value.tasks.length >= 100) return;
    const input = $("[data-workspace-task-new]"), text = input.value.trim(); if (!text) return;
    draft.value.tasks.push({ id: crypto.randomUUID(), text, done: false }); input.value = ""; changed(); renderTasks(); input.focus();
  }, { signal });
  $("[data-dashboard-memo]").addEventListener("input", event => { if (draft && !busy) { draft.value.memo = event.target.value; resizeMemo(); changed(); } }, { signal });
  window.addEventListener("resize", resizeMemo, { signal });
  root.addEventListener("change", event => {
    const id = event.target.dataset?.workspaceTaskDone; if (!id || !draft || busy) return;
    const task = draft.value.tasks.find(item => item.id === id); if (task) { task.done = event.target.checked; changed(); $("[data-dashboard-task-count]").textContent = draft.value.tasks.filter(task => task.done).length + "/" + draft.value.tasks.length; }
  }, { signal });
  root.addEventListener("click", event => {
    const button = event.target.closest?.("[data-workspace-task-delete]"); if (!button || !draft || busy) return;
    draft.value.tasks = draft.value.tasks.filter(task => task.id !== button.dataset.workspaceTaskDelete); changed(); renderTasks();
  }, { signal });
  $("[data-workspace-save]").addEventListener("click", save, { signal });
  $("[data-workspace-refresh]").addEventListener("click", reload, { signal });
  $("[data-workspace-connect]").addEventListener("click", () => {
    if (busy) return;
    if (repository.connected) { repository.disconnect(); status("GitHub 연결을 해제했어요. 브라우저 초안은 유지돼요."); }
    else openConnection();
  }, { signal });
  $("[data-workspace-auth]").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    const token = $("[data-workspace-token]").value, remember = $("[data-workspace-remember]").checked;
    $("[data-workspace-token]").value = ""; busy = true; controls(); $("[data-workspace-auth-error]").textContent = "GitHub 계정과 저장소 권한을 확인하는 중…";
    try {
      await repository.connect(token, { remember });
      const saving = saveAfterConnect; saveAfterConnect = false;
      $("[data-workspace-dialog]").close(); busy = false;
      status(repository.storageWarning || "GitHub에 연결했어요. 저장 버튼으로 현재 초안을 반영할 수 있어요.", Boolean(repository.storageWarning));
      if (saving) await save();
    } catch (error) { $("[data-workspace-auth-error]").textContent = error.message; }
    finally { busy = false; controls(); }
  }, { signal });
  $("[data-workspace-auth-cancel]").addEventListener("click", () => { if (!busy) $("[data-workspace-dialog]").close(); }, { signal });
  $("[data-workspace-dialog]").addEventListener("cancel", event => { if (busy) event.preventDefault(); }, { signal });
  $("[data-workspace-dialog]").addEventListener("close", () => { $("[data-workspace-token]").value = ""; saveAfterConnect = false; }, { signal });
  repository.addEventListener("change", controls, { signal });
  window.addEventListener("storage", event => {
    if (event.key === REMEMBER_KEY || event.key === null) { repository.disconnect({ forget: false }); }
    if ((event.key === DASHBOARD_DRAFT_KEY || event.key === null) && event.newValue !== lastRaw) {
      if (dirty()) { storageConflict = true; status("다른 탭에서 초안이 바뀌었어요. 현재 입력은 화면에 유지했어요. 내용을 복사해 둔 뒤 다시 불러와 주세요.", true); }
      else { try { lastRaw = event.newValue; if (lastRaw) { draft = validateDashboardDraft(JSON.parse(lastRaw)); render(); status("다른 탭의 브라우저 초안을 불러왔어요."); } } catch { status("다른 탭의 초안을 읽지 못했어요. 현재 입력을 유지했어요.", true); } }
      controls();
    }
  }, { signal });
  window.addEventListener("beforeunload", event => { if (busy || dirty() && (storageWarning || storageConflict)) { event.preventDefault(); event.returnValue = ""; } }, { signal });
  signal.addEventListener("abort", () => { $("[data-workspace-dialog]").close(); destroyed = true; }, { once: true });
  controls();
  return {
    load(config) {
      if (draft) { if (!dirty() && !busy) { draft = reconcileDashboardDraft(draft, config); render(); } return; }
      let restored;
      try { lastRaw = localStorage.getItem(DASHBOARD_DRAFT_KEY); if (lastRaw && lastRaw.length < 200000) restored = validateDashboardDraft(JSON.parse(lastRaw)); }
      catch { storageWarning = "브라우저 초안을 불러오지 못했어요. GitHub 저장본을 표시하고 있어요."; }
      draft = reconcileDashboardDraft(restored, config); render();
      status(storageWarning || (dirty() ? "브라우저 초안을 복원했어요. GitHub에 저장하지 않은 변경이 있어요." : "입력은 브라우저에 초안으로 남고, 저장 버튼을 누르면 GitHub에 반영돼요."), Boolean(storageWarning));
    }
  };
}
