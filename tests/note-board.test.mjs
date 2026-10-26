import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBoard, arrangeNotes, toggleNotePin, moveNote } from "../shared/note-board.js";

const notes = ["new", "a", "b", "c", "d"].map(id => ({ id, title: id }));

test("Newly published notes appear while the saved manual order survives refresh", () => {
  const saved = { order: ["c", "a", "b", "d", "removed"], pinned: [] };
  assert.deepEqual(arrangeNotes(notes, saved).map(note => note.id), ["new", "c", "a", "b", "d"]);
  assert.deepEqual(arrangeNotes(notes.filter(note => ["a", "c"].includes(note.id)), saved).map(note => note.id), ["c", "a"]);
});

test("Pinning and unpinning never change note content or remove other saved pins", () => {
  const snapshot = structuredClone(notes);
  let state = toggleNotePin({ order: notes.map(note => note.id), pinned: ["c"] }, "b");
  assert.deepEqual(arrangeNotes(notes, state).map(note => note.id), ["b", "c", "new", "a", "d"]);
  state = toggleNotePin(state, "b");
  assert.deepEqual(state.pinned, ["c"]);
  assert.deepEqual(notes, snapshot);
});

test("Moving filtered cards preserves hidden notes and old saved IDs", () => {
  const saved = { order: ["new", "a", "b", "c", "d", "temporarily-absent"], pinned: ["d"] };
  const next = moveNote(notes, saved, "c", "a");
  assert.deepEqual(arrangeNotes(notes, next).map(note => note.id), ["d", "new", "c", "a", "b"]);
  assert.ok(next.order.includes("temporarily-absent"));
  assert.deepEqual(next.pinned, ["d"]);
  assert.deepEqual(moveNote(notes, next, "missing", "a"), next);
});

test("Invalid browser state is normalized without admitting markup or duplicate IDs", () => {
  assert.deepEqual(normalizeBoard({ order: ["a", "a", "<img>", null, 7], pinned: "all" }), { version: 1, order: ["a"], pinned: [] });
  assert.deepEqual(normalizeBoard(null), { version: 1, order: [], pinned: [] });
  assert.deepEqual(toggleNotePin({}, '\" onclick=alert(1)'), { version: 1, order: [], pinned: [] });
});
