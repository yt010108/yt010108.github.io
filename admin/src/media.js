import { esc } from "../../shared/posts.js";
import { MAX_MEDIA_BYTES, verifyImageBytes } from "../../shared/media.js";

export const mediaViewHTML = () => `<section id="media-view" class="cms-manager" aria-labelledby="media-title" hidden>
  <div class="cms-title-row"><div><p class="cms-eyebrow">MEDIA LIBRARY</p><h1 id="media-title" tabindex="-1">미디어</h1><p>글의 첨부 이미지와 라이브러리 업로드를 한곳에서 관리해요.</p></div><label class="writer-button writer-primary" for="media-upload">이미지 업로드<input id="media-upload" class="writer-sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple disabled></label></div>
  <p class="writer-small-note">PNG·JPG·GIF·WebP · 한 장 10MB, 한 번에 20장·합계 50MB. 업로드한 파일은 GitHub에 저장하고 블로그에 배포해요.</p>
  <fieldset id="media-fields" disabled><legend class="writer-sr-only">미디어 관리</legend>
    <div class="cms-filter-row"><label class="cms-search"><span class="writer-sr-only">미디어 검색</span><input id="media-search" type="search" placeholder="파일 이름·주소·글 제목 검색"></label><label><span class="writer-sr-only">미디어 종류</span><select id="media-type"><option value="">모든 이미지</option><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/gif">GIF</option><option value="image/webp">WebP</option></select></label><label><span class="writer-sr-only">미디어 출처</span><select id="media-source"><option value="">모든 출처</option><option value="library">라이브러리 업로드</option><option value="posts">글 첨부 이미지</option></select></label><button id="media-refresh" type="button" class="writer-button">새로고침</button></div>
    <p id="media-status" class="cms-list-note" role="status" aria-live="polite"></p>
    <div class="cms-media-layout"><div><div id="media-grid" class="cms-media-grid"></div><div class="cms-bottom-row"><span id="media-count"></span><div class="cms-pagination"><button id="media-prev" type="button" class="writer-button">이전</button><span id="media-page"></span><button id="media-next" type="button" class="writer-button">다음</button></div></div></div>
      <aside id="media-detail" class="cms-media-detail" aria-labelledby="media-detail-title" hidden><h2 id="media-detail-title">이미지 정보</h2><img id="media-detail-image" alt="선택한 이미지" referrerpolicy="no-referrer"><p id="media-detail-meta"></p><label>파일 이름<input id="media-name" maxlength="200"></label><label>이미지 설명<input id="media-alt" maxlength="300" placeholder="Markdown 이미지 설명"></label><label>블로그 주소<input id="media-url" readonly></label><div class="cms-media-actions"><button id="media-copy" type="button" class="writer-button">주소 복사</button><button id="media-markdown" type="button" class="writer-button">Markdown 복사</button><button id="media-insert" type="button" class="writer-button">본문에 넣기</button><a id="media-open" class="writer-button" target="_blank" rel="noopener noreferrer">원본 보기 ↗</a></div><div class="cms-media-actions"><button id="media-save" type="button" class="writer-button writer-primary">정보 저장</button><button id="media-delete" type="button" class="writer-button">미사용 파일 삭제</button></div><p id="media-detail-note" class="writer-small-note"></p></aside>
    </div>
  </fieldset>
</section>`;

export function createMediaManager({ repository, onBusy, onInsert, localDrafts }) {
  const $ = id => document.getElementById(id);
  let files = [], selected = null, busy = false, externalBusy = true, loaded = false, page = 0;
  const dirty = () => Boolean(selected?.managed && ($("media-name").value !== selected.name || $("media-alt").value !== selected.alt));
  const size = bytes => bytes < 1024 ? bytes + " B" : bytes < 1024 ** 2 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1024 ** 2).toFixed(1) + " MB";
  function status(message, error = false) { $("media-status").textContent = message; $("media-status").dataset.error = String(error); $("media-status").setAttribute("role", error ? "alert" : "status"); }
  function setBusy(value) {
    externalBusy = value; const blocked = value || busy || !repository.connected;
    $("media-fields").disabled = blocked; $("media-upload").disabled = blocked;
    $("media-save").disabled = blocked || !selected?.managed || !dirty(); $("media-delete").disabled = blocked || !selected?.managed;
    $("media-name").disabled = blocked || !selected?.managed; $("media-alt").disabled = blocked || !selected?.managed;
  }
  function renderDetail() {
    $("media-detail").hidden = !selected; if (!selected) return;
    $("media-detail-image").src = selected.preview || "../assets/favicon.svg";
    $("media-name").value = selected.name; $("media-alt").value = selected.alt || ""; $("media-url").value = selected.url;
    $("media-detail-meta").textContent = selected.type.replace("image/", "").toUpperCase() + " · " + size(selected.size) + (selected.post ? " · " + selected.post.title + (selected.post.status === "trash" ? " (휴지통)" : "") : " · 라이브러리");
    $("media-open").href = selected.preview || selected.url;
    $("media-detail-note").textContent = selected.managed ? "삭제 전 GitHub의 글·페이지와 이 브라우저의 임시글에서 사용 중인지 확인해요." : "글에 첨부된 이미지예요. 이미지의 설명과 파일은 해당 글을 편집해 관리하세요.";
    setBusy(externalBusy);
  }
  function render() {
    const query = $("media-search").value.normalize("NFKC").toLowerCase().trim(), type = $("media-type").value, source = $("media-source").value;
    const matches = files.filter(file => (!type || file.type === type) && (!source || source === "library" && file.managed || source === "posts" && !file.managed) && [file.name, file.path, file.post?.title || ""].join(" ").normalize("NFKC").toLowerCase().includes(query));
    const total = Math.max(1, Math.ceil(matches.length / 24)); page = Math.min(page, total - 1);
    $("media-grid").innerHTML = matches.slice(page * 24, page * 24 + 24).map(file => '<button type="button" class="cms-media-card" data-media-select="' + esc(file.id) + '" aria-pressed="' + String(selected?.id === file.id) + '"><span class="cms-media-thumb">' + (file.preview ? '<img src="' + esc(file.preview) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '파일 없음') + '</span><strong>' + esc(file.name) + '</strong><span>' + esc(file.post?.title || (file.managed ? "라이브러리 업로드" : "글 첨부 이미지")) + '</span><small>' + size(file.size) + '</small></button>').join("") || '<p class="cms-empty">조건에 맞는 이미지가 없어요.</p>';
    $("media-count").textContent = matches.length + "개 / 전체 " + files.length + "개"; $("media-page").textContent = (page + 1) + " / " + total;
    $("media-prev").disabled = page === 0; $("media-next").disabled = page + 1 >= total;
  }
  async function run(action) {
    if (busy || externalBusy || !repository.connected) return;
    busy = true; onBusy(true); setBusy(true);
    try { await action(); } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  async function refresh({ discard = false } = {}) {
    if (busy || !repository.connected) return;
    if (dirty() && (!discard || !confirm("저장하지 않은 이미지 정보 변경을 버리고 다시 불러올까요?"))) { status("편집 중인 이미지 정보를 유지했어요."); return; }
    busy = true; onBusy(true); status("이미지 목록을 불러오는 중…");
    try {
      const library = await repository.mediaLibrary(); files = library.files; loaded = true;
      selected = selected ? files.find(file => file.id === selected.id) || null : null;
      render(); renderDetail(); status(files.length + "개의 이미지를 불러왔어요.");
    } catch (error) { status(error.message, true); }
    finally { busy = false; onBusy(false); setBusy(false); }
  }
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); }
    catch { const input = document.createElement("textarea"); input.value = value; input.style.cssText = "position:fixed;left:-9999px"; document.body.append(input); input.select(); const ok = document.execCommand("copy"); input.remove(); if (!ok) throw new Error("주소를 직접 선택해 복사해 주세요."); }
  }
  $("media-upload").addEventListener("change", async event => {
    const chosen = [...event.target.files]; event.target.value = "";
    if (!chosen.length) return;
    if (dirty()) { status("편집 중인 이미지 정보를 먼저 저장해 주세요.", true); return; }
    await run(async () => {
      if (chosen.length > 20 || chosen.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) throw new Error("한 번에 20장, 합계 50MB까지 올릴 수 있어요.");
      const images = [];
      for (const file of chosen) {
        if (file.size > MAX_MEDIA_BYTES) throw new Error(file.name + "은 10MB를 넘어요.");
        const bytes = verifyImageBytes(new Uint8Array(await file.arrayBuffer()), file.type);
        const decoded = await createImageBitmap(file).catch(() => { throw new Error(file.name + "을 이미지로 읽지 못했어요."); }); decoded.close();
        images.push({ name: file.name, type: file.type, bytes });
      }
      await repository.uploadMedia(images, status); const library = await repository.mediaLibrary(); files = library.files; loaded = true; page = 0; render(); status("이미지를 GitHub에 저장했어요. 배포 후 블로그 주소에서 볼 수 있어요.");
    });
  });
  $("media-grid").addEventListener("click", async event => {
    const button = event.target.closest("[data-media-select]"); if (!button || busy) return;
    if (dirty() && !confirm("이미지 정보 변경을 버리고 다른 이미지를 선택할까요?")) return;
    selected = files.find(file => file.id === button.dataset.mediaSelect) || null; render(); renderDetail();
    if (selected?.post) {
      const id = selected.id, postId = selected.post.id, path = selected.path;
      try {
        const index = await repository.readIndex(), item = index.entries.find(item => item.id === postId);
        if (item) { const record = await repository.record(item), asset = record.assets.find(asset => asset.path === "/" + path); if (asset && selected?.id === id) { selected.name = asset.name || selected.name; $("media-name").value = selected.name; } }
      } catch {}
    }
  });
  for (const id of ["media-search", "media-type", "media-source"]) $(id).addEventListener(id === "media-search" ? "input" : "change", () => { page = 0; render(); });
  $("media-prev").addEventListener("click", () => { page = Math.max(0, page - 1); render(); }); $("media-next").addEventListener("click", () => { page++; render(); });
  $("media-refresh").addEventListener("click", () => refresh({ discard: true }));
  for (const id of ["media-name", "media-alt"]) $(id).addEventListener("input", () => setBusy(externalBusy));
  $("media-copy").addEventListener("click", () => { if (selected) copy(selected.url).then(() => status("이미지 주소를 복사했어요.")).catch(error => status(error.message, true)); });
  $("media-markdown").addEventListener("click", () => { if (selected) { const alt = ($("media-alt").value || selected.name).replace(/[\\\[\]]/g, "\\$&"); copy("![" + alt + "](" + selected.url + ")").then(() => status("Markdown 이미지를 복사했어요.")).catch(error => status(error.message, true)); } });
  $("media-insert").addEventListener("click", () => { if (selected && !busy) onInsert(selected).catch(error => status(error.message, true)); });
  $("media-save").addEventListener("click", () => run(async () => {
    if (!selected?.managed) return;
    await repository.renameMedia(selected.id, $("media-name").value.trim(), $("media-alt").value);
    const library = await repository.mediaLibrary(); files = library.files; selected = files.find(file => file.id === selected.id); render(); renderDetail(); status("이미지 정보를 저장했어요.");
  }));
  $("media-delete").addEventListener("click", () => run(async () => {
    if (!selected?.managed) return;
    const result = await repository.deleteMedia(selected.id, { localDrafts: await localDrafts(), progress: status, confirmDelete: file => confirm('"' + file.name + '"을 GitHub 라이브러리에서 삭제할까요?\n' + file.path + '\nGitHub 글·페이지에서는 사용하지 않는 파일이에요. 다른 곳에 복사한 주소는 연결되지 않게 됩니다.') });
    if (result.cancelled) { status("삭제를 취소했어요."); return; }
    selected = null; const library = await repository.mediaLibrary(); files = library.files; render(); renderDetail(); status("사용하지 않는 이미지를 삭제했어요.");
  }));
  return { refresh, setBusy, isDirty: dirty, isBusy: () => busy, discard: renderDetail, clear() { if (!dirty()) { files = []; selected = null; loaded = false; render(); renderDetail(); } setBusy(true); }, isLoaded: () => loaded };
}
