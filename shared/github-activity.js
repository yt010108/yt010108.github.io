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
