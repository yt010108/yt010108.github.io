import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DashboardRepository, DashboardConflict } from "../src/dashboard-repository.js";
import { validateDashboard, dashboardText, faviconURL } from "../shared/dashboard.js";
import { parseContributionCalendar, contributionPeriod } from "../shared/github-activity.js";

const initial = JSON.parse(await readFile(new URL("../blog/dashboard.json", import.meta.url), "utf8"));
const token = "github_pat_" + "testonly".repeat(5);
const sha = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
const root = "/repos/yt010108/yt010108.github.io", path = root + "/contents/blog/dashboard.json";
function server() {
  const state = { text: dashboardText(initial), wrongUser: false, expired: false, race: false, lost: false, failure: false, calls: [] };
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher = async (value, options) => {
    const url = new URL(value), method = options.method, body = options.body && JSON.parse(options.body);
    state.calls.push({ path: url.pathname, method, body, headers: options.headers });
    if (state.expired) return reply({}, 401);
    if (url.pathname === "/user") return reply({ login: state.wrongUser ? "visitor" : "yt010108" });
    if (url.pathname === root) return reply({ full_name: "yt010108/yt010108.github.io", permissions: { push: true } });
    assert.equal(url.pathname, path, "Only the dashboard configuration may be changed");
    if (method === "GET") return reply({ sha: sha(state.text), encoding: "base64", content: Buffer.from(state.text).toString("base64") });
    assert.equal(method, "PUT");
    assert.equal(body.branch, "main");
    assert.equal(body.force, undefined);
    if (state.race) { state.text = dashboardText({ ...initial, memo: "다른 기기에서 변경" }); return reply({}, 409); }
    if (state.failure) return reply({}, 403);
    if (body.sha !== sha(state.text)) return reply({}, 409);
    state.text = Buffer.from(body.content, "base64").toString("utf8");
    if (state.lost) throw new TypeError("Response lost after success");
    return reply({ content: { sha: sha(state.text) }, commit: { sha: "c".repeat(40) } });
  };
  const client = () => new DashboardRepository({ fetcher, storage: null, persistentStorage: null });
  return { state, client };
}
test("Dashboard data is saved to GitHub and restored by a separate client without browser storage", async () => {
  const s = server(), first = s.client(), second = s.client();
  await first.connect(token);
  const snapshot = await first.readDashboard();
  const next = { ...snapshot.config, memo: "기기 간에 보이는 메모 📝", tasks: [{ id: crypto.randomUUID(), text: "보안 글 작성", done: true }] };
  const result = await first.saveDashboard(next, snapshot.sha);
  assert.equal(result.sha, sha(s.state.text));
  assert.equal(result.commit, "c".repeat(40));
  await second.connect(token);
  const restored = await second.readDashboard();
  assert.equal(restored.config.memo, next.memo);
  assert.deepEqual(restored.config.tasks, next.tasks);
  assert.deepEqual(restored.config.shortcuts, initial.shortcuts);
  assert.equal(s.state.calls.filter(call => call.method === "PUT").length, 1);
  assert.ok(!s.state.text.includes(token));
});
test("Dashboard saves reject stale versions before overwriting another device", async () => {
  const s = server(), a = s.client(), b = s.client(); await a.connect(token); await b.connect(token);
  const old = await a.readDashboard(), latest = await b.readDashboard();
  await b.saveDashboard({ ...latest.config, memo: "두 번째 기기의 메모" }, latest.sha);
  await assert.rejects(() => a.saveDashboard({ ...old.config, memo: "덮어쓰면 안 되는 메모" }, old.sha), DashboardConflict);
  assert.equal(JSON.parse(s.state.text).memo, "두 번째 기기의 메모");
  assert.equal(s.state.calls.filter(call => call.method === "PUT").length, 1);
});
test("A race during the dashboard write is handled as a conflict without a forced retry", async () => {
  const s = server(), client = s.client(); await client.connect(token); const old = await client.readDashboard(); s.state.race = true;
  await assert.rejects(() => client.saveDashboard({ ...old.config, memo: "내 수정" }, old.sha), DashboardConflict);
  assert.equal(JSON.parse(s.state.text).memo, "다른 기기에서 변경");
  assert.equal(s.state.calls.filter(call => call.method === "PUT").length, 1);
});
test("A lost successful dashboard response is reconciled against the exact Git blob", async () => {
  const s = server(), client = s.client(); await client.connect(token); const old = await client.readDashboard(); s.state.lost = true;
  const result = await client.saveDashboard({ ...old.config, memo: "저장은 완료됐음" }, old.sha);
  assert.equal(result.config.memo, "저장은 완료됐음"); assert.equal(result.sha, sha(s.state.text));
  assert.equal(s.state.calls.filter(call => call.method === "PUT").length, 1);
});
test("Dashboard writes require verified owner authentication and leave data intact on failure", async () => {
  const s = server(), client = s.client();
  await assert.rejects(() => client.saveDashboard(initial, sha(s.state.text)), /관리자/);
  s.state.wrongUser = true; await assert.rejects(() => client.connect(token), /yt010108/); assert.equal(client.connected, false);
  s.state.wrongUser = false; await client.connect(token); const old = await client.readDashboard(); s.state.failure = true;
  await assert.rejects(() => client.saveDashboard({ ...initial, memo: "미발행 수정" }, old.sha), /권한/);
  assert.equal(s.state.text, dashboardText(initial));
  s.state.expired = true; await assert.rejects(() => client.readDashboard(), /만료/); assert.equal(client.connected, false);
});
test("Dashboard validation rejects executable URLs, credentials, duplicates and oversized text", () => {
  const change = url => ({ ...initial, shortcuts: [{ ...initial.shortcuts[0], url }] });
  for (const url of ["javascript:alert(1)", "data:text/html,<script>", "file:///private", "https://user:password@example.com/"]) assert.throws(() => validateDashboard(change(url)));
  assert.throws(() => validateDashboard({ ...initial, memo: "a".repeat(20001) }));
  assert.throws(() => validateDashboard({ ...initial, shortcuts: [initial.shortcuts[0], initial.shortcuts[0]] }));
  const clean = validateDashboard({ ...initial, token: "must never be persisted", extra: "not in schema" });
  assert.equal(clean.token, undefined); assert.equal(clean.extra, undefined);
  const icon = new URL(faviconURL("https://example.com/private?secret=excluded"));
  assert.equal(icon.searchParams.get("domain"), "example.com"); assert.ok(!icon.href.includes("secret"));
});
test("GitHub calendar parsing preserves real dates, levels and tooltip counts without executing markup", () => {
  const days = Array.from({ length: 365 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 9, 26 + i)).toISOString().slice(0, 10);
    return '<td data-date="' + date + '" id="day-' + i + '" data-level="' + (i % 5) + '"></td><tool-tip for="day-' + i + '">' + (i ? i + " contributions" : "No contributions") + ' on date.</tool-tip>';
  });
  const result = parseContributionCalendar(days.reverse().join("\n"));
  assert.equal(result.days.length, 365); assert.equal(result.days[0].date, "2025-10-26"); assert.equal(result.days[0].count, 0); assert.equal(result.days.at(-1).count, 364);
  assert.throws(() => parseContributionCalendar("<script>fake()</script>"), /모두/);
  assert.throws(() => parseContributionCalendar(days.join("\n") + days[0]), /날짜/);
});
test("Half-year views show six calendar months and preserve unknown dates instead of fabricating activity", () => {
  const days = Array.from({ length: 366 }, (_, index) => ({ date: new Date(Date.UTC(2025, 9, 26 + index)).toISOString().slice(0, 10), level: index % 5, count: index }));
  const period = contributionPeriod(days);
  assert.equal(period.label, "2026년 7–12월"); assert.equal(period.start, "2026-07-01"); assert.equal(period.end, "2026-12-31");
  assert.equal(period.weeks, 27); assert.deepEqual(period.labels.map(label => label.month), [7, 8, 9, 10, 11, 12]);
  assert.equal(period.cells.find(day => day.date === "2026-07-01").state, "recorded");
  assert.equal(period.cells.find(day => day.date === "2026-10-27").state, "pending");
  assert.equal(period.cells.find(day => day.date === "2026-10-27").level, undefined);
  assert.equal(period.previous, "2026-01-01"); assert.equal(period.next, null);
  const oldest = contributionPeriod(days, 6, "2025-07-01");
  assert.equal(oldest.previous, null); assert.equal(oldest.cells.find(day => day.date === "2025-07-01").state, "unavailable");
  assert.equal(contributionPeriod(days, 6, "2020-01-01").start, oldest.start);
});
test("Quarter views align weekdays across leap years and clamp forward navigation to the latest data", () => {
  const days = [{ date: "2023-12-31", level: 0, count: 0 }, { date: "2024-02-29", level: 3, count: 7 }];
  const period = contributionPeriod(days, 3);
  assert.equal(period.start, "2024-01-01"); assert.equal(period.end, "2024-03-31");
  assert.equal(period.cells.filter(day => day.state !== "padding").length, 91);
  assert.equal(period.cells.findIndex(day => day.date === "2024-01-01") % 7, 1);
  assert.equal(period.cells.findIndex(day => day.date === "2024-02-29") % 7, 4);
  assert.equal(period.cells.find(day => day.date === "2024-02-29").count, 7);
  assert.equal(period.previous, "2023-10-01"); assert.equal(period.next, null);
  assert.equal(contributionPeriod(days, 3, "2030-01-01").start, period.start);
  assert.throws(() => contributionPeriod(days, 12), /기간/);
});
