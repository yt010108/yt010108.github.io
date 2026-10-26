import { UUID, validateDocument } from "./posts.js";

export const SITE_PATH = "blog/site.json";
export const SITE_FORMAT = "yt010108-site";
export const PROFILE_SECTIONS = [
  { key: "focus", label: "관심 분야", fields: [["name", "이름"], ["description", "설명"]] },
  { key: "skills", label: "기술", fields: [["name", "분류"], ["items", "기술 목록 · 한 줄에 하나"]] },
  ...[["contributions", "기여"], ["activities", "활동"], ["certifications", "자격증"], ["education", "교육"], ["awards", "수상"]].map(([key, label]) => ({ key, label, fields: [["period", "기간"], ["title", "제목"], ["description", "설명"], ["href", "관련 주소"], ["linkLabel", "링크 이름"]] }))
];
export const PROJECT_TEXT_FIELDS = [["name", "이름"], ["category", "분류"], ["description", "짧은 소개"], ["year", "연도"], ["github", "GitHub 주소"], ["type", "프로젝트 종류"], ["status", "진행 상태"], ["flowLabel", "구성도 제목"], ["summary", "상세 소개"]];
const text = (value, limit, label, required = false) => {
  if (typeof value !== "string" || value.length > limit || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(label + "을 확인해 주세요.");
  return value;
};
const list = (value, limit, label) => { if (!Array.isArray(value) || value.length > limit) throw new Error(label + " 개수를 확인해 주세요."); return value; };
export function siteURL(value, blank = true) {
  const raw = text(value, 1500, "주소").trim(); if (!raw && blank) return "";
  if (/^#\/[a-z0-9][a-z0-9\/-]*$/i.test(raw)) return raw;
  let url; try { url = new URL(raw); } catch { throw new Error("http 또는 https 주소나 블로그 내부 주소를 입력해 주세요."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("안전한 http 또는 https 주소를 입력해 주세요.");
  return url.href;
}
export const validSiteId = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 90;
export function validateSite(value) {
  if (value?.format !== SITE_FORMAT || value.version !== 1 || !value.profile) throw new Error("사이트 설정 형식이 올바르지 않아요.");
  const source = value.profile, profile = {};
  for (const key of ["name", "displayName", "role", "intro", "about"]) profile[key] = text(source[key] ?? "", ["intro", "about"].includes(key) ? 12000 : 200, "프로필 " + key, key === "name");
  profile.headline = list(source.headline, 4, "홈 제목").map(line => text(line, 200, "홈 제목", true));
  if (!profile.headline.length) throw new Error("홈 제목을 입력해 주세요.");
  for (const key of ["github", "tistory"]) profile[key] = siteURL(source[key] ?? "");
  profile.email = text(source.email ?? "", 254, "이메일");
  if (profile.email && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(profile.email)) throw new Error("이메일 주소를 확인해 주세요.");
  for (const section of PROFILE_SECTIONS) profile[section.key] = list(source[section.key] || [], 30, section.label).map(item => Object.fromEntries(section.fields.map(([field]) => {
    if (field === "items") return [field, list(item[field] || [], 30, "기술").map(entry => text(entry, 120, "기술", true))];
    if (field === "href") return [field, siteURL(item[field] ?? "")];
    return [field, text(item[field] ?? "", field === "description" ? 3000 : 250, section.label, ["title", "name"].includes(field))];
  })));
  const ids = new Set();
  const projects = list(value.projects, 60, "프로젝트").map(item => {
    if (!validSiteId(item.id) || ids.has(item.id)) throw new Error("프로젝트 주소가 올바르지 않거나 중복돼요."); ids.add(item.id);
    const project = { id: item.id };
    for (const [key] of PROJECT_TEXT_FIELDS) project[key] = key === "github" ? siteURL(item[key] ?? "") : text(item[key] ?? "", ["summary", "description"].includes(key) ? 12000 : 250, "프로젝트 " + key, key === "name");
    project.stack = list(item.stack || [], 25, "기술 스택").map(entry => text(entry, 120, "기술", true));
    project.flow = list(item.flow || [], 8, "구성도").map(entry => text(entry, 120, "구성도 단계", true));
    project.sections = list(item.sections || [], 25, "프로젝트 설명").map(section => ({ title: text(section.title, 200, "설명 제목", true), text: text(section.text, 15000, "설명") }));
    project.relatedPosts = list(item.relatedPosts || [], 40, "관련 글").map(id => { if (!UUID.test(id)) throw new Error("관련 글 ID를 확인해 주세요."); return id; });
    if (item.published !== undefined && typeof item.published !== "boolean") throw new Error("프로젝트 공개 여부를 확인해 주세요.");
    project.published = item.published !== false; project.sample = Boolean(item.sample);
    return project;
  });
  const pageIds = new Set();
  const pages = list(value.pages || [], 30, "페이지").map(item => {
    if (!validSiteId(item.id) || pageIds.has(item.id)) throw new Error("페이지 주소가 올바르지 않거나 중복돼요."); pageIds.add(item.id);
    if (typeof item.published !== "boolean") throw new Error("페이지 공개 여부를 확인해 주세요.");
    const doc = structuredClone(validateDocument(item.doc));
    if (JSON.stringify(doc).length > 100000) throw new Error("페이지 본문이 너무 길어요.");
    return { id: item.id, title: text(item.title, 200, "페이지 제목", true), description: text(item.description || "", 1000, "페이지 소개"), markdown: text(item.markdown || "", 80000, "페이지 본문"), doc, published: item.published };
  });
  if (value.updatedAt !== null && (typeof value.updatedAt !== "string" || value.updatedAt.length > 40 || !Number.isFinite(Date.parse(value.updatedAt)))) throw new Error("사이트 저장 시각을 확인해 주세요.");
  const result = { format: SITE_FORMAT, version: 1, profile, projects, pages, updatedAt: value.updatedAt };
  if (JSON.stringify(result).length > 450000) throw new Error("사이트 설정이 너무 커요. 페이지와 프로젝트의 내용을 나누어 주세요.");
  return result;
}
export const siteText = value => JSON.stringify(validateSite(value), null, 2) + "\n";
export function publicSite(value) { const checked = validateSite(value); return { profile: checked.profile, projects: checked.projects.filter(item => item.published && !item.sample), pages: checked.pages.filter(item => item.published) }; }
export function mergeSite(base, local, remote) {
  const a = validateSite(base), b = validateSite(local), c = validateSite(remote), result = { ...c };
  for (const key of ["profile", "projects", "pages"]) {
    const original = JSON.stringify(a[key]), mine = JSON.stringify(b[key]), latest = JSON.stringify(c[key]);
    if (mine !== original && latest !== original && mine !== latest) throw new Error("다른 기기에서 같은 사이트 항목을 수정했어요. 현재 입력을 보관한 뒤 최신 저장본을 확인해 주세요.");
    result[key] = structuredClone(mine === original ? c[key] : b[key]);
  }
  return validateSite(result);
}
