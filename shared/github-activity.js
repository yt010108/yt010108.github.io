const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function validateActivity(value) {
  if (value?.format !== "yt010108-github-activity" || value.version !== 1 || value.user !== "yt010108" || typeof value.available !== "boolean" || !Array.isArray(value.days) || value.days.length > 400 || !Number.isFinite(Date.parse(value.fetchedAt))) throw new Error("GitHub 활동 형식이 올바르지 않아요.");
  const dates = new Set();
  const days = value.days.map(day => {
    if (!datePattern.test(day.date) || !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date || dates.has(day.date) || !Number.isInteger(day.level) || day.level < 0 || day.level > 4 || !(day.count === null || (Number.isInteger(day.count) && day.count >= 0 && day.count <= 100000))) throw new Error("GitHub 활동 날짜가 올바르지 않아요.");
    dates.add(day.date); return { date: day.date, level: day.level, count: day.count };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (value.available && days.length < 300) throw new Error("GitHub 활동을 모두 읽지 못했어요.");
  return { format: value.format, version: 1, user: value.user, available: value.available, fetchedAt: value.fetchedAt, days };
}
export function parseContributionCalendar(html, fetchedAt = new Date().toISOString()) {
  const tips = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)) {
    const id = /\bfor="([^"]+)"/.exec(match[1])?.[1], label = match[2].replace(/<[^>]*>/g, "").trim();
    const number = /^([\d,]+) contributions?\b/i.exec(label);
    if (id) tips.set(id, /^No contributions\b/i.test(label) ? 0 : number ? Number(number[1].replaceAll(",", "")) : null);
  }
  const days = [];
  for (const match of html.matchAll(/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/gi)) {
    const attrs = match[0], level = /\bdata-level="([0-4])"/.exec(attrs), id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (level) days.push({ date: match[1], level: Number(level[1]), count: tips.get(id) ?? null });
  }
  return validateActivity({ format: "yt010108-github-activity", version: 1, user: "yt010108", available: true, fetchedAt, days });
}

const dayMillis = 86400000;
const isoDate = date => date.toISOString().slice(0, 10);
export function contributionPeriod(days, months = 6, anchor = days.at(-1)?.date) {
  if (![3, 6].includes(months) || !days.length || !datePattern.test(anchor) || !Number.isFinite(Date.parse(anchor))) throw new Error("기여도 표시 기간이 올바르지 않아요.");
  const startOf = value => { const date = new Date(value + "T00:00:00Z"); return isoDate(new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / months) * months, 1))); };
  const earliest = startOf(days[0].date), latest = startOf(days.at(-1).date);
  const start = [earliest, startOf(anchor), latest].sort()[1];
  const date = new Date(start + "T00:00:00Z"), year = date.getUTCFullYear(), firstMonth = date.getUTCMonth();
  const end = isoDate(new Date(Date.UTC(year, firstMonth + months, 0))), prefix = date.getUTCDay();
  const length = Math.round((Date.parse(end) - Date.parse(start)) / dayMillis) + 1, weeks = Math.ceil((prefix + length) / 7);
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const value = isoDate(new Date(Date.parse(start) + (index - prefix) * dayMillis));
    if (value < start || value > end) return { date: value, state: "padding" };
    const day = byDate.get(value);
    return day ? { ...day, state: "recorded" } : { date: value, state: value > days.at(-1).date ? "pending" : "unavailable" };
  });
  const labels = Array.from({ length: months }, (_, index) => {
    const monthStart = Date.UTC(year, firstMonth + index, 1);
    return { month: firstMonth + index + 1, column: Math.floor((prefix + Math.round((monthStart - Date.parse(start)) / dayMillis)) / 7) + 1 };
  });
  return { start, end, weeks, months, labels, cells, label: year + "년 " + (firstMonth + 1) + "–" + (firstMonth + months) + "월", previous: start > earliest ? isoDate(new Date(Date.UTC(year, firstMonth - months, 1))) : null, next: start < latest ? isoDate(new Date(Date.UTC(year, firstMonth + months, 1))) : null };
}
