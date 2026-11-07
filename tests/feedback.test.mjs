import test from "node:test";
import assert from "node:assert/strict";
import { feedbackFor } from "../admin/src/feedback.js";
import reviews from "../admin/src/feedback-data.json" with { type: "json" };

test("Feedback matches stable post IDs and keeps similarly named CSRF articles separate", () => {
  const memo = feedbackFor("3e148b7f-e5d3-4645-9fbf-bfa8390c56d1");
  const lab = feedbackFor("dc96d36d-f017-54d3-bc3a-b3c769d5ee47");
  assert.equal(memo.original_title, "CSRF");
  assert.equal(lab.original_title, "[DVWA] CSRF");
  assert.notEqual(memo.next_edit, lab.next_edit);
  assert.equal(feedbackFor(crypto.randomUUID()), undefined, "A new or duplicated article has no inherited review");
  for (const [id, review] of Object.entries(reviews)) {
    assert.equal(review.id, id);
    assert.ok(review.strength && review.next_edit);
    assert.equal(new URL(review.url).hostname, "yt010108.github.io");
    for (const related of review.related) assert.ok(feedbackFor(related), "Related feedback entry must exist");
  }
});
