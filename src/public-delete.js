import { GitHubRepository } from "../admin/src/github.js";
import { UUID, SHA } from "../shared/posts.js";

const $ = id => document.getElementById(id);
const dialog = $("post-delete-dialog");
const repository = new GitHubRepository();
let current = null, latest = null, request = 0, writing = false;

function status(message, error = false) {
  const element = $("post-delete-status");
  element.textContent = message;
  element.dataset.error = String(error);
  element.setAttribute("role", error ? "alert" : "status");
}

function stage(value) {
  $("post-delete-token-form").hidden = value !== "token";
  $("post-delete-confirm-actions").hidden = value !== "confirm";
  $("post-delete-retry-actions").hidden = value !== "retry";
  $("post-delete-done-actions").hidden = value !== "done";
}

async function verify(sequence) {
  const index = await repository.readIndex();
  if (sequence !== request || !dialog.open) return;
  const item = index.entries.find(entry => entry.id === current.id && entry.kind === current.kind);
  if (!item || item.status !== "published") throw new Error("이 글은 이미 공개 목록에서 내려갔어요. 새로고침해 주세요.");
  if (item.sha !== current.sha) throw new Error("글이 변경됐어요. 새로고침한 뒤 다시 시도해 주세요.");
  latest = item;
  stage("confirm");
  status("GitHub 토큰을 확인했어요.");
  $("post-delete-submit").focus();
}

async function checkSaved(sequence) {
  try {
    if (!repository.connected && repository.hasSavedConnection) await repository.restore();
    if (sequence !== request || !dialog.open) return;
    if (!repository.connected) {
      stage("token");
      status("삭제하려면 GitHub 토큰을 입력해 주세요.");
      $("post-delete-token").focus();
      return;
    }
    await verify(sequence);
  } catch (error) {
    if (sequence !== request || !dialog.open) return;
    stage(repository.connected ? "retry" : "token");
    status(error.message || "GitHub 연결을 확인하지 못했어요.", true);
  }
}

window.BlogPostDelete = {
  open(item) {
    if (!UUID.test(item?.id) || !SHA.test(item?.sha) || !["posts", "notes"].includes(item.kind)) return;
    if (dialog.open) dialog.close();
    current = { id: item.id, kind: item.kind, sha: item.sha };
    latest = null;
    const sequence = ++request;
    $("post-delete-name").textContent = item.title || "제목 없는 글";
    $("post-delete-token").value = "";
    stage("checking");
    status("저장된 GitHub 토큰을 확인하는 중…");
    dialog.showModal();
    checkSaved(sequence);
  }
};

$("post-delete-token-form").addEventListener("submit", async event => {
  event.preventDefault();
  const sequence = request, input = $("post-delete-token");
  const token = input.value;
  input.value = "";
  const button = event.submitter;
  button.disabled = true;
  status("GitHub 계정과 글을 확인하는 중…");
  try {
    await repository.connect(token, { remember: false });
    if (sequence === request && dialog.open) await verify(sequence);
  } catch (error) {
    if (sequence === request && dialog.open) {
      stage(repository.connected ? "retry" : "token");
      status(error.message || "토큰을 확인하지 못했어요.", true);
    }
  } finally { button.disabled = false; }
});

$("post-delete-submit").addEventListener("click", async () => {
  if (writing || !latest) return;
  writing = true;
  $("post-delete-submit").disabled = true;
  $("post-delete-close").disabled = true;
  status("GitHub 휴지통으로 옮기는 중…");
  try {
    await repository.changeStatus([latest]);
    latest = null;
    stage("done");
    status("휴지통으로 옮겼어요. 배포가 완료되면 공개 목록에서 내려가요.");
    $("post-delete-list").focus();
  } catch (error) {
    stage(!repository.connected ? "token" : error.name === "RepositoryConflict" ? "retry" : "confirm");
    status(error.message || "삭제하지 못했어요.", true);
  } finally {
    writing = false;
    $("post-delete-submit").disabled = false;
    $("post-delete-close").disabled = false;
  }
});

$("post-delete-retry").addEventListener("click", () => { stage("checking"); status("최신 글을 확인하는 중…"); checkSaved(request); });
$("post-delete-list").addEventListener("click", () => { dialog.close(); location.hash = current.kind === "notes" ? "#/notes" : "#/posts"; });
$("post-delete-close").addEventListener("click", () => { if (!writing) dialog.close(); });
dialog.querySelectorAll("[data-delete-cancel]").forEach(button => button.addEventListener("click", () => { if (!writing) dialog.close(); }));
dialog.addEventListener("cancel", event => { if (writing) event.preventDefault(); });
dialog.addEventListener("close", () => { request++; $("post-delete-token").value = ""; });
