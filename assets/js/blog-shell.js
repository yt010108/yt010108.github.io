(() => {
  const sidebar = document.getElementById('blog-sidebar');
  if (!sidebar) return;

  const toggle = document.getElementById('blog-menu-toggle');
  const close = sidebar.querySelector('.blog-sidebar-close');
  const backdrop = document.querySelector('.blog-backdrop');
  const mobile = window.matchMedia('(max-width: 580px)');

  function setMenuOpen(open, restoreFocus = false) {
    const visible = open && mobile.matches;
    document.body.classList.toggle('blog-sidebar-open', visible);
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.setAttribute('aria-label', visible ? '블로그 메뉴 닫기' : '블로그 메뉴 열기');
    sidebar.inert = mobile.matches && !visible;
    backdrop.hidden = !visible;
    if (visible) sidebar.querySelector('.blog-sidebar-nav a').focus({preventScroll: true});
    else if (restoreFocus) toggle.focus({preventScroll: true});
  }

  toggle.addEventListener('click', () => setMenuOpen(!document.body.classList.contains('blog-sidebar-open'), true));
  close.addEventListener('click', () => setMenuOpen(false, true));
  backdrop.addEventListener('click', () => setMenuOpen(false, true));
  sidebar.addEventListener('click', event => { if (event.target.closest('a')) setMenuOpen(false); });
  mobile.addEventListener('change', () => setMenuOpen(false));
  setMenuOpen(false);

  document.addEventListener('keydown', event => {
    if (!mobile.matches || !document.body.classList.contains('blog-sidebar-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false, true); }
    if (event.key !== 'Tab') return;
    const controls = [...sidebar.querySelectorAll('a[href], button:not([disabled])')].filter(node => node.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  const toc = document.querySelector('.blog-toc .toc');
  if (!toc) return;
  const compactToc = window.matchMedia('(max-width: 840px)');
  function syncToc() { toc.open = !compactToc.matches; }
  compactToc.addEventListener('change', syncToc);
  syncToc();

  const entries = [...toc.querySelectorAll('a[href^="#"]')].map(link => {
    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    return {link, heading};
  }).filter(entry => entry.heading);
  let scheduled = false;
  function updateCurrentHeading() {
    scheduled = false;
    let current = entries[0];
    const threshold = Math.max(80, Math.min(180, window.innerHeight * .2));
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top > threshold) break;
      current = entry;
    }
    for (const entry of entries) {
      if (entry === current) entry.link.setAttribute('aria-current', 'location');
      else entry.link.removeAttribute('aria-current');
    }
  }
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateCurrentHeading);
  }
  window.addEventListener('scroll', scheduleUpdate, {passive: true});
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('load', scheduleUpdate);
  updateCurrentHeading();
})();
