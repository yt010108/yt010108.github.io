export function validateTaxonomy(value) {
  if (!value || typeof value !== "object") throw new Error("분류 목록 형식을 확인해 주세요.");
  for (const [type, limit] of [["categories", 100], ["series", 100], ["tags", 80]]) {
    if (type === "series" && value[type] === undefined) continue;
    const values = value[type];
    if (!Array.isArray(values) || values.length > 1000 || new Set(values).size !== values.length || values.some(name => typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > limit)) throw new Error("분류 이름과 목록을 확인해 주세요.");
  }
  return value;
}

export function taxonomyOptions(index, drafts = []) {
  return Object.fromEntries(["categories", "series", "tags"].map(type => [type, [...new Set([
    ...(index.taxonomy?.[type] || []),
    ...[...(index.entries || []), ...drafts].flatMap(entry => type === "tags" ? entry.tags || [] : [entry[type === "categories" ? "category" : "series"]])
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"))]));
}

export const usesTaxonomy = (entry, type, name) => type === "tags" ? (entry.tags || []).includes(name) : entry[type === "categories" ? "category" : "series"] === name;
export function replaceTaxonomy(entry, type, name, replacement) {
  if (type === "categories") return { ...entry, category: entry.category === name ? replacement : entry.category };
  if (type === "series") return { ...entry, series: entry.series === name ? replacement : entry.series };
  if (type === "tags") return { ...entry, tags: [...new Set((entry.tags || []).map(tag => tag === name ? replacement : tag).filter(Boolean))] };
  throw new Error("분류 종류를 확인해 주세요.");
}
