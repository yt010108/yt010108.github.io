export function validateTaxonomy(value) {
  if (!value || typeof value !== "object") throw new Error("분류 목록 형식을 확인해 주세요.");
  for (const [type, limit] of [["categories", 100], ["tags", 80]]) {
    const values = value[type];
    if (!Array.isArray(values) || values.length > 1000 || new Set(values).size !== values.length || values.some(name => typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > limit)) throw new Error("분류 이름과 목록을 확인해 주세요.");
  }
  return value;
}

export function taxonomyOptions(index, drafts = []) {
  return Object.fromEntries(["categories", "tags"].map(type => [type, [...new Set([
    ...(index.taxonomy?.[type] || []),
    ...[...(index.entries || []), ...drafts].flatMap(entry => type === "categories" ? [entry.category] : entry.tags || [])
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"))]));
}

export const usesTaxonomy = (entry, type, name) => type === "categories" ? entry.category === name : (entry.tags || []).includes(name);
export function replaceTaxonomy(entry, type, name, replacement) {
  if (type === "categories") return { ...entry, category: entry.category === name ? replacement : entry.category };
  if (type === "tags") return { ...entry, tags: [...new Set((entry.tags || []).map(tag => tag === name ? replacement : tag).filter(Boolean))] };
  throw new Error("분류 종류를 확인해 주세요.");
}
