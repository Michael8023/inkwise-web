const READER_PATH = "index.html";

function readerUrl(pdfUrl, mode = "reader") {
  return `${chrome.runtime.getURL(READER_PATH)}?openPdfUrl=${encodeURIComponent(pdfUrl)}&mode=${mode}`;
}

function looksLikePdf(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const path = parsed.pathname.toLowerCase();
    // Covers regular PDF files and common academic direct-PDF routes such as
    // arXiv's /pdf/1234.5678 without redirecting ordinary web pages.
    return /\.pdf$/.test(path) || /\/pdf(?:\/|$)/.test(path);
  } catch {
    return false;
  }
}

async function autoOpenPdf(details) {
  if (details.frameId !== 0 || !looksLikePdf(details.url)) return;
  const { autoOpenPdf = true } = await chrome.storage.sync.get({ autoOpenPdf: true });
  const current = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!current || current.url?.startsWith(chrome.runtime.getURL(""))) return;
  await chrome.tabs.update(details.tabId, { url: readerUrl(details.url, autoOpenPdf ? "reader" : "compact") });
}

chrome.webNavigation.onCommitted.addListener((details) => {
  void autoOpenPdf(details);
});

// Turning the switch back on from the extension popup immediately reopens the
// active native-PDF tab in Inkwise, instead of waiting for the next PDF.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || changes.autoOpenPdf?.newValue !== true) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (tab?.id !== undefined && tab.url && looksLikePdf(tab.url)) {
      void chrome.tabs.update(tab.id, { url: readerUrl(tab.url) });
    }
  });
});
