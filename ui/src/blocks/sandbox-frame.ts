type SandboxInit = { state: Record<string, unknown>; stateKeys: string[]; storageEntries: string[]; token: string; inputs?: Record<string, unknown> };

const encodeScript = (source: string) => `data:text/javascript;charset=utf-8;base64,${btoa(Array.from(new TextEncoder().encode(source), (byte) => String.fromCharCode(byte)).join(""))}`;
const csp = "default-src 'none'; script-src data: blob: 'unsafe-eval'; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; worker-src blob:; connect-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";

function bridgeSource(init: SandboxInit): string {
  const config = JSON.stringify(init).replace(/</g, "\\u003c");
  return `(() => {
    document.currentScript?.remove();
    const config = ${config};
    const token = config.token;
    let state = { ...config.state }, nextRequest = 0, shareText = '', shareImage = '', shareCanvas = null, explicitText = false;
    const stateListeners = new Set(), storageListeners = new Map(), pending = new Map(), pendingWrites = new Set();
    const send = (type, body = {}, transfer) => transfer ? parent.postMessage({ token, type, ...body }, '*', transfer) : parent.postMessage({ token, type, ...body }, '*');
    const inputListeners = new Set(), handlers = new Map(), surfaceListeners = new Map(), surfaces = new Map();
    let inputs = config.inputs || {};
    const clientRequest = (type, body = {}, transfer) => new Promise((resolve, reject) => {
      const requestId = String(++nextRequest); pending.set(requestId, { resolve, reject });
      send(type, { requestId, ...body }, transfer);
    });
    const request = (type, entry, content) => new Promise((resolve, reject) => {
      if (!config.storageEntries.includes(entry)) { reject(new Error('허용되지 않은 저장 항목')); return; }
      const requestId = String(++nextRequest);
      pending.set(requestId, { resolve, reject });
      send(type, { requestId, entry, ...(type === 'ks-sandbox-storage-set' ? { content } : {}) });
    });
    const canvasImage = async canvas => {
      try {
        if (canvas && typeof canvas.convertToBlob === 'function') {
          const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
          if (bytes.length > 10 * 1024 * 1024) return '';
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return btoa(binary);
        }
        const url = canvas && canvas.toDataURL('image/png'); return url && url.startsWith('data:image/png;base64,') ? url.slice(22) : '';
      }
      catch { return ''; }
    };
    const largestCanvas = () => [...document.querySelectorAll('canvas')].filter(c => {
      const r = c.getBoundingClientRect(), s = getComputedStyle(c);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    }).sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return y.width * y.height - x.width * x.height; })[0];
    const automaticText = () => {
      const fields = [...document.querySelectorAll('input,textarea,select')].filter(el => {
        if (el.type === 'hidden' || el.type === 'password' || el.closest('[hidden]')) return false;
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }).map(el => (el.getAttribute('aria-label') || el.name || el.placeholder || '') + ': ' + el.value);
      return [document.body?.innerText || '', ...fields].filter(Boolean).join('\\n');
    };
    const report = async () => send('ks-sandbox-share', { text: explicitText ? shareText : automaticText(), imageBase64: await canvasImage(shareCanvas) || shareImage || await canvasImage(largestCanvas()) });
    let reportTimer;
    const schedule = () => { clearTimeout(reportTimer); reportTimer = setTimeout(report, 400); };
    window.kaleidoscope = {
      getState(key) { return key === undefined ? { ...state } : state[key]; },
      setState(key, value) {
        const patch = typeof key === 'string' ? { [key]: value } : key;
        const allowed = Object.fromEntries(Object.entries(patch || {}).filter(([name]) => config.stateKeys.includes(name)));
        state = { ...state, ...allowed }; send('ks-sandbox-state-set', { patch: allowed });
      },
      onStateChange(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
      getStorage(entry) { return request('ks-sandbox-storage-get', entry); },
      setStorage(entry, content) {
        const write = request('ks-sandbox-storage-set', entry, content);
        pendingWrites.add(write); write.then(() => pendingWrites.delete(write), () => pendingWrites.delete(write));
        return write;
      },
      onStorageChange(entry, listener) { const set = storageListeners.get(entry) || new Set(); set.add(listener); storageListeners.set(entry, set); return () => set.delete(listener); },
      get inputs() { return inputs; },
      onInputs(listener) { inputListeners.add(listener); return () => inputListeners.delete(listener); },
      publish(patch) { send('ks-client-publish', { patch }); },
      handle(name, listener) { handlers.set(name, listener); },
      command(name, event) { return clientRequest('ks-client-command', { name, event }); },
      surfaces: { on(id, listener) {
        const set = surfaceListeners.get(id) || new Set(); set.add(listener); surfaceListeners.set(id, set);
        if (surfaces.has(id)) listener(surfaces.get(id));
        return () => set.delete(listener);
      } },
      files: {
        read(id) { return clientRequest('ks-client-file-read', { id }); },
        write(sink, offset, bytes) { return clientRequest('ks-client-file-write', { sink, offset, bytes }, [bytes]); },
        close(sink) { return clientRequest('ks-client-file-close', { sink }); },
        abort(sink) { return clientRequest('ks-client-file-abort', { sink }); },
      },
      assets: { bytes(id) { return clientRequest('ks-client-asset-bytes', { id }); } },
      notice(message) { send('ks-client-notice', { message }); },
      reportShare(payload = {}) {
        if (typeof payload.text === 'string') { explicitText = true; shareText = payload.text; }
        if (typeof payload.imageBase64 === 'string') shareImage = payload.imageBase64.replace(/^data:image\\/png;base64,/, '');
        if (payload.canvas) shareCanvas = payload.canvas;
        report();
      },
    };
    window.addEventListener('message', event => {
      if (event.source !== parent || !event.data) return;
      const data = event.data;
      if (data.type === 'ks-client-inputs') { inputs = data.inputs; inputListeners.forEach(fn => fn(inputs, data.changed)); }
      if (data.type === 'ks-client-action') { const handler = handlers.get(data.name); if (handler) Promise.resolve().then(() => handler(data.context)).catch(error => send('ks-client-notice', { message: String(error), error: true })); }
      if (data.type === 'ks-client-ping') send('ks-client-pong');
      if (data.type === 'ks-client-reply') { const job = pending.get(data.requestId); if (job) { pending.delete(data.requestId); data.error ? job.reject(new Error(data.error)) : job.resolve(data.result); } }
      if (data.type === 'ks-client-surface') {
        if (data.phase === 'detach') { surfaces.delete(data.id); surfaceListeners.get(data.id)?.forEach(fn => fn(null)); }
        else {
          const surface = data.phase === 'attach' ? { id: data.id, generation: data.generation, canvas: data.canvas, cssWidth: data.css_width, cssHeight: data.css_height, dpr: data.dpr, resize: new EventTarget() } : surfaces.get(data.id);
          if (surface && surface.generation === data.generation) {
            surface.cssWidth = data.css_width; surface.cssHeight = data.css_height; surface.dpr = data.dpr; surfaces.set(data.id, surface);
            if (data.phase === 'attach') surfaceListeners.get(data.id)?.forEach(fn => fn(surface));
            else surface.resize.dispatchEvent(new Event('resize'));
          }
        }
      }
      if (data.type === 'ks-client-snapshot') {
        const surface = surfaces.get(data.id);
        if (surface) surface.canvas.convertToBlob({ type: 'image/png' }).then(blob => blob.arrayBuffer()).then(bytes => send('ks-client-snapshot-result', { requestId: data.requestId, bytes }, [bytes])).catch(error => send('ks-client-snapshot-result', { requestId: data.requestId, error: String(error) }));
      }
      if (data.type === 'ks-sandbox-state-sync') { state = { ...data.state }; stateListeners.forEach(fn => fn({ ...state })); }
      if (data.type === 'ks-sandbox-storage-sync') {
        const listeners = storageListeners.get(data.entry);
        if (listeners?.size) {
          const accepted = [...listeners].map(fn => fn(data.content)).every(result => result !== false);
          if (accepted && data.revision !== undefined) send('ks-sandbox-storage-applied', { entry: data.entry, revision: data.revision });
        }
      }
      if (data.type === 'ks-sandbox-storage-reply') { const job = pending.get(data.requestId); if (job) { pending.delete(data.requestId); data.error ? job.reject(new Error(data.error)) : job.resolve(data.content); } }
      if (data.type === 'ks-sandbox-request-share') report();
      if (data.type === 'ks-sandbox-flush') {
        window.dispatchEvent(new Event('pagehide'));
        Promise.all([...pendingWrites]).then(() => send('ks-sandbox-flushed', { requestId: data.requestId, ok: true }), () => send('ks-sandbox-flushed', { requestId: data.requestId, ok: false }));
      }
    });
    document.addEventListener('click', event => {
      const anchor = event.target.closest?.('a');
      if (anchor && !(anchor.hasAttribute('download') && /^(?:blob:|data:)/i.test((anchor.getAttribute('href') || '').trim()))) event.preventDefault();
      schedule();
    }, true);
    document.addEventListener('submit', event => { event.preventDefault(); schedule(); }, true);
    document.addEventListener('input', schedule, true); document.addEventListener('change', schedule, true);
    const ready = () => { send('ks-sandbox-ready'); report(); new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
    setInterval(report, 1000);
  })();`;
}

export function clientSource(script: string, init: SandboxInit): string {
  return sandboxSource(`<html><head><script src="${encodeScript(script)}"></script></head><body></body></html>`, init);
}

export function sandboxSource(rawHtml: string, init: SandboxInit): string {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const handlers: Array<{ id: string; event: string; code: string }> = [];
  let sequence = 0;
  const clean = (root: Document | DocumentFragment) => {
    root.querySelectorAll("iframe, frame, object, embed, base, meta[http-equiv]").forEach((element) => element.remove());
    root.querySelectorAll("*").forEach((element) => {
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") && name.length >= 3) {
          const id = element.getAttribute("data-ks-on-id") ?? String(++sequence); element.setAttribute("data-ks-on-id", id);
          if (!/\blocation\s*(?:\.href\s*=|=|\.(?:assign|replace)\b)/.test(attr.value)) handlers.push({ id, event: name.slice(2), code: attr.value });
          element.removeAttribute(attr.name);
        } else if (["href", "src", "action", "formaction"].includes(name) && /^(?:https?:|\/\/|javascript:)/i.test(attr.value.trim())) element.removeAttribute(attr.name);
      }
      if (element instanceof HTMLTemplateElement) clean(element.content);
    });
  };
  clean(doc);
  doc.querySelectorAll("script").forEach((script) => {
    if (!script.hasAttribute("src") && (!script.type || ["text/javascript", "application/javascript", "module"].includes(script.type))) {
      script.src = encodeScript(script.textContent ?? ""); script.textContent = "";
    }
  });
  const policy = doc.createElement("meta"); policy.httpEquiv = "Content-Security-Policy"; policy.content = csp; policy.dataset.ksInjected = "";
  const bridge = doc.createElement("script"); bridge.dataset.ksInjected = ""; bridge.src = encodeScript(bridgeSource(init));
  doc.head.prepend(policy, bridge);
  if (handlers.length) {
    const script = doc.createElement("script"); script.dataset.ksInjected = "";
    script.src = encodeScript(`for (const item of ${JSON.stringify(handlers).replace(/</g, "\\u003c")}) {
      const body = document.body;
      if (item.event === 'load' && body.getAttribute('data-ks-on-id') === item.id) {
        window.addEventListener('load', event => new Function('event', item.code).call(body, event));
      } else {
        document.addEventListener(item.event, function(event) { const el = event.composedPath().find(node => node instanceof Element && node.getAttribute('data-ks-on-id') === item.id); if (el && new Function('event', item.code).call(el, event) === false) event.preventDefault(); }, true);
      }
    }`);
    doc.body.append(script);
  }
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
