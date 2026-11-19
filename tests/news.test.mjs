import assert from "node:assert/strict";
import test from "node:test";
import { selectNews } from "../src/news.js";

test("News prioritizes KISA, groups related reports and retains additional archive entries", () => {
  const hosts = { kisa: "www.boho.or.kr", dailysecu: "www.dailysecu.com", boannews: "www.boannews.com" };
  const make = (source, n, published, refs = [], eligible = true) => ({
    source, id: source + "-" + n, title: "기사 " + n, url: "https://" + hosts[source] + "/article/" + n,
    published, day: published.slice(0,10), eligible, refs
  });
  const kisa = make("kisa", 1, "2026-11-19", ["CVE-2025-4321"]);
  const related = make("dailysecu", 2, "2026-11-19T18:00", ["CVE-2025-4321"], false);
  const second = make("boannews", 3, "2026-11-19T17:00");
  const third = make("dailysecu", 4, "2026-11-19T16:00");
  const fourth = make("boannews", 5, "2026-11-19T14:00");
  const past = make("dailysecu", 7, "2026-11-18T19:00");
  const unsafe = { ...second, id: "boannews-9", url: "javascript:alert(1)" };
  const days = selectNews([fourth, third, related, past, second, kisa, second, unsafe]);
  assert.deepEqual([...days.keys()], ["2026-11-19", "2026-11-18"]);
  assert.deepEqual(days.get("2026-11-19"), [[kisa, related], [second], [third], [fourth]]);
  assert.deepEqual(days.get("2026-11-18"), [[past]]);
  const followUp = make("boannews", 8, "2026-11-20T09:00", ["CVE-2025-4321"]);
  const updated = selectNews([kisa, related, followUp]);
  assert.deepEqual([...updated.keys()], ["2026-11-20"]);
  assert.deepEqual(updated.get("2026-11-20")[0], [followUp, kisa, related]);
});
