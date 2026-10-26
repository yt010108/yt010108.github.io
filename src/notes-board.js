import { esc, plainText } from "../shared/posts.js";
import { normalizeBoard, arrangeNotes, toggleNotePin, moveNote } from "../shared/note-board.js";

const STORAGE_KEY = "yt010108-notes-board-v1";
let memory = normalizeBoard(), active, temporary = false;
const icons = {
  pin: '<path d="m16 3 5 5-4 1-3 5v3l-2 2-7-7 2-2h3l5-3zM2 22l5-5"/>',
  move: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  edit: '<path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const read = () => {
  if (temporary) return normalizeBoard(memory);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length < 1000000) memory = normalizeBoard(JSON.parse(raw));
  } catch { /* Keep the in-memory arrangement when browser storage is unavailable. */ }
  return normalizeBoard(memory);
};
function save(state) {
  memory = normalizeBoard(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)); temporary = false; return true; } catch { temporary = true; return false; }
}
function excerpt(note) {
  const text = note.description?.trim() || (note.doc ? plainText(note.doc) : (note.body || []).map(block => block.text || block.items?.join("\n") || block.code || "").join("\n"));
  return String(text || "").trim().replace(/\n{3,}/g, "\n\n").slice(0, 450);
}
function cards(notes, state) {
  return arrangeNotes(notes, state).map(note => {
    const pinned = state.pinned.includes(note.id), text = excerpt(note);
    const tone = (Number.parseInt(note.id.slice(0, 8), 16) || 0) % 3;
    const url = "#/note/" + encodeURIComponent(note.id);
    const label = note.category || note.tags?.[0] || "메모";
    return `<article class="note-card note-tone-${tone}" data-note-id="${esc(note.id)}"><div class="note-card-tools"><button type="button" class="note-icon note-move" data-note-action="move" aria-label="${esc(note.title)} 다음 위치로 이동" title="끌어서 이동 · 클릭하면 다음 위치">${icon("move")}</button><span class="note-kind">${esc(label)}</span><a class="note-icon" href="admin/#edit-note/${encodeURIComponent(note.id)}" aria-label="${esc(note.title)} 관리자에서 수정" title="관리자에서 수정">${icon("edit")}</a><button type="button" class="note-icon note-pin" data-note-action="pin" aria-pressed="${pinned}" aria-label="${esc(note.title)} ${pinned ? "고정 해제" : "고정"}" title="${pinned ? "고정 해제" : "앞쪽에 고정"}">${icon("pin")}</button></div><a class="note-content-link" href="${url}"><h2>${esc(note.title)}</h2><p class="note-excerpt${text ? "" : " note-excerpt--empty"}">${esc(text || "아직 본문이 없는 메모예요.")}</p></a><footer class="note-card-footer"><time datetime="${esc(note.date)}">${esc(note.date.replaceAll("-", "."))}</time><a href="${url}" aria-label="${esc(note.title)} 읽기">↗</a></footer></article>`;
  }).join("");
}

function html(notes) {
  const state = read();
  const pinned = notes.filter(note => state.pinned.includes(note.id)).length;
  return `<section class="notes-board" data-notes-board aria-label="메모 보드"><div class="notes-board-toolbar"><span>나의 메모 <span class="notes-board-count" data-note-count>${notes.length}개 · 고정 ${pinned}개</span></span><span class="notes-board-hint">${icon("move")} 끌어서 생각 정리</span></div><div class="notes-canvas"><div class="notes-grid" data-note-grid>${notes.length ? cards(notes, state) : '<div class="empty-state"><p>표시할 메모가 없어요.</p><a class="text-link" href="#/notes">전체 메모 보기</a></div>'}</div></div><p class="notes-board-save" data-note-status role="status" aria-live="polite">배치와 고정은 이 브라우저에 저장돼요.</p></section>`;
}

function unmount() { active?.controller.abort(); active = null; }
function mount(root, allNotes) {
  unmount();
  if (!root) return;
  const controller = new AbortController(), signal = controller.signal;
  const visible = new Set([...root.querySelectorAll("[data-note-id]")].map(node => node.dataset.noteId));
  const notes = allNotes.filter(note => visible.has(note.id));
  let state = read(), dragging, suppressClick = false;
  const message = text => { root.querySelector("[data-note-status]").textContent = text; };
  function redraw(focus) {
    const grid = root.querySelector("[data-note-grid]");
    if (notes.length) grid.innerHTML = cards(notes, state);
    root.querySelector("[data-note-count]").textContent = notes.length + "개 · 고정 " + notes.filter(note => state.pinned.includes(note.id)).length + "개";
    if (focus) root.querySelector('[data-note-id="' + focus.id + '"] [data-note-action="' + focus.action + '"]')?.focus({ preventScroll: true });
  }
  function commit(next, text, focus) {
    const normalized = normalizeBoard(next), ordered = arrangeNotes(allNotes, normalized).map(note => note.id), known = new Set(ordered);
    state = normalizeBoard({ order: [...ordered, ...normalized.order.filter(id => !known.has(id))], pinned: normalized.pinned });
    const saved = save(state);
    redraw(focus);
    message(saved ? text + " 이 브라우저에 저장했어요." : text + " 브라우저 저장 공간을 사용할 수 없어 현재 화면에만 유지돼요.");
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-note-action]");
    if (!button) return;
    const id = button.closest("[data-note-id]").dataset.noteId, action = button.dataset.noteAction;
    if (action === "move" && suppressClick) { suppressClick = false; event.preventDefault(); return; }
    if (action === "pin") commit(toggleNotePin(state, id), "메모 고정을 변경했어요.", { id, action });
    if (action === "move") {
      const group = arrangeNotes(notes, state).filter(note => state.pinned.includes(note.id) === state.pinned.includes(id));
      if (group.length < 2) { message("같은 그룹의 메모가 하나여서 현재 위치를 유지해요."); return; }
      const next = group[(group.findIndex(note => note.id === id) + 1) % group.length];
      commit(moveNote(allNotes, state, id, next.id), "메모를 옮겼어요.", { id, action });
    }
  }, { signal });
  root.addEventListener("pointerdown", event => {
    const handle = event.target.closest('[data-note-action="move"]');
    if (!handle || event.button !== 0) return;
    dragging = { id: handle.closest("[data-note-id]").dataset.noteId, pointer: event.pointerId, handle, x: event.clientX, y: event.clientY, moved: false, target: null };
    handle.setPointerCapture(event.pointerId);
  }, { signal });
  root.addEventListener("pointermove", event => {
    if (!dragging || dragging.pointer !== event.pointerId) return;
    if (!dragging.moved && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) < 6) return;
    dragging.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-note-id]");
    root.querySelectorAll("[data-note-over]").forEach(node => delete node.dataset.noteOver);
    dragging.target = target && root.contains(target) ? target.dataset.noteId : null;
    if (dragging.target && dragging.target !== dragging.id) target.dataset.noteOver = "true";
  }, { signal });
  root.addEventListener("pointerup", event => {
    const drag = dragging;
    if (!drag || drag.pointer !== event.pointerId) return;
    dragging = null;
    if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      if (drag.target && drag.target !== drag.id) commit(moveNote(allNotes, state, drag.id, drag.target), "메모를 옮겼어요.", { id: drag.id, action: "move" });
    }
    root.querySelectorAll("[data-note-over]").forEach(node => delete node.dataset.noteOver);
  }, { signal });
  root.addEventListener("pointercancel", () => { dragging = null; root.querySelectorAll("[data-note-over]").forEach(node => delete node.dataset.noteOver); }, { signal });
  active = { controller, root, refresh() { state = read(); redraw(); } };
}
window.addEventListener("storage", event => { if ((event.key === STORAGE_KEY || event.key === null) && active?.root.isConnected) { temporary = false; if (event.newValue === null) memory = normalizeBoard(); active.refresh(); } });
window.NotesBoard = { html, mount, unmount, newLink: '<a class="notes-new" href="admin/#new-note">' + icon("plus") + '<span>새 메모</span></a>' };
