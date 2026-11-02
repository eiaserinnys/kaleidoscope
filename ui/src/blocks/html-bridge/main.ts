const send = (type: string, detail: object = {}) => parent.postMessage({ type, ...detail }, "*");
const ready = () => {
  send("ks-html-visible-text", { text: document.body?.innerText || "" });
  send("ks-html-ready");
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
else ready();
