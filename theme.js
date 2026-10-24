(() => {
  "use strict";

  const storageKey = "yt010108-theme";
  const root = document.documentElement;
  const icons = {
    light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/></svg>'
  };

  function applyTheme(value) {
    const theme = value === "dark" ? "dark" : "light";
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#ffffff" : "#0b0c0c");
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      const next = theme === "light" ? "dark" : "light";
      const label = next === "light" ? "라이트 모드로 전환" : "다크 모드로 전환";
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      if (!button.querySelector("[data-theme-icon]")) {
        button.innerHTML = `<span data-theme-icon="light" aria-hidden="true">${icons.light}</span><span data-theme-icon="dark" aria-hidden="true">${icons.dark}</span>`;
      }
    });
  }

  let initialTheme = "light";
  try { initialTheme = localStorage.getItem(storageKey); } catch {}
  applyTheme(initialTheme);

  document.addEventListener("DOMContentLoaded", () => applyTheme(root.dataset.theme), { once: true });
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem(storageKey, next); } catch {}
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) applyTheme(event.newValue);
  });
})();
