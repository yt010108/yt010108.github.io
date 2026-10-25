import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorState } from "@tiptap/pm/state";
import { zipSync, strToU8 } from "fflate";
import { createIcons, SquarePen, Files, Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Link, ImagePlus, Table2, SquareCode, Minus, Eye, Undo2, Redo2, FolderOpen, Download, Archive, ArrowLeft, Hash, Menu, FileClock, FolderTree, Images, PanelsTopLeft, Trash2, LogOut } from "lucide";
import { readDraft, listDrafts, writeDraft, DraftConflict } from "./draft-store.js";
import { IMAGE_TYPES, MAX_IMAGE_SIZE, newEntry, safeSlug, safeImageData, createAsset, imageBySource, transformImages, usedAssets, validateBackup, markdownDocument, assetBytes } from "./document.js";
import { createLinkPreviews, webURL } from "./link-preview.js";
import { renderDocument } from "../../shared/posts.js";
import { GitHubRepository, REMEMBER_KEY } from "./github.js";
import { createManager } from "./manager.js";
import { createTaxonomyManager } from "./taxonomy.js";

const $ = id => document.getElementById(id);
const ACTIVE_KEY = "yt010108-writing-active";
const title = $("post-title"), source = $("markdown-editor"), status = $("save-status");
const assets = new Map();
let entry = newEntry(), mode = "rich", ready = false, silent = false, composing = false;
let changes = 0, savedChanges = 0, exportedChanges = -1;
let saveTimer, messageTimer, savePromise, editor, lastSelection, imagePosition;
let imageJobs = Promise.resolve(), pendingImages = 0;
let cmsBusy = false, managing = false, taxonomyOpen = false, navigationBusy = false;
let authorized = false, authBusy = false, unlockTask, managerStatus = "all";
const repository = new GitHubRepository();
const linkPreviews = createLinkPreviews({ getEditor: () => editor, getEntryId: () => entry.id });

createIcons({ icons: { SquarePen, Files, Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Link, ImagePlus, Table2, SquareCode, Minus, Eye, Undo2, Redo2, FolderOpen, Download, Archive, ArrowLeft, Hash, Menu, FileClock, FolderTree, Images, PanelsTopLeft, Trash2, LogOut }, attrs: { "stroke-width": 1.5 } });

function message(text, error = false) {
  clearTimeout(messageTimer);
  const element = $("writer-message");
  element.textContent = text;
  element.dataset.error = String(error);
  element.setAttribute("role", error ? "alert" : "status");
  element.hidden = false;
  if (!error) messageTimer = setTimeout(() => { element.hidden = true; }, 6000);
}

function saveStatus(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function setBusy(value) {
  cmsBusy = value;
  const enabled = ready && authorized && repository.connected;
  $("writer-fields").disabled = value || !enabled;
  $("taxonomy-fields").disabled = value || !enabled;
  $("taxonomy-refresh").disabled = value || !enabled;
  editor?.setEditable(enabled && !value, false);
  ["new-draft", "open-drafts", "manage-button", "manager-new", "manager-refresh", "github-connect", "sidebar-logout", "github-disconnect", "finish-button", "save-button", "preview-button", "publish-button"].forEach(id => { $(id).disabled = value || !enabled; });
}

function setView(managerView) {
  if (!authorized || !repository.connected) return;
  taxonomyOpen = managerView === "taxonomy";
  managing = Boolean(managerView);
  document.body.classList.toggle("is-managing", managing);
  $("taxonomy-view").hidden = !taxonomyOpen;
  $("manager-view").hidden = !managing || taxonomyOpen;
  $("writer-view").hidden = managing;
  document.querySelector(".writer-heading").textContent = managerView ? "관리" : "글쓰기";
  $("manage-button").setAttribute("aria-current", managerView ? "page" : "false");
  const skip = document.querySelector(".skip-link");
  skip.href = taxonomyOpen ? "#taxonomy-title" : managing ? "#manager-title" : "#post-title";
  skip.textContent = taxonomyOpen ? "분류 관리로 이동" : managing ? "글 관리로 이동" : "글 제목으로 이동";
  document.title = taxonomyOpen ? "카테고리·태그 — yt010108" : managing ? "글 관리 — yt010108" : (title.value.trim() || "글쓰기") + " — yt010108";
  history.replaceState(null, "", taxonomyOpen ? "#taxonomy" : managing ? managerStatus === "draft" ? "#drafts" : managerStatus === "trash" ? "#trash" : "#manage" : "#write");
  syncSidebar(); setSidebarOpen(false);
  if (!managerView) resizeTitle();
}

async function openManager(next = "all") {
  if (cmsBusy || navigationBusy || !ready || !authorized || !repository.connected) return;
  if (typeof next !== "string") next = "all";
  navigationBusy = true; setBusy(true);
  try {
    if (!await keepBeforeSwitch()) return;
    manager.setStatus(next);
    setView(true);
    await manager.refresh();
  } finally { navigationBusy = false; setBusy(false); }
}

async function beginNew() {
  if (cmsBusy || navigationBusy || !ready || !authorized || !repository.connected) return;
  navigationBusy = true; setBusy(true);
  try {
    if (!await keepBeforeSwitch()) return;
    applyEntry(newEntry()); setView(false);
  } finally { navigationBusy = false; setBusy(false); }
  title.focus();
}

async function openTaxonomy() {
  if (cmsBusy || navigationBusy || !ready || !authorized || !repository.connected) return;
  navigationBusy = true; setBusy(true);
  try {
    if (!await keepBeforeSwitch()) return;
    setView("taxonomy"); await taxonomy.refresh();
  } finally { navigationBusy = false; setBusy(false); }
}

function updatePublishReview() {
  const name = title.value.trim() || "제목 없는 글";
  $("publish-review").textContent = name + " · " + ($("entry-kind").value === "notes" ? "Notes" : "Posts") + " · " + ($("post-category").value.trim() || "미분류") + " · 공개";
  $("publish-button").textContent = repository.connected ? entry.publication ? "수정 발행" : "발행하기" : "GitHub 연결 후 발행";
}

function resizeTitle() {
  title.style.height = "auto";
  title.style.height = title.scrollHeight + "px";
}

function refreshCount() {
  const text = mode === "markdown" ? source.value : editor.getText();
  $("word-count").textContent = text.trim() ? text.replace(/\s/g, "").length.toLocaleString("ko-KR") + "자" : "";
}

function meaningful() {
  return Boolean(title.value.trim() || !editor.isEmpty || source.value.trim() || entry.tags.length || $("post-category").value.trim());
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist().catch(() => {}), 800);
}

function changed() {
  if (!ready || silent || !authorized) return;
  changes++;
  saveStatus("작성 중 · 이 브라우저에 저장");
  refreshCount();
  document.title = (title.value.trim() || "글쓰기") + " — yt010108";
  scheduleSave();
}

function localImage(src) {
  let asset = imageBySource(assets, src);
  if (!asset && safeImageData(src)) {
    asset = createAsset(src);
    assets.set(asset.id, asset);
  }
  return asset;
}

const DraftImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: element => element.getAttribute("data-asset-id"),
        renderHTML: attributes => attributes.assetId ? { "data-asset-id": attributes.assetId } : {}
      }
    };
  },
  parseMarkdown(token, helpers) {
    const asset = localImage(token.href);
    return helpers.createNode("image", {
      src: asset ? asset.data : /^https:\/\//i.test(token.href || "") ? token.href : "",
      assetId: asset?.id || null, alt: token.text || "", title: token.title || null
    });
  },
  renderMarkdown(node) {
    const asset = assets.get(node.attrs?.assetId) || imageBySource(assets, node.attrs?.src);
    const src = asset?.path || node.attrs?.src || "";
    const alt = (node.attrs?.alt || "").replace(/[[\]\\]/g, "\\$&").replace(/\n/g, " ");
    return "![" + alt + "](" + src + ")";
  }
}).configure({ allowBase64: true });

function pastedHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img").forEach(image => {
    const asset = localImage(image.getAttribute("src") || "");
    if (asset) image.setAttribute("data-asset-id", asset.id);
    else if (!/^https:\/\//i.test(image.getAttribute("src") || "")) image.remove();
  });
  return template.innerHTML;
}

function enterShortcut(view, event) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || composing) return false;
  const { empty, $from } = view.state.selection;
  if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return false;
  const text = $from.parent.textContent;
  const url = $from.depth === 1 && !/\s/.test(text.trim()) ? webURL(text) : null;
  if (!url) return false;
  const after = $from.after();
  if (view.state.doc.nodeAt(after)?.type.name === "linkPreview") return false;
  return editor.chain().setTextSelection({ from: $from.start(), to: $from.end() })
    .setLink({ href: url.href }).setTextSelection($from.end())
    .insertContentAt(after, [linkPreviews.create(url.href), { type: "paragraph" }])
    .unsetLink().run();
}

editor = new Editor({
  element: $("rich-editor"), editable: false,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] }, underline: false,
      link: { openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } }
    }),
    DraftImage,
    linkPreviews.extension,
    TableKit.configure({ table: { resizable: false, renderWrapper: true, cellMinWidth: 80 } }),
    Placeholder.configure({ placeholder: "이야기를 시작해 보세요…" }),
    Markdown.configure({ markedOptions: { gfm: true } })
  ],
  content: entry.doc,
  editorProps: {
    attributes: { role: "textbox", "aria-label": "글 본문", "aria-multiline": "true", spellcheck: "false" },
    transformPastedHTML: pastedHTML,
    handleKeyDown: enterShortcut,
    handleDOMEvents: {
      click(view, event) {
        if (event.target instanceof Element && event.target.closest(".writer-link-card")) event.preventDefault();
        return false;
      }
    },
    handleClickOn(view, position, node, nodePosition, event) {
      if (node.type.name !== "linkPreview") return false;
      event.preventDefault();
      editor.commands.setNodeSelection(nodePosition);
      return true;
    },
    handlePaste(view, event) {
      const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/"));
      if (!images.length) return false;
      event.preventDefault();
      addImages(images);
      return true;
    },
    handleDrop(view, event, slice, moved) {
      if (moved || !event.dataTransfer?.files.length) return false;
      const files = [...event.dataTransfer.files];
      if (!files.some(file => file.type.startsWith("image/"))) return false;
      event.preventDefault();
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (position) editor.commands.setTextSelection(position.pos);
      addImages(files);
      return true;
    }
  },
  onUpdate() { changed(); updateTools(); if (ready) linkPreviews.resume(); },
  onSelectionUpdate() { updateTools(); }
});
const manager = createManager({
  repository, report: message, onBusy: setBusy, newDraft: beginNew,
  onStatusChange: status => { managerStatus = status; syncSidebar(); },
  onIndexChange: (index, drafts) => taxonomy.setIndex(index, drafts),
  edit: async (next, publish) => {
    if (!authorized || !repository.connected) return;
    if (!await keepBeforeSwitch()) return;
    applyEntry(next); setView(false);
    if (publish) await openExport();
    else editor.commands.focus();
  }
});
const taxonomy = createTaxonomyManager({
  repository, report: message, onBusy: setBusy,
  onChange: async (result, updatedIds) => {
    manager.setRemote(result.index);
    if (updatedIds.includes(entry.id)) {
      const next = await readDraft(entry.id);
      if (next) applyEntry(next);
    }
    await manager.refresh({ fetchRemote: false });
    const published = result.items.find(item => item.status === "published");
    if (published) manager.watchDeployment(result.commit, published);
  }
});

function syncMarkdown() {
  if (mode !== "markdown") return;
  silent = true;
  try { editor.commands.setContent(source.value, { contentType: "markdown", emitUpdate: false }); }
  finally { silent = false; }
  if (ready) linkPreviews.resume();
}

function snapshot() {
  syncMarkdown();
  const doc = transformImages(linkPreviews.enrich(editor.getJSON()), assets, false);
  return {
    ...entry, title: title.value.trim(), kind: $("entry-kind").value, category: $("post-category").value.trim(),
    slug: $("post-slug").value.trim(), description: $("post-description").value.trim(),
    date: $("post-date").value || entry.date, tags: [...entry.tags],
    doc, mode, markdown: mode === "markdown" ? linkPreviews.rewriteMarkdown(source.value) : null,
    assets: usedAssets(doc, assets, mode === "markdown" ? source.value : "")
  };
}

async function persist(force = false) {
  clearTimeout(saveTimer);
  if (!ready) return;
  if (composing && !force) { scheduleSave(); return; }
  if (savePromise) { await savePromise; return persist(force); }
  if (!force && (changes === savedChanges || !meaningful())) return;
  const version = changes;
  let failed = false;
  saveStatus("저장 중…");
  savePromise = (async () => {
    const data = snapshot();
    const result = await writeDraft(data, entry.revision);
    entry.revision = result.revision;
    entry.updatedAt = result.updatedAt;
    savedChanges = version;
    try { localStorage.setItem(ACTIVE_KEY, entry.id); } catch {}
    $("save-copy").hidden = true;
    const time = new Date(result.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    saveStatus(changes === savedChanges ? "이 브라우저에 저장됨 · " + time : "새 변경 사항 저장 중…");
  })().catch(error => {
    failed = true;
    const text = error instanceof DraftConflict ? error.message : "임시저장하지 못했어요. 완료에서 파일로 보관해 주세요.";
    saveStatus("저장하지 못함 · 파일로 보관해 주세요", true);
    $("save-copy").hidden = !(error instanceof DraftConflict);
    message(text, true);
    throw error;
  }).finally(() => {
    savePromise = undefined;
    if (!failed && changes !== savedChanges) scheduleSave();
  });
  return savePromise;
}

function renderTags() {
  $("tag-list").replaceChildren();
  entry.tags.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "writer-tag";
    const text = document.createElement("span");
    text.textContent = tag;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", tag + " 태그 삭제");
    remove.addEventListener("click", () => { entry.tags = entry.tags.filter(value => value !== tag); renderTags(); changed(); });
    chip.append(text, remove);
    $("tag-list").append(chip);
  });
}

function commitTags() {
  const input = $("tag-input");
  const values = input.value.split(/[,，\n]/).map(tag => tag.trim().replace(/^#+/, "").slice(0, 80)).filter(Boolean);
  if (!values.length) return;
  const next = [...new Set([...entry.tags, ...values])].slice(0, 30);
  input.value = "";
  if (JSON.stringify(next) === JSON.stringify(entry.tags)) return;
  entry.tags = next;
  renderTags(); changed();
}

function updateTools() {
  if (!editor || !ready) return;
  const rich = mode === "rich";
  document.querySelectorAll("[data-command]").forEach(button => {
    const command = button.dataset.command;
    let disabled = !rich;
    if (rich && command === "undo") disabled = !editor.can().undo();
    if (rich && command === "redo") disabled = !editor.can().redo();
    button.disabled = disabled;
    if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(rich && editor.isActive(command)));
  });
  $("block-style").disabled = !rich;
  document.querySelector('[data-action="link"]').disabled = !rich;
  $("table-tools").hidden = !rich || !editor.isActive("table");
  $("code-tools").hidden = !rich || !editor.isActive("codeBlock");
  $("image-tools").hidden = !rich || !editor.isActive("image");
  $("link-preview-tools").hidden = !rich || !editor.isActive("linkPreview");
  document.querySelector('[data-action="refresh-link-preview"]').disabled = editor.getAttributes("linkPreview").state === "loading";
  if (rich) {
    const level = editor.getAttributes("heading").level;
    $("block-style").value = editor.isActive("heading") ? String(level) : "paragraph";
    const language = editor.getAttributes("codeBlock").language || "";
    $("code-language").querySelector('[data-custom-language]')?.remove();
    if (language && ![...$("code-language").options].some(option => option.value === language)) {
      const option = new Option(language, language);
      option.dataset.customLanguage = "";
      $("code-language").add(option);
    }
    $("code-language").value = language;
  }
}

function applyEntry(next) {
  clearTimeout(saveTimer);
  silent = true;
  entry = next;
  assets.clear();
  entry.assets.forEach(asset => assets.set(asset.id, asset));
  linkPreviews.remember(entry.doc);
  const doc = transformImages(linkPreviews.enrich(entry.doc), assets, true);
  editor.commands.setContent(doc, { emitUpdate: false, errorOnInvalidContent: true });
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
  title.value = entry.title;
  $("entry-kind").value = entry.kind;
  $("post-category").value = entry.category;
  $("post-slug").value = entry.slug;
  $("post-description").value = entry.description;
  $("post-date").value = entry.date;
  $("tag-input").value = "";
  mode = entry.mode === "markdown" ? "markdown" : "rich";
  source.value = entry.markdown ?? editor.getMarkdown();
  $("editor-mode").value = mode;
  $("rich-editor").hidden = mode !== "rich";
  source.hidden = mode !== "markdown";
  changes = 0; savedChanges = 0; exportedChanges = -1;
  silent = false;
  $("save-copy").hidden = true;
  $("writer-message").hidden = true;
  saveStatus(entry.revision ? "이 브라우저에 저장한 글을 불러왔어요" : "이 브라우저에 자동저장");
  if (!managing) document.title = (entry.title || "글쓰기") + " — yt010108";
  renderTags(); resizeTitle(); refreshCount(); updateTools();
  if (ready) linkPreviews.resume();
}

async function keepBeforeSwitch() {
  await waitForImages();
  commitTags();
  if (!meaningful() && changes === savedChanges) return true;
  if (changes === exportedChanges) return true;
  try { await persist(); return true; }
  catch { message("현재 내용을 먼저 파일로 보관하거나 복사본으로 저장해 주세요.", true); return false; }
}

function switchMode() {
  const next = $("editor-mode").value;
  try {
    if (next === "markdown") source.value = editor.getMarkdown();
    else syncMarkdown();
    mode = next;
    $("rich-editor").hidden = mode !== "rich";
    source.hidden = mode !== "markdown";
    updateTools(); changed();
    if (mode === "rich") editor.commands.focus();
    else source.focus();
  } catch {
    $("editor-mode").value = mode;
    message("본문을 변환하지 못했어요. 현재 모드에서 내용을 확인해 주세요.", true);
  }
}

async function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function waitForImages() {
  while (pendingImages) await imageJobs;
}

function addImages(files) {
  const draftId = entry.id;
  pendingImages++;
  message("이미지를 불러오고 있어요…");
  imageJobs = imageJobs.then(() => insertImages(files, draftId)).finally(() => { pendingImages--; });
  return imageJobs;
}

async function insertImages(files, draftId) {
  for (const file of files) {
    try {
      if (!IMAGE_TYPES.has(file.type)) throw new Error("PNG, JPG, GIF, WebP 이미지를 선택해 주세요.");
      if (file.size > MAX_IMAGE_SIZE) throw new Error("이미지는 한 장에 10MB까지 첨부할 수 있어요.");
      const total = usedAssets(editor.getJSON(), assets, mode === "markdown" ? source.value : "").reduce((size, asset) => size + asset.data.length * .75, 0);
      if (total + file.size > 50 * 1024 * 1024) throw new Error("한 글에 첨부하는 이미지는 합계 50MB까지 보관할 수 있어요.");
      const data = await fileData(file);
      const image = new window.Image();
      image.src = data;
      await image.decode();
      if (entry.id !== draftId) return;
      const asset = createAsset(data, file.name);
      assets.set(asset.id, asset);
      const alt = file.name.replace(/\.[^.]+$/, "") || "첨부 이미지";
      if (mode === "markdown") {
        const markdown = "\n![" + alt.replace(/[[\]\\]/g, "\\$&") + "](" + asset.path + ")\n";
        source.setRangeText(markdown, source.selectionStart, source.selectionEnd, "end");
        changed();
      } else {
        editor.chain().focus().insertContent({ type: "image", attrs: { assetId: asset.id, src: asset.data, alt } }).run();
      }
    } catch (error) { message(error.message || "이미지를 읽지 못했어요.", true); }
  }
}

function openLink() {
  lastSelection = editor.state.selection;
  $("link-url").value = editor.getAttributes("link").href || "";
  $("link-dialog").showModal();
  $("link-url").focus(); $("link-url").select();
}

function runCommand(command) {
  const chain = editor.chain().focus();
  const commands = {
    bold: () => chain.toggleBold().run(), italic: () => chain.toggleItalic().run(), strike: () => chain.toggleStrike().run(),
    code: () => chain.toggleCode().run(), bulletList: () => chain.toggleBulletList().run(), orderedList: () => chain.toggleOrderedList().run(),
    blockquote: () => chain.toggleBlockquote().run(), codeBlock: () => chain.toggleCodeBlock().run(),
    horizontalRule: () => chain.setHorizontalRule().run(), table: () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    undo: () => chain.undo().run(), redo: () => chain.redo().run()
  };
  commands[command]?.();
  updateTools();
}

async function preview() {
  if (!authorized || !repository.connected) return;
  await waitForImages();
  commitTags();
  try {
    const data = snapshot();
    $("preview-title").textContent = data.title || "제목 없는 글";
    $("preview-description").textContent = data.description;
    $("preview-description").hidden = !data.description;
    $("preview-category").textContent = data.category || (data.kind === "notes" ? "NOTES" : "POSTS");
    $("preview-meta").textContent = data.date + " · yt010108";
    $("preview-body").innerHTML = renderDocument(data.doc, { assets: data.assets, preview: true }).html;
    const toc = $("preview-toc");
    toc.replaceChildren();
    const headings = [...$("preview-body").querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const baseLevel = Math.min(...headings.map(heading => Number(heading.tagName.slice(1))));
    headings.forEach((heading, index) => {
      heading.id = "preview-section-" + index;
      heading.style.scrollMarginTop = "90px";
      const li = document.createElement("li"), button = document.createElement("button");
      button.type = "button";
      li.className = "toc-depth-" + Math.max(0, Number(heading.tagName.slice(1)) - baseLevel);
      const text = document.createElement("span"), arrow = document.createElement("span");
      text.textContent = heading.textContent; arrow.textContent = "→"; arrow.setAttribute("aria-hidden", "true");
      button.append(text, arrow);
      button.addEventListener("click", () => heading.scrollIntoView({ behavior: "smooth", block: "start" }));
      li.append(button); toc.append(li);
    });
    toc.closest("aside").hidden = !toc.children.length;
    $("preview-dialog").showModal();
    $("preview-dialog").scrollTop = 0;
  } catch { message("미리보기를 만들지 못했어요. 본문을 확인해 주세요.", true); }
}

async function openExport() {
  if (!authorized || !repository.connected) return;
  await waitForImages();
  commitTags();
  try { await persist(); } catch {}
  if (!$("post-slug").value.trim()) {
    $("post-slug").value = safeSlug(title.value || "untitled-" + entry.date);
    changed();
  }
  const data = snapshot();
  const count = data.assets.length;
  $("export-info").textContent = count ? "첨부 이미지 " + count + "장과 글을 함께 보관해요." : "Markdown은 글 원본, 편집용 백업은 다시 불러오기 위한 파일이에요.";
  $("export-markdown").querySelector("span").textContent = count ? "Markdown + 이미지 ZIP 저장" : "Markdown 저장";
  $("publish-progress").textContent = "";
  updatePublishReview();
  $("export-dialog").showModal();
}

async function publish() {
  if (cmsBusy || !authorized) return;
  if (!repository.connected) { openGitHub(); return; }
  if (!title.value.trim()) { $("publish-progress").textContent = "제목을 입력해 주세요."; return; }
  setBusy(true);
  let result;
  try {
    await waitForImages(); commitTags();
    if (!$("post-slug").value.trim()) $("post-slug").value = safeSlug(title.value);
    await persist(true);
    const data = snapshot();
    result = await repository.publish(data, text => { $("publish-progress").textContent = text; });
    manager.setRemote(result.index); manager.watchDeployment(result.commit, result.item);
    entry.publication = result.publication; changes++;
    try { await persist(true); }
    catch {
      $("export-dialog").close();
      message("GitHub에는 발행을 저장했지만 브라우저 임시글 저장에서 충돌이 났어요. 현재 수정본을 복사본으로 보관하고 글 관리에서 공개본을 확인해 주세요.", true);
      return;
    }
    $("export-dialog").close(); setView(true);
    await manager.refresh();
    message("GitHub에 저장했어요. 배포가 끝나면 블로그에 반영돼요.");
  } catch (error) {
    $("publish-progress").textContent = result ? "GitHub 저장은 완료됐어요. 글 관리에서 배포 상태를 확인해 주세요." : error.message || "발행하지 못했어요.";
  } finally { setBusy(false); updatePublishReview(); }
}

function openGitHub() {
  if (!authorized) { $("github-token").focus(); return; }
  $("github-token").value = "";
  $("github-error").hidden = true;
  $("github-disconnect").hidden = !repository.connected;
  $("github-dialog").showModal();
  if (!repository.connected) $("github-token").focus();
}

function syncSidebar() {
  const current = taxonomyOpen ? "taxonomy" : managing ? managerStatus === "draft" ? "draft" : managerStatus === "trash" ? "trash" : "all" : "write";
  document.querySelectorAll("[data-admin-view]").forEach(button => {
    if (button.dataset.adminView === current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (authorized && managing) history.replaceState(null, "", current === "taxonomy" ? "#taxonomy" : current === "draft" ? "#drafts" : current === "trash" ? "#trash" : "#manage");
}

function setSidebarOpen(open) {
  const mobile = matchMedia("(max-width: 800px)").matches;
  open = Boolean(open && mobile && authorized);
  document.body.classList.toggle("is-sidebar-open", open);
  $("sidebar-toggle").setAttribute("aria-expanded", String(open));
  $("sidebar-toggle").setAttribute("aria-label", open ? "관리 메뉴 닫기" : "관리 메뉴 열기");
  $("sidebar-overlay").hidden = !open;
  $("cms-sidebar").inert = !authorized || mobile && !open;
  $("cms-sidebar").setAttribute("aria-hidden", String($("cms-sidebar").inert));
}

function lockAdmin() {
  const wasAuthorized = authorized;
  authorized = false; clearTimeout(saveTimer);
  document.body.classList.add("is-locked");
  $("admin-login").hidden = false; $("admin-main").hidden = true; $("writer-footer").hidden = true;
  document.querySelector(".writer-heading").textContent = "관리자";
  document.querySelector(".skip-link").href = "#admin-login-title";
  document.querySelector(".skip-link").textContent = "로그인으로 이동";
  document.title = "관리자 로그인 — yt010108";
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  $("auth-form-host").append($("github-form"));
  $("github-submit").textContent = authBusy ? "확인 중…" : "관리자 열기";
  $("auth-retry").hidden = !repository.hasSavedConnection;
  if (!authBusy) $("auth-status").textContent = "관리자에 로그인해 주세요.";
  manager.clear(); taxonomy.clear(); setSidebarOpen(false); setBusy(false);
  if (wasAuthorized && ready && changes !== savedChanges) persist().catch(() => {});
}

async function unlockAdmin() {
  if (!repository.connected) return;
  const generation = repository.generation;
  if (unlockTask?.generation === generation) return unlockTask.promise;
  const promise = (async () => {
    authorized = true;
    if (savePromise) { try { await savePromise; } catch {} }
    if (!ready) await start();
    if (!repository.connected || repository.generation !== generation) return;
    const route = location.hash;
    manager.setStatus(route === "#drafts" ? "draft" : route === "#trash" ? "trash" : "all");
    setView(route === "#taxonomy" ? "taxonomy" : route !== "#write");
    await manager.refresh();
    if (route === "#taxonomy") await taxonomy.refresh();
    if (!repository.connected || repository.generation !== generation) return;
    $("github-dialog").append($("github-form"));
    document.body.classList.remove("is-locked");
    $("admin-login").hidden = true; $("admin-main").hidden = false; $("writer-footer").hidden = false;
    $("github-remember").checked = repository.remembered;
    $("auth-status").textContent = "";
    $("auth-retry").hidden = true;
    setBusy(false); setSidebarOpen(false); manager.resume(); resizeTitle();
  })();
  unlockTask = { generation, promise };
  return promise;
}

function authFormBusy(value) {
  authBusy = value;
  ["github-submit", "github-token", "github-remember", "auth-retry"].forEach(id => { $(id).disabled = value; });
}

async function restoreAuth() {
  if (authBusy) return;
  authFormBusy(true);
  $("github-error").hidden = true;
  $("auth-status").textContent = repository.hasSavedConnection ? "저장된 연결을 GitHub에서 확인하고 있어요…" : "";
  try {
    if (await repository.restore()) await unlockAdmin();
  } catch (error) {
    $("github-error").textContent = error.message; $("github-error").hidden = false;
    $("auth-status").textContent = "";
  } finally {
    authFormBusy(false);
    $("auth-retry").hidden = repository.connected || !repository.hasSavedConnection;
    $("github-submit").textContent = repository.connected ? "토큰 변경" : "관리자 열기";
  }
}

async function logout() {
  if (cmsBusy || authBusy) return;
  setBusy(true);
  try { await persist(); } catch {}
  repository.disconnect();
  $("github-token").value = ""; $("github-error").hidden = true;
  $("auth-status").textContent = "로그아웃했어요. 저장된 토큰도 지웠어요.";
  setBusy(false);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportFile(backup) {
  try {
    const data = snapshot();
    const filename = safeSlug(data.slug || data.title || "untitled-" + data.date);
    if (backup) {
      download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename + ".draft.json");
    } else {
      const text = markdownDocument(data, mode === "markdown" ? data.markdown : editor.getMarkdown());
      if (data.assets.length) {
        const files = { [filename + ".md"]: strToU8(text) };
        data.assets.forEach(asset => { files[asset.path] = [assetBytes(asset), { level: 0 }]; });
        download(new Blob([zipSync(files, { level: 6 })], { type: "application/zip" }), filename + ".zip");
      } else download(new Blob([text], { type: "text/markdown;charset=utf-8" }), filename + ".md");
    }
    exportedChanges = changes;
    message("파일을 내보냈어요.");
  } catch (error) { message(error.message || "파일을 만들지 못했어요.", true); }
}

async function showDrafts() {
  commitTags();
  try { await persist(); } catch {}
  const list = $("draft-list");
  list.replaceChildren();
  try {
    const drafts = await listDrafts();
    if (!drafts.length) {
      const empty = document.createElement("p"); empty.className = "writer-dialog-note"; empty.textContent = "아직 저장한 글이 없어요."; list.append(empty);
    }
    drafts.forEach(draft => {
      const button = document.createElement("button"), name = document.createElement("span"), details = document.createElement("small");
      button.type = "button"; button.className = "writer-draft-row";
      name.textContent = draft.title || "제목 없는 글";
      details.textContent = (draft.kind === "notes" ? "Notes" : "Posts") + " · " + new Date(draft.updatedAt).toLocaleString("ko-KR") + (draft.id === entry.id ? " · 현재 글" : "");
      button.append(name, details);
      button.addEventListener("click", async () => {
        if (!await keepBeforeSwitch()) return;
        try {
          const next = await readDraft(draft.id);
          if (!next) throw new Error("이 글을 찾을 수 없어요.");
          applyEntry(next); setView(false); $("drafts-dialog").close();
        } catch (error) { message(error.message || "글을 불러오지 못했어요.", true); }
      });
      list.append(button);
    });
  } catch {
    const note = document.createElement("p"); note.className = "writer-dialog-note"; note.textContent = "저장 공간에 연결하지 못했어요. 백업 파일을 불러올 수 있어요."; list.append(note);
  }
  $("drafts-dialog").showModal();
}

async function importBackup(file) {
  if (!file || !await keepBeforeSwitch()) return;
  try {
    if (file.size > 80 * 1024 * 1024) throw new Error("백업 파일은 80MB까지 불러올 수 있어요.");
    const next = validateBackup(JSON.parse(await file.text()));
    const map = new Map(next.assets.map(asset => [asset.id, asset]));
    editor.schema.nodeFromJSON(transformImages(next.doc, map, true)).check();
    applyEntry(next);
    setView(false);
    changes++;
    await persist(true);
    message("백업을 새 임시글로 불러왔어요.");
  } catch (error) { message(error.message || "백업 파일을 불러오지 못했어요.", true); }
}

$("editor-mode").addEventListener("change", switchMode);
$("block-style").addEventListener("change", event => {
  const chain = editor.chain().focus();
  if (event.target.value === "paragraph") chain.setParagraph().run();
  else chain.setHeading({ level: Number(event.target.value) }).run();
});
$("code-language").addEventListener("change", event => editor.chain().focus().updateAttributes("codeBlock", { language: event.target.value || null }).run());
document.querySelectorAll(".writer-toolbar button, .writer-context-tools button").forEach(button => {
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", () => {
    if (button.dataset.command) runCommand(button.dataset.command);
    if (button.dataset.tableCommand) editor.chain().focus()[button.dataset.tableCommand]().run();
    if (button.dataset.action === "link") openLink();
    if (button.dataset.action === "images") $("image-input").click();
    if (button.dataset.action === "image-alt") {
      imagePosition = editor.state.selection.from;
      $("image-alt").value = editor.getAttributes("image").alt || "";
      $("image-dialog").showModal();
    }
    if (button.dataset.action === "remove-image") editor.chain().focus().deleteSelection().run();
    if (button.dataset.action === "remove-link-preview") editor.chain().focus().deleteSelection().run();
    if (button.dataset.action === "refresh-link-preview") linkPreviews.refreshSelected();
    if (button.dataset.action === "open-link-preview") {
      const url = webURL(editor.getAttributes("linkPreview").href);
      if (url) window.open(url.href, "_blank", "noopener,noreferrer");
    }
  });
});
["entry-kind", "post-category", "post-title", "post-slug", "post-description", "post-date"].forEach(id => {
  $(id).addEventListener("input", () => { changed(); updatePublishReview(); });
});
title.addEventListener("input", resizeTitle);
source.addEventListener("input", changed);
document.addEventListener("error", event => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains("writer-link-image")) event.target.hidden = true;
}, true);
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", () => { composing = false; changed(); });
$("tag-input").addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commitTags(); }
  if (event.key === "Backspace" && !event.target.value && entry.tags.length) { entry.tags.pop(); renderTags(); changed(); }
});
$("tag-input").addEventListener("blur", commitTags);
$("tag-input").addEventListener("input", event => { if (!event.isComposing && /[,，]/.test(event.target.value)) commitTags(); });
$("image-input").addEventListener("change", async event => { await addImages([...event.target.files]); event.target.value = ""; });
source.addEventListener("paste", event => {
  const images = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith("image/"));
  if (images.length) { event.preventDefault(); addImages(images); }
});
source.addEventListener("dragover", event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); });
source.addEventListener("drop", event => {
  if (event.dataTransfer.files.length) { event.preventDefault(); addImages([...event.dataTransfer.files]); }
});
$("link-form").addEventListener("submit", event => {
  event.preventDefault();
  let href = $("link-url").value.trim();
  if (href) {
    if (!/^(https?:|mailto:|#)/i.test(href)) href = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : "https://" + href.replace(/^\/\//, "");
    try {
      if (!href.startsWith("#") && !["http:", "https:", "mailto:"].includes(new URL(href).protocol)) throw new Error();
    } catch {
      $("link-url").setCustomValidity("http, https, mailto 주소를 입력해 주세요.");
      $("link-url").reportValidity();
      return;
    }
  }
  $("link-dialog").close();
  const chain = editor.chain().focus();
  if (lastSelection) chain.command(({ tr }) => { tr.setSelection(lastSelection.map(tr.doc, tr.mapping)); return true; });
  if (href && lastSelection?.empty) {
    chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] })
      .command(({ tr }) => { tr.removeStoredMark(editor.schema.marks.link); return true; }).run();
    return;
  }
  chain.extendMarkRange("link");
  if (href) chain.setLink({ href }).run();
  else chain.unsetLink().run();
});
$("image-form").addEventListener("submit", event => {
  event.preventDefault(); $("image-dialog").close();
  editor.chain().focus().setNodeSelection(imagePosition).updateAttributes("image", { alt: $("image-alt").value.trim() }).run();
});
$("link-url").addEventListener("input", () => $("link-url").setCustomValidity(""));
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog")?.close()));
$("preview-button").addEventListener("click", preview);
$("save-button").addEventListener("click", () => { commitTags(); persist(true).catch(() => {}); });
$("finish-button").addEventListener("click", openExport);
$("open-drafts").addEventListener("click", showDrafts);
$("new-draft").addEventListener("click", beginNew);
$("manage-button").addEventListener("click", openManager);
$("github-connect").addEventListener("click", openGitHub);
$("publish-button").addEventListener("click", publish);
$("github-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (authBusy) return;
  authFormBusy(true); $("github-error").hidden = true;
  const token = $("github-token").value, remember = $("github-remember").checked; $("github-token").value = "";
  $("auth-status").textContent = "GitHub 계정과 저장소를 확인하고 있어요…";
  try {
    await repository.connect(token, { remember });
    await unlockAdmin();
    $("github-dialog").close(); message("GitHub에 연결했어요.");
    if (repository.storageWarning) message(repository.storageWarning, true);
  } catch (error) { $("github-error").textContent = error.message; $("github-error").hidden = false; }
  finally {
    authFormBusy(false); $("auth-status").textContent = "";
    $("auth-retry").hidden = repository.connected || !repository.hasSavedConnection;
    $("github-submit").textContent = repository.connected ? "토큰 변경" : "관리자 열기";
  }
});
$("github-disconnect").addEventListener("click", logout);
$("sidebar-logout").addEventListener("click", logout);
$("auth-retry").addEventListener("click", restoreAuth);
$("github-remember").addEventListener("change", () => {
  if (!repository.connected) return;
  repository.rememberConnection($("github-remember").checked);
  $("github-remember").checked = repository.remembered;
  $("github-storage-note").textContent = repository.storageWarning || (repository.remembered ? "이 브라우저에서 다음 방문에도 연결을 복구해요." : "현재 탭에서만 연결을 유지해요.");
});
repository.addEventListener("change", () => {
  $("github-connect").textContent = repository.connected ? repository.user.login + " 연결됨" : "GitHub 연결";
  $("github-disconnect").hidden = !repository.connected;
  updatePublishReview();
  if (!repository.connected) lockAdmin();
});
document.querySelectorAll("[data-admin-view]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.adminView === "write") beginNew();
  else if (button.dataset.adminView === "taxonomy") openTaxonomy();
  else openManager(button.dataset.adminView);
}));
$("sidebar-toggle").addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("is-sidebar-open")));
$("sidebar-overlay").addEventListener("click", () => setSidebarOpen(false));
matchMedia("(max-width: 800px)").addEventListener("change", () => setSidebarOpen(false));
window.addEventListener("storage", event => {
  if (event.key !== REMEMBER_KEY || !repository.remembered) return;
  let token;
  try { token = localStorage.getItem(REMEMBER_KEY); } catch {}
  if (token === repository.token) return;
  repository.disconnect({ forget: false });
  $("auth-status").textContent = "다른 탭에서 연결이 변경됐어요. 다시 로그인해 주세요.";
});
$("save-copy").addEventListener("click", async () => {
  entry = { ...entry, id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString() };
  delete entry.publication; delete entry.trashedAt;
  savedChanges = -1;
  try { await persist(true); message("현재 내용을 새 임시글로 저장했어요."); } catch {}
});
$("export-markdown").addEventListener("click", () => exportFile(false));
$("export-backup").addEventListener("click", () => exportFile(true));
$("import-backup").addEventListener("click", () => { $("drafts-dialog").close(); $("backup-input").click(); });
$("backup-input").addEventListener("change", async event => { await importBackup(event.target.files[0]); event.target.value = ""; });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.body.classList.contains("is-sidebar-open")) { setSidebarOpen(false); $("sidebar-toggle").focus(); return; }
  if (!authorized) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!managing) { commitTags(); persist(true).catch(() => {}); }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && mode === "rich" && editor.isFocused && !document.querySelector("dialog[open]")) {
    event.preventDefault(); openLink();
  }
});
window.addEventListener("hashchange", () => {
  if (!authorized) return;
  if (location.hash === "#write") {
    if (!cmsBusy) setView(false);
  } else if (location.hash === "#taxonomy") openTaxonomy();
  else if (["#manage", "#drafts", "#trash"].includes(location.hash)) openManager(location.hash === "#drafts" ? "draft" : location.hash === "#trash" ? "trash" : "all");
});
document.addEventListener("click", async event => {
  const button = event.target.closest("#preview-body .copy-code");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.closest(".article-code").querySelector("code").textContent);
    button.textContent = "복사됨";
  } catch { button.textContent = "복사 실패"; }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) persist().catch(() => {}); });
window.addEventListener("beforeunload", event => {
  if (pendingImages || (ready && meaningful() && changes !== savedChanges && changes !== exportedChanges)) { event.preventDefault(); event.returnValue = ""; }
});
new ResizeObserver(entries => {
  document.body.style.setProperty("--writer-header-height", entries[0].target.getBoundingClientRect().height + "px");
  resizeTitle();
}).observe(document.querySelector(".writer-header"));

async function start() {
  try {
    let active;
    try { active = localStorage.getItem(ACTIVE_KEY); } catch {}
    let restored = active ? await readDraft(active) : null;
    if (restored?.trashedAt) restored = null;
    if (!restored) {
      const latest = (await listDrafts())[0];
      if (latest) restored = await readDraft(latest.id);
    }
    if (restored) applyEntry(restored);
  } catch { message("이 브라우저에서 임시저장을 사용할 수 없어요. 작성 후 파일로 보관해 주세요.", true); }
  ready = true;
  $("writer-loading").hidden = true;
  setBusy(false);
  resizeTitle(); refreshCount(); updateTools();
  linkPreviews.resume();
}
applyEntry(entry);
lockAdmin();
restoreAuth();
