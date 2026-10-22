/* Tally search overlay, adapted for Korean text and keyboard navigation. */
(function () {
  "use strict";
  var overlay = document.getElementById("search-overlay");
  var openButton = document.getElementById("search-open");
  var closeButton = document.getElementById("search-close");
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");
  var status = document.getElementById("search-status");
  if (!overlay || !openButton || !input) return;

  var index = null;
  var loading = null;
  var matches = [];
  var active = -1;
  var previousFocus = null;
  var background = [];
  var indexUrl = new URL(overlay.dataset.index, location.href);

  function normalize(text) { return String(text || "").normalize("NFKC").toLocaleLowerCase(); }
  function setActive(next) {
    if (!matches.length) return;
    active = (next + matches.length) % matches.length;
    Array.from(results.children).forEach(function (li, i) {
      li.setAttribute("aria-selected", String(i === active));
    });
    input.setAttribute("aria-activedescendant", results.children[active].id);
    results.children[active].scrollIntoView({ block: "nearest" });
  }

  function render() {
    var query = normalize(input.value.trim());
    results.replaceChildren();
    input.removeAttribute("aria-activedescendant");
    matches = [];
    active = -1;
    if (!query) { status.textContent = ""; return; }
    if (!index) { status.textContent = "검색 목록을 불러오는 중입니다…"; return; }
    var terms = query.split(/\s+/);
    var hits = index.map(function (item) {
      var title = normalize(item.title);
      var haystack = title + " " + normalize(item.description) + " " + normalize(item.content) + " " + normalize(item.tags);
      if (!terms.every(function (term) { return haystack.includes(term); })) return null;
      var score = terms.reduce(function (sum, term) { return sum + (title.startsWith(term) ? 100 : title.includes(term) ? 60 : 1); }, 0);
      return { item: item, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });
    status.textContent = hits.length ? hits.length + "개의 기록을 찾았어요." : "검색 결과가 없습니다. 다른 단어로 찾아보세요.";
    hits.slice(0, 8).forEach(function (hit, i) {
      var item = hit.item;
      var url = new URL(item.url, indexUrl);
      if (url.origin !== indexUrl.origin) return;
      var li = document.createElement("li");
      li.className = "search-result";
      li.id = "search-result-" + i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      var link = document.createElement("a");
      link.href = url.href;
      link.tabIndex = -1;
      var title = document.createElement("span");
      title.className = "search-result__title";
      title.textContent = item.title;
      var excerpt = document.createElement("span");
      excerpt.className = "search-result__excerpt";
      var text = String(item.description || item.content || "").replace(/\s+/g, " ").trim();
      excerpt.textContent = text.length > 100 ? text.slice(0, 100) + "…" : text;
      link.append(title, excerpt);
      li.append(link);
      results.append(li);
      matches.push(link);
    });
  }

  function loadIndex() {
    if (index) { render(); return; }
    if (loading) return;
    results.setAttribute("aria-busy", "true");
    status.textContent = "검색 목록을 불러오는 중입니다…";
    loading = fetch(indexUrl).then(function (response) {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    }).then(function (data) {
      if (!Array.isArray(data)) throw new Error("Invalid search index");
      index = data;
      render();
    }).catch(function () {
      status.textContent = "검색 목록을 불러오지 못했어요. 닫았다가 다시 열면 재시도합니다.";
    }).finally(function () {
      loading = null;
      results.setAttribute("aria-busy", "false");
    });
  }

  function open() {
    if (!overlay.hidden) return;
    previousFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add("search-open");
    input.setAttribute("aria-expanded", "true");
    background = Array.from(document.querySelectorAll("body > header, body > main, body > footer")).map(function (element) {
      var wasInert = element.inert;
      element.inert = true;
      return { element: element, wasInert: wasInert };
    });
    input.focus();
    loadIndex();
  }
  function close() {
    overlay.hidden = true;
    document.documentElement.classList.remove("search-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.value = "";
    results.replaceChildren();
    status.textContent = "";
    matches = [];
    active = -1;
    background.forEach(function (state) { state.element.inert = state.wasInert; });
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  function isTyping(target) { return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
  input.addEventListener("input", render);
  document.addEventListener("keydown", function (event) {
    if (!overlay.hidden) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === "Tab") {
        var first = input, last = closeButton;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      } else if (document.activeElement === input && event.key === "ArrowDown") { event.preventDefault(); setActive(active + 1); }
      else if (document.activeElement === input && event.key === "ArrowUp") { event.preventDefault(); setActive(active < 0 ? matches.length - 1 : active - 1); }
      else if (document.activeElement === input && event.key === "Enter" && matches.length) { event.preventDefault(); matches[Math.max(0, active)].click(); }
      return;
    }
    if (((event.key === "/" && !isTyping(event.target)) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) && !event.altKey) {
      event.preventDefault();
      open();
    }
  }, true);
})();
