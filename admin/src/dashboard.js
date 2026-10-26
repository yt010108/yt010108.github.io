import { esc } from "../../shared/posts.js";
import { validateDashboard, shortcutURL, faviconURL as siteFaviconURL, dashboardText } from "../../shared/dashboard.js";

export function createDashboardManager({ repository, onBusy }) {
  const $ = id => document.getElementById(id);
  const faviconURL = url => { try { return siteFaviconURL(url); } catch { return new URL("../assets/favicon.svg", location.href).href; } };
  let value = null, saved = null, sha = null, busy = false, externalBusy = true, deploymentTimer;
  const clone = data => structuredClone(data);
  const fields = data => data ? JSON.stringify([data.memo, data.tasks, data.shortcuts]) : "";
  const dirty = () => fields(value) !== fields(saved);
  const allowed = () => repository.connected && value && !busy && !externalBusy;
  function status(text, error = false) { $("dashboard-admin-status").textContent = text; $("dashboard-admin-status").dataset.error = String(error); $("dashboard-admin-status").setAttribute("role", error ? "alert" : "status"); }
  function setBusy(next) {
    externalBusy = next;
    $("dashboard-admin-fields").disabled = !allowed();
    $("dashboard-admin-save").disabled = !allowed() || !dirty();
    $("dashboard-admin-refresh").disabled = busy || externalBusy || !repository.connected;
  }
  function changed() { status(dirty() ? "저장하지 않은 변경이 있어요." : "저장된 내용과 같아요."); setBusy(externalBusy); }
  function renderRows() {
    $("dashboard-admin-tasks").innerHTML = (value?.tasks || []).map((item, index) => '<li class="dashboard-admin-task"><input type="checkbox" data-dashboard-task-done="' + item.id + '" aria-label="할 일 ' + (index + 1) + ' 완료" ' + (item.done ? "checked" : "") + '><input type="text" data-dashboard-task-text="' + item.id + '" aria-label="할 일 ' + (index + 1) + ' 내용" maxlength="200" value="' + esc(item.text) + '"><button type="button" class="writer-text-button" data-dashboard-task-delete="' + item.id + '" aria-label="할 일 ' + (index + 1) + ' 삭제">삭제</button></li>').join("") || '<li class="dashboard-admin-empty">등록한 할 일이 없어요.</li>';
    $("dashboard-admin-shortcuts").innerHTML = (value?.shortcuts || []).map((item, index, all) => '<li class="dashboard-admin-shortcut"><span class="dashboard-admin-favicon" data-dashboard-icon-fallback="' + esc(item.title.slice(0, 1)) + '"><img src="' + esc(faviconURL(item.url)) + '" width="25" height="25" alt="" referrerpolicy="no-referrer"></span><div class="dashboard-admin-shortcut-inputs"><label>이름<input type="text" data-dashboard-shortcut-title="' + item.id + '" aria-label="바로가기 ' + (index + 1) + ' 이름" maxlength="40" value="' + esc(item.title) + '"></label><label>주소<input type="url" data-dashboard-shortcut-url="' + item.id + '" aria-label="바로가기 ' + (index + 1) + ' 주소" maxlength="1500" value="' + esc(item.url) + '"></label></div><div class="dashboard-admin-row-actions"><button type="button" class="writer-text-button" data-dashboard-shortcut-up="' + item.id + '" aria-label="바로가기 ' + (index + 1) + ' 위로" ' + (index === 0 ? "disabled" : "") + '>위로</button><button type="button" class="writer-text-button" data-dashboard-shortcut-down="' + item.id + '" aria-label="바로가기 ' + (index + 1) + ' 아래로" ' + (index === all.length - 1 ? "disabled" : "") + '>아래로</button><button type="button" class="writer-text-button" data-dashboard-shortcut-delete="' + item.id + '" aria-label="바로가기 ' + (index + 1) + ' 삭제">삭제</button></div></li>').join("") || '<li class="dashboard-admin-empty">등록한 바로가기가 없어요.</li>';
    setBusy(externalBusy);
  }
  function render() { $("dashboard-admin-memo").value = value?.memo || ""; renderRows(); }
  async function refresh({ discard = false } = {}) {
    if (busy || !repository.connected) return;
    if (discard && dirty() && !confirm("저장하지 않은 대시보드 입력을 버리고 최신 저장본을 불러올까요?")) return;
    const generation = repository.generation;
    busy = true; onBusy(true); status("GitHub의 대시보드를 불러오는 중…");
    try {
      const latest = await repository.readDashboard();
      if (!repository.connected || generation !== repository.generation) return;
      if (dirty() && !discard) {
        status(latest.sha === sha ? "저장하지 않은 입력을 유지했어요." : "다른 기기에서 저장본이 바뀌었어요. 현재 입력을 복사한 뒤 다시 불러와 주세요.", latest.sha !== sha);
      } else { value = latest.config; saved = clone(latest.config); sha = latest.sha; render(); status("대시보드 내용을 편집할 수 있어요."); }
    } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  async function watchDeployment(attempt = 0) {
    clearTimeout(deploymentTimer);
    if (!saved || !repository.connected) return;
    try {
      const url = new URL("../dashboard.json", location.href); url.searchParams.set("check", String(Date.now()));
      const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
      if (response.ok && dashboardText(validateDashboard(await response.json())) === dashboardText(saved)) { if (!dirty()) status("저장한 내용이 공개 Dashboard에 반영됐어요."); return; }
    } catch {}
    if (attempt < 45) deploymentTimer = setTimeout(() => watchDeployment(attempt + 1), 4000);
  }
  async function save() {
    if (!allowed() || !dirty()) return;
    const generation = repository.generation;
    busy = true; onBusy(true); status("GitHub에 저장하는 중…");
    try {
      const result = await repository.saveDashboard(value, sha);
      if (!repository.connected || generation !== repository.generation) return;
      value = result.config; saved = clone(result.config); sha = result.sha; render();
      status("GitHub에 저장했어요. 배포가 끝나면 공개 Dashboard에 반영돼요."); watchDeployment();
    } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  $("dashboard-admin-memo").addEventListener("input", event => { if (allowed()) { value.memo = event.target.value; changed(); } });
  $("dashboard-admin-fields").addEventListener("input", event => {
    if (!allowed()) return;
    const data = event.target.dataset;
    if (data.dashboardTaskText) value.tasks.find(item => item.id === data.dashboardTaskText).text = event.target.value;
    else if (data.dashboardShortcutTitle) value.shortcuts.find(item => item.id === data.dashboardShortcutTitle).title = event.target.value;
    else if (data.dashboardShortcutUrl) value.shortcuts.find(item => item.id === data.dashboardShortcutUrl).url = event.target.value;
    else return;
    changed();
  });
  $("dashboard-admin-fields").addEventListener("change", event => {
    if (!allowed() || !event.target.dataset.dashboardTaskDone) return;
    value.tasks.find(item => item.id === event.target.dataset.dashboardTaskDone).done = event.target.checked; changed();
  });
  $("dashboard-admin-fields").addEventListener("click", event => {
    if (!allowed()) return;
    const button = event.target.closest("button"); if (!button) return;
    const data = button.dataset;
    if (data.dashboardTaskDelete) value.tasks = value.tasks.filter(item => item.id !== data.dashboardTaskDelete);
    else if (data.dashboardShortcutDelete) value.shortcuts = value.shortcuts.filter(item => item.id !== data.dashboardShortcutDelete);
    else if (data.dashboardShortcutUp || data.dashboardShortcutDown) {
      const index = value.shortcuts.findIndex(item => item.id === (data.dashboardShortcutUp || data.dashboardShortcutDown)), next = index + (data.dashboardShortcutUp ? -1 : 1);
      if (index < 0 || next < 0 || next >= value.shortcuts.length) return;
      [value.shortcuts[index], value.shortcuts[next]] = [value.shortcuts[next], value.shortcuts[index]];
    } else return;
    changed(); renderRows();
  });
  $("dashboard-admin-task-add").addEventListener("submit", event => {
    event.preventDefault(); if (!allowed()) return;
    const input = $("dashboard-admin-task-new"), text = input.value.trim(); if (!text) return;
    if (value.tasks.length >= 100) { status("할 일은 100개까지 저장할 수 있어요.", true); return; }
    value.tasks.push({ id: crypto.randomUUID(), text, done: false }); input.value = ""; changed(); renderRows(); input.focus();
  });
  $("dashboard-admin-shortcut-add").addEventListener("submit", event => {
    event.preventDefault(); if (!allowed()) return;
    if (value.shortcuts.length >= 24) { status("바로가기는 24개까지 저장할 수 있어요.", true); return; }
    try {
      const title = $("dashboard-admin-shortcut-new-title").value.trim(), url = shortcutURL($("dashboard-admin-shortcut-new-url").value);
      value = validateDashboard({ ...value, shortcuts: [...value.shortcuts, { id: crypto.randomUUID(), title, url }] });
      event.target.reset(); changed(); renderRows();
    } catch (error) { status(error.message, true); }
  });
  $("dashboard-admin-fields").addEventListener("error", event => { if (event.target instanceof HTMLImageElement && event.target.parentElement?.hasAttribute("data-dashboard-icon-fallback")) event.target.parentElement.textContent = event.target.parentElement.dataset.dashboardIconFallback; }, true);
  $("dashboard-admin-save").addEventListener("click", save);
  $("dashboard-admin-refresh").addEventListener("click", () => refresh({ discard: true }));
  return {
    refresh, save, setBusy, isDirty: dirty, isBusy: () => busy,
    discard() { value = saved ? clone(saved) : null; render(); },
    clear() { clearTimeout(deploymentTimer); if (!dirty()) { value = null; saved = null; sha = null; render(); } setBusy(true); }
  };
}
