import { Node } from "@tiptap/core";

const FIELDS = ["id", "href", "title", "description", "image", "imageKind", "state"];
const PRIVATE_QUERY = /^(access_token|id_token|token|secret|password|passwd|signature|authorization|auth|credential|api[_-]?key|key|code)$/i;

export function webURL(value) {
  try {
    const url = new URL(String(value).trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) return null;
    return url;
  } catch { return null; }
}

function publicHost(url) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false;
  if (host === "localhost" || /\.(localhost|local|internal|test|invalid)$/.test(host)) return false;
  if (host.includes(":")) return !/^(::|fc|fd|fe[89ab]|ff)/i.test(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if ([0, 10, 127].includes(a) || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b))) return false;
  }
  return true;
}

function metadataURL(href) {
  const url = webURL(href);
  if (!url || !publicHost(url) || [...url.searchParams.keys()].some(key => PRIVATE_QUERY.test(key))) return null;
  url.hash = "";
  return url.href;
}

function imageURL(value) {
  const url = webURL(value);
  return url?.protocol === "https:" && publicHost(url) ? url.href : "";
}

function normalized(value) {
  const href = webURL(value.href)?.href || "";
  return {
    id: typeof value.id === "string" && /^[a-f0-9-]{36}$/i.test(value.id) ? value.id : crypto.randomUUID(),
    href, title: String(value.title || "").slice(0, 240),
    description: String(value.description || "").slice(0, 600),
    image: imageURL(value.image), imageKind: value.imageKind === "logo" ? "logo" : "image",
    state: ["loading", "ready", "unavailable", "blocked"].includes(value.state) ? value.state : "unavailable"
  };
}

export function createLinkPreviews({ getEditor, getEntryId }) {
  const cache = new Map(), requests = new Map(), pending = new Set();
  let queued = false;

  function effective(value) {
    const attrs = normalized(value);
    const cached = cache.get(metadataURL(attrs.href));
    return attrs.state === "loading" && cached ? { ...attrs, ...cached, id: attrs.id, href: attrs.href } : attrs;
  }

  function fromElement(element) {
    const raw = Object.fromEntries(FIELDS.map(field => [field, element.getAttribute("data-link-" + field)]));
    return effective(raw);
  }

  function element(value) {
    const attrs = effective(value), url = webURL(attrs.href);
    const figure = document.createElement("figure");
    figure.className = "writer-link-preview";
    figure.setAttribute("data-link-preview", "");
    FIELDS.forEach(field => figure.setAttribute("data-link-" + field, attrs[field]));
    const link = document.createElement("a");
    link.className = "writer-link-card";
    link.href = url?.href || "#";
    link.target = "_blank"; link.rel = "noopener noreferrer";
    const media = document.createElement("span");
    media.className = "writer-link-media";
    const placeholder = document.createElement("span");
    placeholder.className = "writer-link-placeholder";
    placeholder.textContent = "↗"; placeholder.setAttribute("aria-hidden", "true");
    media.append(placeholder);
    if (attrs.image) {
      const image = document.createElement("img");
      image.className = "writer-link-image";
      image.src = attrs.image; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      media.dataset.kind = attrs.imageKind;
      media.append(image);
    }
    const copy = document.createElement("span");
    copy.className = "writer-link-copy";
    const title = document.createElement("span");
    title.className = "writer-link-title"; title.textContent = attrs.title || url?.hostname || "링크";
    const description = document.createElement("span");
    description.className = "writer-link-description"; description.textContent = attrs.description;
    const site = document.createElement("span");
    site.className = "writer-link-site"; site.textContent = url?.hostname || "";
    const status = document.createElement("span");
    status.className = "writer-link-status";
    status.textContent = attrs.state === "loading" ? "링크 정보를 불러오는 중…" : attrs.state === "unavailable" ? "정보를 불러오지 못했어요 · 주소는 유지돼요" : attrs.state === "blocked" ? "주소 미리보기" : "";
    copy.append(title, description, site, status); link.append(media, copy); figure.append(link);
    return figure;
  }

  const extension = Node.create({
    name: "linkPreview", group: "block", atom: true, selectable: true, draggable: true,
    addAttributes() {
      return Object.fromEntries(FIELDS.map(field => [field, {
        default: field === "state" ? "loading" : "",
        rendered: false,
        parseHTML: html => fromElement(html)[field]
      }]));
    },
    parseHTML() { return [{ tag: "figure[data-link-preview]" }]; },
    renderHTML({ node }) { return element(node.attrs); },
    renderMarkdown(node) { return element(node.attrs).outerHTML; }
  });

  function remember(doc) {
    if (doc.type === "linkPreview") {
      const attrs = normalized(doc.attrs || {});
      const key = metadataURL(attrs.href);
      if (key && attrs.state !== "loading") cache.set(key, {
        title: attrs.title, description: attrs.description, image: attrs.image, imageKind: attrs.imageKind, state: attrs.state
      });
    }
    doc.content?.forEach(remember);
  }

  function enrich(doc) {
    const copy = { ...doc };
    if (doc.type === "linkPreview") copy.attrs = effective(doc.attrs || {});
    if (doc.content) copy.content = doc.content.map(enrich);
    return copy;
  }

  function rewriteMarkdown(markdown) {
    return markdown.replace(/<figure\b[^>]*\bdata-link-preview(?:\s|=)[\s\S]*?<\/figure>/gi, html => {
      const template = document.createElement("template"); template.innerHTML = html;
      const figure = template.content.querySelector("figure[data-link-preview]");
      return figure ? element(fromElement(figure)).outerHTML : html;
    });
  }

  async function lookup(href) {
    const key = metadataURL(href);
    if (!key) return { state: "blocked" };
    if (cache.has(key)) return cache.get(key);
    if (requests.has(key)) return requests.get(key);
    const task = (async () => {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
      try {
        const endpoint = new URL("https://api.microlink.io");
        endpoint.searchParams.set("url", key);
        const response = await fetch(endpoint, { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("Preview unavailable");
        const result = await response.json();
        if (result.status !== "success" || !result.data) throw new Error("Preview unavailable");
        const data = result.data, image = data.image || data.logo;
        return {
          title: String(data.title || data.publisher || "").slice(0, 240),
          description: String(data.description || "").slice(0, 600),
          image: imageURL(image?.url),
          imageKind: !data.image || (image?.width <= 200 && image?.height <= 200) ? "logo" : "image",
          state: "ready"
        };
      } catch { return { title: "", description: "", image: "", imageKind: "image", state: "unavailable" }; }
      finally { clearTimeout(timer); }
    })().then(result => { cache.set(key, result); requests.delete(key); return result; });
    requests.set(key, task);
    return task;
  }

  function resume() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const editor = getEditor(), owner = getEntryId();
      if (!editor || editor.isDestroyed) return;
      editor.state.doc.descendants(node => {
        if (node.type.name !== "linkPreview" || node.attrs.state !== "loading") return;
        const id = node.attrs.id, href = node.attrs.href, key = owner + ":" + id;
        if (pending.has(key)) return;
        pending.add(key);
        lookup(href).then(result => {
          const current = getEditor();
          if (getEntryId() !== owner || !current || current.isDestroyed) return;
          let position;
          current.state.doc.descendants((candidate, pos) => {
            if (candidate.type.name === "linkPreview" && candidate.attrs.id === id && candidate.attrs.href === href) position = pos;
          });
          if (position === undefined) return;
          const found = current.state.doc.nodeAt(position);
          current.view.dispatch(current.state.tr.setNodeMarkup(position, undefined, { ...found.attrs, ...result }).setMeta("addToHistory", false));
        }).finally(() => pending.delete(key));
      });
    });
  }

  function refreshSelected() {
    const editor = getEditor(), attrs = editor.getAttributes("linkPreview");
    if (!attrs.id || attrs.state === "loading") return;
    cache.delete(metadataURL(attrs.href));
    editor.chain().focus().updateAttributes("linkPreview", { state: "loading" }).run();
    resume();
  }

  return { extension, remember, enrich, rewriteMarkdown, resume, refreshSelected, create: href => ({ type: "linkPreview", attrs: normalized({ href, state: "loading" }) }) };
}
