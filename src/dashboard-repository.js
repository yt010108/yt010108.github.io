import { GitHubRepository, REPOSITORY, BRANCH } from "../admin/src/github.js";
import { DASHBOARD_PATH, validateDashboard, dashboardText } from "../shared/dashboard.js";
import { SHA } from "../shared/posts.js";

const endpoint = "/repos/" + REPOSITORY + "/contents/" + DASHBOARD_PATH;
const decode = value => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.replace(/\s/g, "")), char => char.charCodeAt(0)));
const encode = value => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(""));
export class DashboardConflict extends Error {
  constructor() { super("다른 기기에서 대시보드를 수정했어요. 현재 입력은 유지했으니 내용을 복사한 뒤 최신 저장본을 다시 불러와 주세요."); this.name = "DashboardConflict"; }
}
async function blobSHA(value) {
  const bytes = new TextEncoder().encode(value), header = new TextEncoder().encode("blob " + bytes.length + "\0");
  const body = new Uint8Array(header.length + bytes.length); body.set(header); body.set(bytes, header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", body)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export class DashboardRepository extends GitHubRepository {
  async mutateDashboard(transform) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.readDashboard(), next = validateDashboard(transform(latest.config));
      if (dashboardText(next) === dashboardText(latest.config)) return { ...latest, commit: null };
      try { return await this.saveDashboard(next, latest.sha); }
      catch (error) { if (!(error instanceof DashboardConflict) || attempt === 2) throw error; }
    }
  }
  async readDashboard() {
    const generation = this.generation;
    const file = await this.request(endpoint + "?ref=" + BRANCH);
    if (!this.connected || generation !== this.generation) throw new Error("관리자 연결이 변경됐어요. 다시 연결해 주세요.");
    if (!SHA.test(file.sha) || file.encoding !== "base64" || typeof file.content !== "string" || file.content.length > 200000) throw new Error("대시보드 파일을 읽지 못했어요.");
    return { config: validateDashboard(JSON.parse(decode(file.content))), sha: file.sha };
  }
  async saveDashboard(value, expectedSHA) {
    if (!this.connected) throw new Error("먼저 관리자에 로그인해 주세요.");
    if (!SHA.test(expectedSHA)) throw new Error("최신 저장본을 먼저 불러와 주세요.");
    const generation = this.generation, config = validateDashboard({ ...value, updatedAt: new Date().toISOString() });
    const latest = await this.readDashboard();
    if (latest.sha !== expectedSHA) throw new DashboardConflict();
    const content = dashboardText(config), expectedNext = await blobSHA(content);
    if (!this.connected || generation !== this.generation) throw new Error("관리자 연결이 변경됐어요. 다시 연결해 주세요.");
    let result;
    try {
      result = await this.request(endpoint, { method: "PUT", body: { branch: BRANCH, message: "Update dashboard", sha: expectedSHA, content: encode(content) } });
    } catch (error) {
      if ([409, 422].includes(error.status)) throw new DashboardConflict();
      if (![401, 403, 404].includes(error.status) && this.connected && generation === this.generation) {
        try { const current = await this.readDashboard(); if (current.sha === expectedNext) return { ...current, commit: null }; } catch {}
      }
      throw error;
    }
    if (result.content?.sha !== expectedNext || !SHA.test(result.commit?.sha)) throw new Error("저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.");
    return { config, sha: result.content.sha, commit: result.commit.sha };
  }
}
