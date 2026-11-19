import { esc } from "../shared/posts.js";

const publishers = { kisa: "보호나라", dailysecu: "데일리시큐", boannews: "보안뉴스" };
const hosts = { kisa: "www.boho.or.kr", dailysecu: "www.dailysecu.com", boannews: "www.boannews.com" };
const readPrefix = "yt010108.news.read.";
const sessionRead = new Map();
const koreanDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });
const koreanTime = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
let view, data, pending, lastPayload = "", connectionError = "";

function validArticle(a) {
  if (!a || !Object.hasOwn(hosts, a.source) || typeof a.title !== "string" || !a.title.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(a.day) || typeof a.published !== "string" ||
      !new RegExp("^" + a.source + "-[0-9]+$").test(a.id)) return false;
  try {
    const url = new URL(a.url);
    return url.protocol === "https:" && url.host === hosts[a.source] && !url.username && !url.password;
  } catch { return false; }
}

function byPriority(a, b) {
  return Number(b.source === "kisa") - Number(a.source === "kisa") ||
    Number(b.eligible) - Number(a.eligible) || b.published.localeCompare(a.published) || a.id.localeCompare(b.id);
}

export function selectNews(articles) {
  const unique = new Map(articles.filter(validArticle).map(a => [a.id, a]));
  const groups = [], evidence = new Map();
  for (const article of [...unique.values()].sort(byPriority)) {
    const refs = (Array.isArray(article.refs) ? article.refs : []).filter(ref =>
      typeof ref === "string" && /^(?:CVE-\d{4}-\d{4,}|(?:kisa|boannews|dailysecu)-\d+)$/.test(ref));
    const keys = [article.id, ...refs, article.published.slice(0,10) + ":" + article.title.replace(/\s+/g, "").toLowerCase()];
    const matches = new Set(keys.flatMap(key => [...(evidence.get(key) || [])]));
    // A broad retrospective can cite several different incidents. Only merge an unambiguous match.
    let group = matches.size === 1 && article.source !== "kisa" ? [...matches][0] : null;
    if (!group) { group = []; groups.push(group); }
    group.push(article);
    for (const key of keys) {
      if (!evidence.has(key)) evidence.set(key, new Set());
      evidence.get(key).add(group);
    }
  }
  const days = new Map();
  for (const group of groups) {
    // A later exploitation report can update an older patch advisory. Keep one issue
    // and show the qualifying update under its own date, with the advisory linked.
    const latest = group.filter(a => a.eligible).sort((a, b) => b.day.localeCompare(a.day) || byPriority(a, b))[0];
    if (!latest) continue;
    const day = latest.day;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push([latest, ...group.filter(a => a !== latest)]);
  }
  for (const picks of days.values()) picks.sort((a, b) => byPriority(a[0], b[0]));
  return new Map([...days].sort(([a], [b]) => b.localeCompare(a)));
}

function isRead(group) {
  return group.some(({ id }) => {
    if (sessionRead.has(id)) return sessionRead.get(id);
    try { return localStorage.getItem(readPrefix + id) === "1"; } catch { return false; }
  });
}

function setRead(group, checked) {
  for (const { id } of group) {
    try {
      if (checked) localStorage.setItem(readPrefix + id, "1");
      else localStorage.removeItem(readPrefix + id);
      sessionRead.delete(id);
    } catch { sessionRead.set(id, checked); }
  }
}

function storyRow(group) {
  const [article, ...others] = group;
  const checked = isRead(group);
  const related = new Map();
  for (const report of others) if (!related.has(report.source)) related.set(report.source, report);
  const links = [...related.values()].map(report => '<a href="' + esc(report.url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(publishers[report.source] + " · " + report.title) + '">' + publishers[report.source] + ' ↗</a>');
  return '<li class="news-story"><label class="news-check"><input type="checkbox" data-news-read="' + esc(article.id) + '"' + (checked ? " checked" : "") +
    ' aria-label="' + esc(article.title + (checked ? " 읽음 해제" : " 읽음 표시")) + '"></label><span class="news-source" data-source="' + article.source + '">' + publishers[article.source] +
    '</span><div><a class="news-title" href="' + esc(article.url) + '" target="_blank" rel="noopener noreferrer">' + esc(article.title) + ' <span aria-hidden="true">↗</span></a>' +
    (links.length ? '<div class="news-related">관련 자료 · ' + links.join(" · ") + '</div>' : "") + '</div></li>';
}

function list(groups) {
  return '<ul class="news-stories">' + groups.map(storyRow).join("") + '</ul>';
}

function paint() {
  if (!view?.root.isConnected) return;
  const today = koreanDay.format(new Date());
  view.day = today;
  const stamp = data?.lastComplete ? '<time datetime="' + esc(data.lastComplete) + '">' + esc(koreanTime.format(new Date(data.lastComplete))) + ' KST</time>' : "";
  const meta = stamp ? '<p class="news-meta">마지막 수집 ' + stamp + '</p>' : "";
  const failed = (data?.failed || []).map(source => publishers[source]).filter(Boolean);
  const warning = connectionError || (failed.length ? failed.join(" · ") + " 수집 지연" : "");
  const status = warning ? '<p class="news-meta" role="status">' + esc(warning) + '</p>' : "";
  const waiting = !data && !warning ? '<p class="news-meta" role="status">뉴스를 불러오는 중…</p>' : "";
  if (view.root.dataset.news === "today") {
    const picks = (data?.days.get(today) || []).slice(0, 3);
    const visible = picks.filter(group => !isRead(group));
    const empty = picks.length ? "오늘 소식을 모두 읽었어요." : "오늘 수집한 주요 소식이 없어요.";
    view.root.innerHTML = '<div class="news-head"><h3>오늘의 뉴스</h3><a class="dashboard-text-link" href="#/news?view=all">전체 보기 →</a></div>' +
      meta + status + waiting + (visible.length ? list(visible) : data ? '<p class="news-empty">' + empty + '</p>' : "");
    return;
  }
  const groups = data ? [...data.days.values()].flat() : [];
  const unread = groups.filter(group => !isRead(group));
  const sections = [];
  for (const [day, picks] of data?.days || []) {
    const visible = view.all ? picks : picks.filter(group => !isRead(group));
    if (visible.length) sections.push('<section class="news-date"><h2>' + (day === today ? "오늘 · " : "") + esc(day.replaceAll("-", ".")) + '</h2>' + list(visible) + '</section>');
  }
  view.root.innerHTML = '<div class="news-head"><h1>News</h1>' + meta + '</div>' + status + waiting +
    '<nav class="news-filters" aria-label="읽음 상태"><a href="#/news"' + (!view.all ? ' aria-current="page"' : "") + '>안 읽음 ' + unread.length +
    '</a><a href="#/news?view=all"' + (view.all ? ' aria-current="page"' : "") + '>전체 ' + groups.length + '</a></nav>' +
    (sections.join("") || (data ? '<p class="news-empty">' + (view.all ? "수집한 주요 소식이 없어요." : "안 읽은 소식이 없어요.") + '</p>' : ""));
}

export function refreshNews() {
  if (!view || pending) return pending;
  pending = (async () => {
    const previousError = connectionError;
    let changed = false;
    try {
      const response = await fetch("assets/security-news.json", { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("News request failed");
      const text = await response.text();
      if (lastPayload !== text) {
        const value = JSON.parse(text);
        if (value.version !== 1 || !Array.isArray(value.articles) || !Array.isArray(value.failed) ||
            (value.lastComplete != null && !Number.isFinite(Date.parse(value.lastComplete)))) throw new Error("Invalid news archive");
        data = { days: selectNews(value.articles), lastComplete: value.lastComplete, failed: value.failed };
        lastPayload = text; changed = true;
      }
      connectionError = "";
    } catch { connectionError = "뉴스 목록을 불러오지 못했어요."; }
    finally {
      pending = null;
      if (changed || previousError !== connectionError || view?.day !== koreanDay.format(new Date())) paint();
    }
  })();
  return pending;
}

export function mountNews(root, all) {
  view?.controller.abort();
  view = null;
  if (!root) return;
  const controller = new AbortController();
  view = { root, all, controller };
  root.addEventListener("change", event => {
    const input = event.target;
    if (!input.matches("input[data-news-read]") || !data) return;
    const group = [...data.days.values()].flat().find(pick => pick[0].id === input.dataset.newsRead);
    if (!group) return;
    const index = [...root.querySelectorAll("[data-news-read]")].indexOf(input);
    setRead(group, input.checked);
    paint();
    const inputs = root.querySelectorAll("[data-news-read]");
    (inputs[Math.min(index, inputs.length - 1)] || root.querySelector("a"))?.focus({ preventScroll: true });
  }, { signal: controller.signal });
  window.addEventListener("storage", event => {
    if (event.key === null || event.key.startsWith(readPrefix)) paint();
  }, { signal: controller.signal });
  paint();
  refreshNews();
}
