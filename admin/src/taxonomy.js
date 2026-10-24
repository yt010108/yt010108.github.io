import { listDrafts, readDraft, writeDraftBatch, DraftConflict } from "./draft-store.js";
import { taxonomyOptions, usesTaxonomy, replaceTaxonomy } from "../../shared/taxonomy.js";

const $ = id => document.getElementById(id);
export function createTaxonomyManager({ repository, report, onBusy, onChange }) {
  let index = { entries: [] }, local = [], type = "categories", busy = false, pending;
  const label = () => type === "categories" ? "카테고리" : "태그";
  function render() {
    const options = taxonomyOptions(index, local), list = $("taxonomy-list");
    for (const [kind, id] of [["categories", "category-suggestions"], ["tags", "tag-suggestions"]]) {
      $(id).replaceChildren(...options[kind].map(name => new Option(name, name)));
    }
    document.querySelectorAll("[data-taxonomy-type]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.taxonomyType === type)));
    $("taxonomy-name-label").textContent = "새 " + label();
    $("taxonomy-name").maxLength = type === "categories" ? 100 : 80;
    $("taxonomy-name").placeholder = type === "categories" ? "예: Security / Web" : "예: reversing";
    list.replaceChildren();
    for (const name of options[type]) {
      const ids = new Set([...index.entries, ...local].filter(entry => usesTaxonomy(entry, type, name)).map(entry => entry.id));
      const row = document.createElement("li"), copy = document.createElement("div"), title = document.createElement("strong"), count = document.createElement("span"), actions = document.createElement("div");
      row.dataset.taxonomyName = name;
      title.textContent = name; count.textContent = "글 " + ids.size + "개";
      copy.append(title, count); actions.className = "taxonomy-actions";
      for (const [action, text] of [["rename", "이름 변경"], ["delete", "삭제"]]) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "writer-text-button"; button.textContent = text;
        button.dataset.taxonomyAction = action; button.disabled = busy;
        button.addEventListener("click", () => review(action, name)); actions.append(button);
      }
      row.append(copy, actions); list.append(row);
    }
    $("taxonomy-empty").hidden = Boolean(options[type].length);
  }
  async function refresh() {
    if (!repository.connected) return;
    $("taxonomy-loading").hidden = false;
    try {
      const values = await Promise.all([repository.readIndex(), listDrafts({ includeTrash: true })]);
      if (!repository.connected) return;
      [index, local] = values; render();
    } catch (error) { report(error.message, true); }
    finally { $("taxonomy-loading").hidden = true; }
  }
  function review(action, name) {
    if (busy || !repository.connected) return;
    const remote = index.entries.filter(entry => usesTaxonomy(entry, type, name));
    const drafts = local.filter(entry => usesTaxonomy(entry, type, name));
    pending = { type, action, name, expectedIndex: structuredClone(index), remote, drafts };
    $("taxonomy-dialog-title").textContent = label() + (action === "delete" ? " 삭제" : " 이름 변경");
    $("taxonomy-change-name").textContent = "선택한 " + label() + ": " + name;
    $("taxonomy-next-label").hidden = action === "delete";
    $("taxonomy-next").required = action === "rename";
    $("taxonomy-next").maxLength = type === "categories" ? 100 : 80;
    $("taxonomy-next").value = name;
    $("taxonomy-impact").textContent = "발행한 글 " + remote.length + "개와 이 브라우저의 저장본 " + drafts.length + "개에 적용돼요. " + (action !== "delete" ? "선택한 항목의 이름을 함께 바꿔요." : type === "categories" ? "해당 글의 카테고리를 미분류로 바꿔요. 글은 삭제하지 않아요." : "해당 태그만 글에서 제거해요. 글과 다른 태그는 유지돼요.");
    $("taxonomy-error").hidden = true;
    $("taxonomy-confirm").textContent = action === "delete" ? "삭제하기" : "변경하기";
    $("taxonomy-dialog").showModal();
    if (action === "rename") $("taxonomy-next").select();
  }
  async function save(change) {
    if (busy || !repository.connected) return;
    const generation = repository.generation;
    let result;
    busy = true; onBusy(true); $("taxonomy-confirm").disabled = true;
    try {
      const options = taxonomyOptions(index, local);
      const nextName = change.action === "add" ? change.name : change.replacement;
      if (nextName && options[change.type].includes(nextName)) throw new Error("이미 있는 이름이에요. 다른 이름을 입력해 주세요.");
      const drafts = await Promise.all((change.drafts || []).map(async item => {
        const entry = await readDraft(item.id);
        if (!entry || entry.revision !== item.revision) throw new DraftConflict();
        return entry;
      }));
      result = await repository.changeTaxonomy(change);
      if (!repository.connected || repository.generation !== generation) return;
      const replacements = drafts.map(entry => {
        const next = replaceTaxonomy(entry, change.type, change.name, change.action === "delete" ? "" : change.replacement);
        const before = change.expectedIndex.entries.find(item => item.id === entry.id), after = result.index.entries.find(item => item.id === entry.id);
        if (before && after && entry.publication?.sha === before.sha) next.publication = { ...entry.publication, sha: after.sha, sourceDigest: after.sourceDigest, commit: result.commit };
        return next;
      });
      await writeDraftBatch(replacements);
      index = result.index;
      await onChange(result, replacements.map(entry => entry.id));
      $("taxonomy-dialog").close(); $("taxonomy-name").value = "";
      await refresh(); report("분류 변경을 저장했어요." + (result.items.length ? " 공개 글은 배포가 끝나면 반영돼요." : ""));
    } catch (error) {
      const text = result ? "GitHub에는 저장됐어요. 이 브라우저의 저장본은 덮어쓰지 않았어요. 글 관리에서 최신 상태를 확인해 주세요. " + error.message : error.message;
      if (result) { await onChange(result, []); await refresh(); }
      if ($("taxonomy-dialog").open) { $("taxonomy-error").textContent = text; $("taxonomy-error").hidden = false; }
      else report(text, true);
    } finally { busy = false; onBusy(false); $("taxonomy-confirm").disabled = false; render(); }
  }
  document.querySelectorAll("[data-taxonomy-type]").forEach(button => button.addEventListener("click", () => { type = button.dataset.taxonomyType; $("taxonomy-name").value = ""; render(); }));
  $("taxonomy-refresh").addEventListener("click", refresh);
  $("taxonomy-add-form").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("taxonomy-name").value.trim();
    if (name) save({ type, action: "add", name, expectedIndex: structuredClone(index) });
  });
  $("taxonomy-change-form").addEventListener("submit", event => {
    event.preventDefault();
    if (pending) save({ ...pending, replacement: pending.action === "rename" ? $("taxonomy-next").value.trim() : "" });
  });
  return {
    refresh,
    setIndex(next, drafts = local) { index = next; local = drafts; render(); },
    clear() { index = { entries: [] }; local = []; pending = null; render(); }
  };
}
