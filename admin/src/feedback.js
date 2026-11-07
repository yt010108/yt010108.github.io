import reviews from "./feedback-data.json" with { type: "json" };
import { esc } from "../../shared/posts.js";

export const feedbackFor = id => reviews[id];

export function showFeedback(item) {
  const review = feedbackFor(item.id);
  if (!review) return;
  document.getElementById("feedback-post-title").textContent = item.title || review.original_title;
  const section = (title, text) => `<section><h4>${esc(title)}</h4><p>${esc(text)}</p></section>`;
  document.getElementById("feedback-content").innerHTML =
    section("잘된 점", review.strength) + section("보완할 점", review.next_edit) +
    '<section><h4>아카이브 정리 제안</h4><dl>' + [
      ["제목", review.recommended_title], ["글 종류", review.recommended_kind],
      ["주제", review.recommended_topic], ["태그", review.recommended_tags.join(" · ") || "없음"]
    ].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("") + '</dl></section>' +
    (review.related.length ? '<section><h4>함께 연결하면 좋은 글</h4><ul>' + review.related.map(id => {
      const other = feedbackFor(id);
      return other ? `<li><a href="${esc(other.url)}" target="_blank" rel="noopener noreferrer">${esc(other.original_title)} ↗</a></li>` : "";
    }).join("") + '</ul></section>' : "");
  const dialog = document.getElementById("feedback-dialog");
  dialog.showModal();
  dialog.scrollTop = 0;
}
