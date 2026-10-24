import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorState } from "@tiptap/pm/state";
import { zipSync, strToU8 } from "fflate";
import { createIcons, SquarePen, Files, Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Link, ImagePlus, Table2, SquareCode, Minus, Eye, Undo2, Redo2, FolderOpen, Download, Archive, ArrowLeft, Hash } from "lucide";
import { readDraft, listDrafts, writeDraft, DraftConflict } from "./draft-store.js";
import { IMAGE_TYPES, MAX_IMAGE_SIZE, newEntry, safeSlug, safeImageData, createAsset, imageBySource, transformImages, usedAssets, validateBackup, markdownDocument, assetBytes } from "./document.js";

const $ = id => document.getElementById(id);
const ACTIVE_KEY = "yt010108-writing-active";
const title = $("post-title"), source = $("markdown-editor"), status = $("save-status");
const assets = new Map();
let entry = newEntry(), mode = "rich", ready = false, silent = false, composing = false;
let changes = 0, savedChanges = 0, exportedChanges = -1;
let saveTimer, messageTimer, savePromise, editor, lastSelection, imagePosition;
let imageJobs = Promise.resolve(), pendingImages = 0;

createIcons({ icons: { SquarePen, Files, Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote, Link, ImagePlus, Table2, SquareCode, Minus, Eye, Undo2, Redo2, FolderOpen, Download, Archive, ArrowLeft, Hash }, attrs: { "stroke-width": 1.5 } });

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
  if (!ready || silent) return;
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

editor = new Editor({
  element: $("rich-editor"), editable: false,
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, underline: false,
      link: { openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } }
    }),
    DraftImage,
    TableKit.configure({ table: { resizable: false, renderWrapper: true, cellMinWidth: 80 } }),
    Placeholder.configure({ placeholder: "이야기를 시작해 보세요…" }),
    Markdown.configure({ markedOptions: { gfm: true } })
  ],
  content: entry.doc,
  editorProps: {
    attributes: { role: "textbox", "aria-label": "글 본문", "aria-multiline": "true", spellcheck: "false" },
    transformPastedHTML: pastedHTML,
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
  onUpdate() { changed(); updateTools(); },
  onSelectionUpdate() { updateTools(); }
});

function syncMarkdown() {
  if (mode !== "markdown") return;
  silent = true;
  try { editor.commands.setContent(source.value, { contentType: "markdown", emitUpdate: false }); }
  finally { silent = false; }
}

function snapshot() {
  syncMarkdown();
  const doc = transformImages(editor.getJSON(), assets, false);
  return {
    ...entry, title: title.value.trim(), kind: $("entry-kind").value, category: $("post-category").value.trim(),
    slug: $("post-slug").value.trim(), description: $("post-description").value.trim(),
    date: $("post-date").value || entry.date, tags: [...entry.tags],
    doc, mode, markdown: mode === "markdown" ? source.value : null,
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
  if (rich) {
    const level = editor.getAttributes("heading").level;
    $("block-style").value = editor.isActive("heading") ? String(level) : "paragraph";
    $("code-language").value = editor.getAttributes("codeBlock").language || "";
  }
}

function applyEntry(next) {
  clearTimeout(saveTimer);
  silent = true;
  entry = next;
  assets.clear();
  entry.assets.forEach(asset => assets.set(asset.id, asset));
  const doc = transformImages(entry.doc, assets, true);
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
  document.title = (entry.title || "글쓰기") + " — yt010108";
  renderTags(); resizeTitle(); refreshCount(); updateTools();
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
  await waitForImages();
  commitTags();
  try {
    const data = snapshot();
    $("preview-title").textContent = data.title || "제목 없는 글";
    $("preview-description").textContent = data.description;
    $("preview-description").hidden = !data.description;
    $("preview-category").textContent = data.category || (data.kind === "notes" ? "NOTES" : "POSTS");
    const minutes = Math.max(1, Math.ceil(editor.getText().trim().split(/\s+/).length / 200));
    $("preview-meta").textContent = data.date + " · " + minutes + " min read · yt010108";
    $("preview-body").innerHTML = editor.getHTML();
    const toc = $("preview-toc");
    toc.replaceChildren();
    $("preview-body").querySelectorAll("h1, h2, h3").forEach((heading, index) => {
      heading.id = "preview-section-" + index;
      heading.style.scrollMarginTop = "90px";
      const li = document.createElement("li"), button = document.createElement("button");
      button.type = "button";
      button.textContent = heading.textContent;
      button.addEventListener("click", () => heading.scrollIntoView({ behavior: "smooth", block: "start" }));
      li.append(button); toc.append(li);
    });
    toc.closest("aside").hidden = !toc.children.length;
    $("preview-dialog").showModal();
    $("preview-dialog").scrollTop = 0;
  } catch { message("미리보기를 만들지 못했어요. 본문을 확인해 주세요.", true); }
}

async function openExport() {
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
  $("export-dialog").showModal();
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
      const text = markdownDocument(data, mode === "markdown" ? source.value : editor.getMarkdown());
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
          applyEntry(next); $("drafts-dialog").close();
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
  });
});
["entry-kind", "post-category", "post-title", "post-slug", "post-description", "post-date"].forEach(id => {
  $(id).addEventListener("input", changed);
});
title.addEventListener("input", resizeTitle);
source.addEventListener("input", changed);
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
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
$("preview-button").addEventListener("click", preview);
$("save-button").addEventListener("click", () => { commitTags(); persist(true).catch(() => {}); });
$("finish-button").addEventListener("click", openExport);
$("open-drafts").addEventListener("click", showDrafts);
$("new-draft").addEventListener("click", async () => {
  if (!await keepBeforeSwitch()) return;
  applyEntry(newEntry()); title.focus();
});
$("save-copy").addEventListener("click", async () => {
  entry = { ...entry, id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString() };
  savedChanges = -1;
  try { await persist(true); message("현재 내용을 새 임시글로 저장했어요."); } catch {}
});
$("export-markdown").addEventListener("click", () => exportFile(false));
$("export-backup").addEventListener("click", () => exportFile(true));
$("import-backup").addEventListener("click", () => { $("drafts-dialog").close(); $("backup-input").click(); });
$("backup-input").addEventListener("change", async event => { await importBackup(event.target.files[0]); event.target.value = ""; });
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault(); commitTags(); persist(true).catch(() => {});
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && mode === "rich" && editor.isFocused && !document.querySelector("dialog[open]")) {
    event.preventDefault(); openLink();
  }
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
    if (!restored) {
      const latest = (await listDrafts())[0];
      if (latest) restored = await readDraft(latest.id);
    }
    if (restored) applyEntry(restored);
  } catch { message("이 브라우저에서 임시저장을 사용할 수 없어요. 작성 후 파일로 보관해 주세요.", true); }
  ready = true;
  $("writer-fields").disabled = false;
  ["new-draft", "open-drafts", "preview-button", "save-button", "finish-button"].forEach(id => { $(id).disabled = false; });
  $("writer-loading").hidden = true;
  editor.setEditable(true, false);
  resizeTitle(); refreshCount(); updateTools();
}
applyEntry(entry);
start();
