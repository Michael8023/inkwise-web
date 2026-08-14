const toggle = document.getElementById("auto-open");

chrome.storage.sync.get({ autoOpenPdf: true }, ({ autoOpenPdf }) => {
  toggle.checked = autoOpenPdf !== false;
});
toggle.addEventListener("change", () => chrome.storage.sync.set({ autoOpenPdf: toggle.checked }));

document.getElementById("open-account").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html?account=1") });
  window.close();
});
document.getElementById("open-reader").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
  window.close();
});
