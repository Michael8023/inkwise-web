const READER_PATH = "index.html";

chrome.action.onClicked.addListener(() => {
  const readerUrl = chrome.runtime.getURL(READER_PATH);
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find((tab) => tab.url === readerUrl);
    if (existing?.id !== undefined) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    chrome.tabs.create({ url: readerUrl });
  });
});
