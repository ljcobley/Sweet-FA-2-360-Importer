chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "DOWNLOAD_CSV" && msg?.payload?.csv && msg?.payload?.filename) {
    const blob = new Blob([msg.payload.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename: msg.payload.filename, saveAs: true },
      () => URL.revokeObjectURL(url)
    );
    sendResponse({ ok: true });
  }
});
