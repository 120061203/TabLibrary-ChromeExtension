chrome.action.onClicked.addListener(async () => {
  const libraryUrl = chrome.runtime.getURL('library.html');

  try {
    const [existing] = await chrome.tabs.query({ url: libraryUrl });

    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }

    await chrome.tabs.create({ url: libraryUrl });
  } catch (error) {
    console.error('Failed to open Page Library:', error);
  }
});
