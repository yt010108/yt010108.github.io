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
export function recentContributions(days, months = 4) {
  if (!Array.isArray(days) || !days.length || !Number.isInteger(months) || months < 1 || months > 12) throw new Error("기여도 표시 기간이 올바르지 않아요.");
  const end = days.at(-1).date, latest = new Date(end + "T00:00:00Z");
  if (!datePattern.test(end) || !Number.isFinite(latest.getTime())) throw new Error("기여도 날짜가 올바르지 않아요.");
  const date = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - months + 1, 1));
  const start = isoDate(date), year = date.getUTCFullYear(), firstMonth = date.getUTCMonth(), prefix = date.getUTCDay();
  const length = Math.round((Date.parse(end) - Date.parse(start)) / dayMillis) + 1, weeks = Math.ceil((prefix + length) / 7);
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const value = isoDate(new Date(Date.parse(start) + (index - prefix) * dayMillis));
    if (value < start || value > end) return { date: value, state: "padding" };
    const day = byDate.get(value);
    return day ? { ...day, state: "recorded" } : { date: value, state: "unavailable" };
  });
  const labels = Array.from({ length: months }, (_, index) => {
    const monthStart = Date.UTC(year, firstMonth + index, 1);
    return { month: new Date(monthStart).getUTCMonth() + 1, column: Math.floor((prefix + Math.round((monthStart - Date.parse(start)) / dayMillis)) / 7) + 1 };
  });
  return { start, end, weeks, months, labels, cells };
}

export function contributionsForWidth(days, width) {
  if (!Number.isFinite(width) || width <= 0) throw new Error("기여도 표시 너비가 올바르지 않아요.");
  // Keep the original 12px cells, 3px gaps, and 32px weekday gutter.
  const availableWeeks = Math.max(1, Math.floor((width - 32 + 3) / 15));
  const period = recentContributions(days, 12), weeks = Math.min(availableWeeks, period.weeks), offset = period.weeks - weeks;
  const cells = period.cells.slice(offset * 7), visible = cells.filter(day => day.state !== "padding"), start = visible[0].date;
  const labels = period.labels.filter(label => label.column > offset).map(label => ({ ...label, column: label.column - offset }));
  const firstMonth = new Date(start).getUTCMonth() + 1;
  if (!labels.length || labels[0].month !== firstMonth && labels[0].column > 1) labels.unshift({ month: firstMonth, column: 1 });
  return { ...period, start, weeks, cells, labels, months: new Set(visible.map(day => day.date.slice(0, 7))).size };
}
