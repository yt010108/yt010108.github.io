const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(value);
const ids = value => Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, 5000) : [];

export function normalizeBoard(value) {
  return { version: 1, order: ids(value?.order), pinned: ids(value?.pinned) };
}

export function arrangeNotes(notes, value) {
  const state = normalizeBoard(value), entries = new Map(notes.map(note => [note.id, note]));
  const known = new Set(state.order), pinned = new Set(state.pinned);
  const ordered = [...notes.filter(note => !known.has(note.id)), ...state.order.map(id => entries.get(id)).filter(Boolean)];
  return ordered.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
}

export function toggleNotePin(value, id) {
  const state = normalizeBoard(value);
  if (!validId(id)) return state;
  const pinned = state.pinned.includes(id) ? state.pinned.filter(item => item !== id) : [id, ...state.pinned];
  return normalizeBoard({ order: [id, ...state.order.filter(item => item !== id)], pinned });
}

export function moveNote(notes, value, source, target) {
  const state = normalizeBoard(value), ordered = arrangeNotes(notes, state).map(note => note.id);
  const from = ordered.indexOf(source), to = ordered.indexOf(target);
  if (from < 0 || to < 0 || from === to) return state;
  ordered.splice(from, 1); ordered.splice(to, 0, source);
  return normalizeBoard({ order: [...ordered, ...state.order.filter(id => !ordered.includes(id))], pinned: state.pinned });
}
