(function () {
  "use strict";

  // Keep links from the previous hash-based blog usable after the migration.
  if (location.hash.startsWith("#/")) {
    var parts = location.hash.slice(2).split("/");
    var sections = { post: "posts", note: "notes", project: "projects", posts: "posts", notes: "notes", projects: "projects", about: "about" };
    if (sections[parts[0]]) {
      var target = document.querySelector(".wordmark").href + sections[parts[0]] + "/";
      if (parts[1]) target += encodeURIComponent(decodeURIComponent(parts[1])) + "/";
      location.replace(target);
    }
  }

  document.querySelectorAll(".prose pre").forEach(function (pre) {
    var code = pre.querySelector("code");
    if (!code || !navigator.clipboard) return;
    var wrap = document.createElement("div");
    wrap.className = "code-block";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "복사";
    button.setAttribute("aria-label", "코드 복사");
    button.setAttribute("aria-live", "polite");
    pre.before(wrap);
    wrap.append(button, pre);
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        button.textContent = "복사됨";
        window.setTimeout(function () { button.textContent = "복사"; }, 1800);
      }).catch(function () {
        button.textContent = "복사 실패";
        window.setTimeout(function () { button.textContent = "복사"; }, 1800);
      });
    });
  });
})();
