// iframe은 부모와 같은 출처 권한 없이 메시지로만 선택과 편집을 전달한다.
const bridge = String.raw`(() => {
  const send = (type, data = {}) => parent.postMessage({ type, ...data }, '*');
  const selectorFor = element => {
    const parts = [];
    while (element && element !== document.documentElement) {
      let part = element.tagName.toLowerCase();
      if (element.id) { parts.unshift('#' + CSS.escape(element.id)); break; }
      const siblings = element.parentElement ? [...element.parentElement.children].filter(e => e.tagName === element.tagName && !e.hasAttribute('data-ks-marker')) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')';
      parts.unshift(part); element = element.parentElement;
    }
    return parts.join(' > ');
  };
  const query = selector => { try { return document.querySelector(selector); } catch { return null; } };
  const visible = () => send('ks-html-visible-text', { text: document.body?.innerText || '' });
  const describe = element => {
    const style = getComputedStyle(element);
    const text = [...element.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
    return { selector: selectorFor(element), tagName: element.tagName.toLowerCase(), text,
      styles: { color: style.color, backgroundColor: style.backgroundColor, margin: style.margin, padding: style.padding } };
  };
  document.addEventListener('mouseup', () => {
    const selection = getSelection();
    const raw = selection?.toString() || ''; const text = raw.trim();
    if (!text || !selection.rangeCount) return;
    const selected = selection.getRangeAt(0); const node = selected.commonAncestorContainer;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) return;
    const before = document.createRange(); before.selectNodeContents(element); before.setEnd(selected.startContainer, selected.startOffset);
    const after = document.createRange(); after.selectNodeContents(element); after.setStart(selected.endContainer, selected.endOffset);
    const rangeText = range => { const fragment = range.cloneContents(); fragment.querySelectorAll('[data-ks-marker]').forEach(marker => marker.remove()); return fragment.textContent || ''; };
    const prefix = (rangeText(before) + raw.slice(0, raw.length - raw.trimStart().length)).slice(-40);
    const suffix = (raw.slice(raw.trimEnd().length) + rangeText(after)).slice(0, 40);
    send('ks-html-selection', { selected_text: text, selector: selectorFor(element), prefix, suffix });
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-ks-marker]')) return;
    if (target.closest('a')) event.preventDefault();
    if (getSelection()?.toString().trim()) return;
    const copy = target.cloneNode(true); copy.querySelectorAll('[data-ks-marker]').forEach(marker => marker.remove());
    send('ks-html-element-select', { ...describe(target), selected_text: copy.textContent?.trim() || '' });
  });
  const matchIndex = (text, comment) => {
    if (!comment.selected_text) return -1;
    let index = text.indexOf(comment.selected_text);
    while (index >= 0) {
      if ((!comment.prefix || text.slice(0, index).endsWith(comment.prefix)) && (!comment.suffix || text.slice(index + comment.selected_text.length).startsWith(comment.suffix))) return index;
      index = text.indexOf(comment.selected_text, index + 1);
    }
    return -1;
  };
  const findText = comment => {
    if (comment.selector) { const found = query(comment.selector); if (found) return found; }
    if (!comment.selected_text) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; const value = node.textContent || '';
      if (matchIndex(value, comment) >= 0) return node.parentElement;
    }
    return null;
  };
  const mark = comments => {
    document.querySelectorAll('[data-ks-marker]').forEach(e => e.remove());
    const ranges = [];
    comments.forEach((comment, index) => {
      const element = findText(comment); if (!element) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = []; let text = '';
      while (walker.nextNode()) { const node = walker.currentNode; if (node.parentElement?.closest('[data-ks-marker]')) continue; nodes.push({ node, start: text.length, end: text.length + node.length }); text += node.textContent || ''; }
      const start = matchIndex(text, comment); const end = start + (comment.selected_text || '').length;
      const first = nodes.find(item => start >= item.start && start < item.end);
      const last = nodes.find(item => end > item.start && end <= item.end);
      if (first && last && end > start) { const range = new Range(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start); ranges.push(range); }
      const badge = document.createElement('button'); badge.type = 'button'; badge.dataset.ksMarker = comment.id;
      badge.textContent = String(index + 1); badge.className = 'ks-html-marker';
      badge.addEventListener('click', event => { event.stopPropagation(); send('ks-html-select-comment', { id: comment.id }); });
      if (['AREA', 'BR', 'COL', 'HR', 'IMG', 'INPUT', 'SOURCE', 'TRACK', 'WBR'].includes(element.tagName)) element.insertAdjacentElement('afterend', badge);
      else element.appendChild(badge);
    });
    if (CSS.highlights && window.Highlight) CSS.highlights.set('ks-html-comments', new Highlight(...ranges));
  };
  window.addEventListener('message', event => {
    if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'ks-html-comments') mark(data.comments || []);
    if (data.type === 'ks-html-focus-comment') {
      const comment = (data.comments || []).find(item => item.id === data.id); const element = comment && findText(comment);
      if (element) { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); element.classList.add('ks-html-focused'); setTimeout(() => element.classList.remove('ks-html-focused'), 1400); }
    }
    if (data.type === 'ks-html-apply-edit') {
      const element = query(data.selector); if (!element) return;
      if (typeof data.text === 'string') {
        const nodes = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
        if (nodes.length) { nodes[0].textContent = data.text; nodes.slice(1).forEach(node => node.remove()); }
        else element.prepend(document.createTextNode(data.text));
      }
      for (const key of ['color', 'backgroundColor', 'padding', 'margin']) if (typeof data.styles?.[key] === 'string') element.style[key] = data.styles[key];
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll('[data-ks-injected], [data-ks-marker]').forEach(e => e.remove());
      copy.querySelectorAll('.ks-html-focused').forEach(e => e.classList.remove('ks-html-focused'));
      send('ks-html-serialized', { html: '<!doctype html>' + copy.outerHTML, sequence: data.sequence }); visible();
    }
  });
  const ready = () => { visible(); send('ks-html-ready'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
  new MutationObserver(() => visible()).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();`;

export function htmlViewSource(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (root: Document | DocumentFragment) => {
    root.querySelectorAll("script, iframe, frame, object, embed, base, meta[http-equiv]").forEach((element) => element.remove());
    root.querySelectorAll("*").forEach((element) => {
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (name.startsWith("on") || (["href", "src", "action", "formaction", "xlink:href"].includes(name) && /^(?:javascript:|https?:|\/\/)/.test(value))) element.removeAttribute(attr.name);
      }
      if (element instanceof HTMLTemplateElement) clean(element.content);
    });
  };
  clean(doc);
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'sha256-Z+GZTb2mxn7BB3pUvOGrqUorfFwZv5mwKQAb0AG9CTk='; connect-src 'none'; form-action 'none';";
  csp.dataset.ksInjected = "";
  const style = doc.createElement("style"); style.dataset.ksInjected = "";
  const tokens = getComputedStyle(document.documentElement);
  const names = ["--ks-color-accent", "--ks-color-accent-contrast", "--ks-color-selection", "--ks-color-text", "--ks-color-focus", "--ks-color-scroll-thumb", "--ks-type-meta", "--ks-font-family", "--ks-space-1", "--ks-space-2", "--ks-space-4", "--ks-space-5", "--ks-line-width", "--ks-focus-width", "--ks-focus-offset", "--ks-radius-small", "--ks-radius-large"];
  style.textContent = `:root{${names.map((name) => `${name}:${tokens.getPropertyValue(name)};`).join("")}}` +
    "*::-webkit-scrollbar{width:var(--ks-space-2);height:var(--ks-space-2)}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:var(--ks-color-scroll-thumb);border-radius:var(--ks-radius-large);border:calc(var(--ks-line-width) * 2) solid transparent;background-clip:padding-box}*::-webkit-scrollbar-button{display:none}*:focus-visible{outline:var(--ks-focus-width) solid var(--ks-color-focus);outline-offset:var(--ks-focus-offset)}" +
    ".ks-html-marker{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;margin-left:var(--ks-space-2);min-width:var(--ks-space-5);height:var(--ks-space-5);padding:0 var(--ks-space-1);border:0;border-radius:var(--ks-radius-large);background:var(--ks-color-accent);color:var(--ks-color-accent-contrast);font-family:var(--ks-font-family);font-size:var(--ks-type-meta);font-weight:600;line-height:1;cursor:pointer}.ks-html-focused{outline:var(--ks-focus-width) solid var(--ks-color-accent)!important}::highlight(ks-html-comments){background:var(--ks-color-selection);color:var(--ks-color-text)}";
  const script = doc.createElement("script"); script.dataset.ksInjected = ""; script.textContent = bridge;
  doc.head.prepend(csp, style, script);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
