import { listDrafts, readDraft, writeDraft, trashDrafts } from "./draft-store.js";
import { newEntry } from "./document.js";
import { publicLink } from "./github.js";
import { esc } from "../../shared/posts.js";

const $ = id => document.getElementById(id);
const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ko-KR");
const DEPLOY_KEY = "yt010108-cms-deployment";
const stateLabel = { draft: "임시글", modified: "수정 중", published: "발행됨", trash: "휴지통" };
export function createManager({ repository, edit, newDraft, report, onBusy = () => {}, onStatusChange = () => {}, onIndexChange = () => {} }) {
  let local = [], remote = [], rows = [], selected = new Set(), status = "all", page = 1, busy = false;
  let lastDeployment, deployTimer, polls = 0, refreshVersion = 0;
  function withBusy(callback) {
    return async (...args) => {
      if (busy || !repository.connected) return;
      busy = true; onBusy(true); renderSelection();
      try { return await callback(...args); }
      catch (error) { report(error.message || "작업을 완료하지 못했어요.", true); }
      finally { busy = false; onBusy(false); render(); }
    };
  }
  function combined() {
    const map = new Map(remote.map(item => [item.id, { id: item.id, remote: item }]));
    local.forEach(item => { const row = map.get(item.id) || { id: item.id }; row.local = item; map.set(item.id, row); });
    return [...map.values()].map(row => {
      const item = row.local || row.remote;
      const published = Boolean(row.remote || row.local?.publication);
      const trashed = row.remote?.status === "trash" || row.local?.trashedAt;
      const modified = row.local && (!row.local.publication || row.local.publication.sourceDigest !== row.local.sourceDigest);
      const stale = Boolean(row.remote && row.local && row.remote.sha !== row.local.publication?.sha);
      return { ...row, item, published, stale, state: trashed ? "trash" : published ? modified || stale ? "modified" : "published" : "draft" };
    }).sort((a, b) => (b.item.updatedAt || "").localeCompare(a.item.updatedAt || ""));
  }
  function matches(row, filter) {
    return filter === "all" ? row.state !== "trash" : filter === "draft" ? ["draft", "modified"].includes(row.state) : filter === "published" ? row.published && row.state !== "trash" : row.state === "trash";
  }
  function visible() {
    const query = normalize($("manager-search").value), kind = $("manager-kind").value, category = $("manager-category").value;
    return rows.filter(row => matches(row, status) && (!kind || row.item.kind === kind) && (!category || row.item.category === category)
      && (!query || normalize([row.item.title, row.item.category, ...(row.item.tags || [])].join(" ")).includes(query)));
  }
  function canChange(row) { return !row.published || Boolean(row.remote && repository.connected); }
  function renderSelection() {
    const chosen = rows.filter(row => selected.has(row.id));
    $("manager-selection-count").textContent = selected.size + "개 선택";
    $("manager-bulk-trash").hidden = status === "trash";
    $("manager-bulk-restore").hidden = status !== "trash";
    ["manager-bulk-trash", "manager-bulk-restore"].forEach(id => { $(id).disabled = busy || !chosen.length || chosen.some(row => !canChange(row)); });
    const shown = visible().slice((page - 1) * 20, page * 20);
    $("manager-select-all").checked = Boolean(shown.length && shown.every(row => selected.has(row.id)));
    $("manager-select-all").indeterminate = shown.some(row => selected.has(row.id)) && !$("manager-select-all").checked;
    $("manager-select-all").disabled = busy || !shown.length;
  }
  function render() {
    if (!repository.connected) { clear(); return; }
    rows = combined();
    document.querySelectorAll(".cms-tabs [data-status]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.status === status));
      button.querySelector("span").textContent = rows.filter(row => matches(row, button.dataset.status)).length;
    });
    const category = $("manager-category").value;
    const categories = [...new Set(rows.map(row => row.item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    $("manager-category").innerHTML = '<option value="">모든 카테고리</option>' + categories.map(value => '<option value="' + esc(value) + '">' + esc(value) + "</option>").join("");
    $("manager-category").value = categories.includes(category) ? category : "";
    const filtered = visible(), pages = Math.max(1, Math.ceil(filtered.length / 20));
    page = Math.max(1, Math.min(page, pages));
    const shown = filtered.slice((page - 1) * 20, page * 20), list = $("manager-list");
    list.replaceChildren();
    shown.forEach(row => {
      const item = row.item, tr = document.createElement("tr");
      tr.dataset.id = row.id;
      const date = new Date(item.updatedAt);
      const stamp = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
      tr.innerHTML = '<td><input type="checkbox" aria-label="' + esc((item.title || "제목 없는 글") + " 선택") + '"' + (selected.has(row.id) ? " checked" : "") + '></td><td><button type="button" class="cms-post-title" data-action="edit"' + (row.state === "trash" ? " disabled" : "") + ">" + esc(item.title || "제목 없는 글") + '</button><span class="cms-post-kind">' + (item.kind === "notes" ? "NOTES" : "POSTS") + '</span></td><td><span class="cms-state" data-state="' + row.state + '">' + stateLabel[row.state] + "</span>" + (row.state === "modified" ? '<span class="cms-state-note">공개본 있음</span>' : "") + '</td><td>' + esc(item.category || "미분류") + '</td><td class="cms-post-date">' + esc(stamp) + '</td><td><div class="cms-post-actions"></div></td>';
      const actions = tr.querySelector(".cms-post-actions");
      const button = (label, action, disabled = false) => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label;
        button.disabled = busy || disabled; button.dataset.action = action; actions.append(button);
      };
      if (row.state !== "trash") {
        button("편집", "edit"); button("복제", "duplicate");
        if (row.stale) button("최신 공개본 불러오기", "reload-remote");
        if (row.local && row.state !== "published") button(row.published ? "수정 발행" : "발행", "publish");
        button("휴지통", "trash", !canChange(row));
      } else button("복원", "restore", !canChange(row));
      if (row.remote?.status === "published") {
        const link = document.createElement("a"); link.href = publicLink(row.remote); link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "공개본 ↗"; actions.append(link);
      }
      tr.querySelector('input[type="checkbox"]').addEventListener("change", event => {
        if (event.target.checked) selected.add(row.id); else selected.delete(row.id); renderSelection();
      });
      tr.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => handle(row, button.dataset.action)));
      list.append(tr);
    });
    $("manager-empty").hidden = Boolean(filtered.length);
    $("manager-empty").textContent = rows.length ? "조건에 맞는 글이 없어요." : "아직 작성한 글이 없어요. 새 글을 작성해 보세요.";
    $("manager-result-count").textContent = filtered.length + "개의 글";
    $("manager-page").textContent = page + " / " + pages;
    $("manager-prev").disabled = busy || page <= 1; $("manager-next").disabled = busy || page >= pages;
    $("manager-connection").textContent = repository.connected ? repository.user.login + " 연결됨 · 임시글은 브라우저에, 발행한 글은 GitHub에 저장돼요." : "GitHub 미연결 · 임시글을 편집할 수 있고, 발행·공개 글 변경에는 연결이 필요해요.";
    renderSelection();
    onStatusChange(status);
  }
  async function refresh({ fetchRemote = true } = {}) {
    if (!repository.connected) { clear(); return; }
    const version = ++refreshVersion;
    $("manager-loading").hidden = false;
    const results = await Promise.allSettled([listDrafts({ includeTrash: true }), fetchRemote ? repository.readIndex() : Promise.resolve(null)]);
    if (version !== refreshVersion || !repository.connected) return;
    $("manager-loading").hidden = true;
    if (results[0].status === "fulfilled") local = results[0].value;
    else report("브라우저 임시글을 불러오지 못했어요. 사이트 저장 공간을 확인해 주세요.", true);
    if (results[1].status === "fulfilled") {
      if (results[1].value) { remote = results[1].value.entries; onIndexChange(results[1].value, local); }
      $("manager-remote-error").hidden = true;
    } else {
      $("manager-remote-error").textContent = "GitHub 글 목록을 갱신하지 못했어요. 임시글은 계속 편집할 수 있어요. " + results[1].reason.message;
      $("manager-remote-error").hidden = false;
    }
    selected.clear(); render();
  }
  function clear() {
    refreshVersion++; clearTimeout(deployTimer);
    local = []; remote = []; rows = []; selected.clear();
    $("manager-list").replaceChildren();
    $("manager-loading").hidden = true;
    $("manager-remote-error").hidden = true;
    $("deployment-panel").hidden = true;
  }
  function confirmChange(chosen, restore) {
    const published = chosen.some(row => row.published);
    $("manager-confirm-title").textContent = chosen.length + "개 글을 " + (restore ? "복원할까요?" : "휴지통으로 옮길까요?");
    $("manager-confirm-description").textContent = published
      ? restore ? "발행된 글은 공개 블로그에 다시 표시돼요. 복원한 임시글은 이 브라우저에서 이어 쓸 수 있어요." : "발행된 글은 배포 후 공개 목록에서 내려가요. GitHub의 이전 기록과 첨부 이미지는 남으며 나중에 복원할 수 있어요."
      : restore ? "이 브라우저의 임시글 목록으로 복원해요." : "이 브라우저의 휴지통으로 옮겨요. 나중에 복원할 수 있어요.";
    $("manager-confirm-items").replaceChildren(...chosen.map(row => { const li = document.createElement("li"); li.textContent = row.item.title || "제목 없는 글"; return li; }));
    $("manager-confirm-submit").textContent = restore ? "복원" : "휴지통으로 이동";
    return new Promise(resolve => {
      const dialog = $("manager-confirm"); let accepted = false;
      const accept = () => { accepted = true; dialog.close(); };
      $("manager-confirm-submit").addEventListener("click", accept);
      dialog.addEventListener("close", () => { $("manager-confirm-submit").removeEventListener("click", accept); resolve(accepted); }, { once: true });
      dialog.showModal();
    });
  }
  async function change(chosen, restore) {
    if (!chosen.length || !await confirmChange(chosen, restore)) return;
    const remoteItems = chosen.filter(row => row.published).map(row => row.remote);
    const publications = new Map();
    if (remoteItems.length) {
      if (remoteItems.some(item => !item)) throw new Error("GitHub 글 목록을 새로고침한 뒤 다시 시도해 주세요.");
      const result = await repository.changeStatus(remoteItems, restore);
      remote = result.index.entries;
      remote.forEach(item => { publications.set(item.id, { id: item.id, sha: item.sha, commit: result.commit, sourceDigest: item.sourceDigest }); });
      watchDeployment(result.commit, remoteItems[0]);
    }
    await trashDrafts(chosen.filter(row => row.local).map(row => row.local), restore, publications);
    await refresh({ fetchRemote: false });
    report(restore ? "글을 복원했어요." : "휴지통으로 옮겼어요.");
  }
  async function editable(row) {
    if (row.local) {
      const entry = await readDraft(row.id);
      if (!entry || entry.trashedAt) throw new Error("이 임시글을 다시 불러와 주세요.");
      return entry;
    }
    const entry = await repository.loadDraft(row.remote, text => report(text));
    return writeDraft(entry, 0);
  }
  const handle = withBusy(async (row, action) => {
    if (action === "trash" || action === "restore") return change([row], action === "restore");
    if (action === "reload-remote") {
      $("manager-confirm-title").textContent = "최신 공개본을 불러올까요?";
      $("manager-confirm-description").textContent = "현재 브라우저의 글은 별도 임시글로 복제해 보관하고, GitHub의 최신 공개본을 불러와요.";
      $("manager-confirm-items").replaceChildren();
      const name = document.createElement("li"); name.textContent = row.item.title || "제목 없는 글"; $("manager-confirm-items").append(name);
      $("manager-confirm-submit").textContent = "수정본 보관 후 불러오기";
      const accepted = await new Promise(resolve => {
        const dialog = $("manager-confirm"); let accepted = false;
        const accept = () => { accepted = true; dialog.close(); };
        $("manager-confirm-submit").addEventListener("click", accept);
        dialog.addEventListener("close", () => { $("manager-confirm-submit").removeEventListener("click", accept); resolve(accepted); }, { once: true });
        dialog.showModal();
      });
      if (!accepted) return;
      const old = await readDraft(row.id), latest = await repository.loadDraft(row.remote, text => report(text));
      if (!old || old.revision !== row.local.revision) throw new Error("브라우저 글이 변경됐어요. 목록을 새로고침해 주세요.");
      const copy = { ...structuredClone(old), id: crypto.randomUUID(), revision: 0, title: (old.title || "제목 없는 글").slice(0, 180) + " (이전 수정본)", createdAt: new Date().toISOString(), trashedAt: null };
      delete copy.publication;
      await writeDraft(copy, 0);
      const saved = await writeDraft(latest, old.revision);
      await refresh({ fetchRemote: false }); await edit(saved, false);
      report("이전 수정본을 별도 임시글에 보관하고 최신 공개본을 불러왔어요.");
      return;
    }
    const entry = await editable(row);
    if (action === "duplicate") {
      const copy = { ...structuredClone(entry), ...newEntry(), title: ((entry.title || "제목 없는 글").slice(0, 185) + " (복사본)"), doc: structuredClone(entry.doc), assets: structuredClone(entry.assets), kind: entry.kind, category: entry.category, tags: [...entry.tags], description: entry.description, mode: entry.mode, markdown: entry.markdown };
      delete copy.publication; delete copy.sourceDigest; delete copy.trashedAt;
      await writeDraft(copy, 0); await refresh({ fetchRemote: false }); report("글을 임시글로 복제했어요.");
      return;
    }
    await edit(entry, action === "publish");
  });
  document.querySelectorAll(".cms-tabs [data-status]").forEach(button => button.addEventListener("click", () => { status = button.dataset.status; page = 1; selected.clear(); render(); }));
  ["manager-search", "manager-kind", "manager-category"].forEach(id => $(id).addEventListener(id === "manager-search" ? "input" : "change", () => { page = 1; selected.clear(); render(); }));
  $("manager-select-all").addEventListener("change", event => { visible().slice((page - 1) * 20, page * 20).forEach(row => event.target.checked ? selected.add(row.id) : selected.delete(row.id)); render(); });
  $("manager-prev").addEventListener("click", () => { page--; selected.clear(); render(); });
  $("manager-next").addEventListener("click", () => { page++; selected.clear(); render(); });
  $("manager-refresh").addEventListener("click", () => refresh());
  $("manager-new").addEventListener("click", newDraft);
  $("manager-bulk-trash").addEventListener("click", withBusy(() => change(rows.filter(row => selected.has(row.id)), false)));
  $("manager-bulk-restore").addEventListener("click", withBusy(() => change(rows.filter(row => selected.has(row.id)), true)));
  $("manager-import").addEventListener("click", () => $("backup-input").click());
  repository.addEventListener("change", () => { if (!repository.connected) clear(); else render(); });
  async function checkDeployment() {
    clearTimeout(deployTimer);
    if (!lastDeployment || !repository.connected) return;
    const current = lastDeployment, panel = $("deployment-panel");
    panel.hidden = false; polls++;
    let done = false;
    try {
      const run = await repository.deployment(current.sha);
      if (current !== lastDeployment) return;
      $("deployment-actions").hidden = !run;
      if (run) $("deployment-actions").href = "https://github.com/" + "yt010108/yt010108.github.io/actions/runs/" + run.id;
      const success = run?.status === "completed" && run.conclusion === "success";
      done = run?.status === "completed";
      $("deployment-status").textContent = !run ? "GitHub에 저장됨 · 배포 시작을 기다리는 중…" : !done ? "GitHub에 저장됨 · 블로그를 배포하는 중…" : success ? "배포 완료 · 블로그에 반영됐어요." : run.conclusion === "cancelled" ? "다른 변경으로 배포가 취소됐어요. 최신 배포를 확인해 주세요." : "GitHub에는 저장됐지만 배포에 실패했어요. Actions에서 원인을 확인해 주세요.";
      $("deployment-view").hidden = !success;
      if (success) $("deployment-view").href = publicLink(current.item, current.sha);
    } catch {
      $("deployment-status").textContent = "GitHub 저장 후 배포 상태를 확인하지 못했어요. 다시 확인을 눌러 주세요.";
      $("deployment-view").hidden = true;
    }
    if (!done && polls < 40) deployTimer = setTimeout(checkDeployment, 15000);
  }
  function watchDeployment(sha, item) {
    lastDeployment = { sha, item: { id: item.id, kind: item.kind } }; polls = 0;
    try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(lastDeployment)); } catch {}
    checkDeployment();
  }
  $("deployment-refresh").addEventListener("click", () => { polls = 0; checkDeployment(); });
  try {
    const value = JSON.parse(localStorage.getItem(DEPLOY_KEY));
    if (/^[a-f0-9]{40}$/.test(value?.sha) && /^[a-f0-9-]{36}$/.test(value.item?.id) && ["posts", "notes"].includes(value.item.kind)) lastDeployment = value;
  } catch {}
  return {
    refresh, render, clear, watchDeployment,
    resume() { if (lastDeployment && repository.connected) { polls = 0; checkDeployment(); } },
    setStatus(next) { if (!["all", "draft", "published", "trash"].includes(next)) return; status = next; page = 1; selected.clear(); render(); },
    setRemote(index) { remote = index.entries; onIndexChange(index, local); render(); }
  };
}
