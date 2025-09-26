const cardsContainer = document.getElementById('cards-container');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const refreshButton = document.getElementById('refresh-button');
const groupingSelect = document.getElementById('grouping-select');
const sortSelect = document.getElementById('sort-select');
const toggleSelectionModeButton = document.getElementById('toggle-selection-mode');
const exportButton = document.getElementById('export-button');
const copyButton = document.getElementById('copy-button');
const bulkActions = document.getElementById('bulk-actions');
const selectionCountLabel = document.getElementById('selection-count');
const selectAllButton = document.getElementById('select-all-button');
const clearSelectionButton = document.getElementById('clear-selection-button');
const bulkFocusButton = document.getElementById('bulk-focus-button');
const bulkCloseButton = document.getElementById('bulk-close-button');
const bulkPinButton = document.getElementById('bulk-pin-button');
const bulkNewWindowButton = document.getElementById('bulk-new-window-button');
const bulkGroupButton = document.getElementById('bulk-group-button');
const saveSnapshotButton = document.getElementById('save-snapshot-button');
const clearSnapshotsButton = document.getElementById('clear-snapshots-button');
const snapshotList = document.getElementById('snapshot-list');
const preferencesForm = document.getElementById('preferences-form');
const tagDialog = document.getElementById('tag-dialog');
const tagDialogInput = document.getElementById('tag-input');
const tagDialogUrl = tagDialog.querySelector('.dialog-url');
const toast = document.getElementById('toast');
const tagDialogSaveButton = document.getElementById('tag-dialog-save');

const tabGroupTemplate = document.getElementById('tab-group-template');
const tabCardTemplate = document.getElementById('tab-card-template');
const tagChipTemplate = document.getElementById('tag-chip-template');
const snapshotItemTemplate = document.getElementById('snapshot-item-template');

const STORAGE_KEYS = {
  tags: 'pageLibrary.tabTags',
  snapshots: 'pageLibrary.snapshots',
  preferences: 'pageLibrary.preferences'
};

const DEFAULT_PREFERENCES = {
  defaultGrouping: 'none',
  defaultSorting: 'lastAccessed-desc',
  hideDiscarded: false,
  autoRefreshOnFocus: true
};

const EMPTY_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAK0lEQVQoU2N89uzZfzYwYGA4EKrAxIScAHEAYkawApKNgQlYNA0bBwDq5Q98o+SXfgAAAABJRU5ErkJggg==';

const state = {
  cachedTabs: [],
  filteredTabs: [],
  grouping: DEFAULT_PREFERENCES.defaultGrouping,
  sorting: DEFAULT_PREFERENCES.defaultSorting,
  selectionMode: false,
  selectedTabIds: new Set(),
  tags: {},
  snapshots: [],
  preferences: { ...DEFAULT_PREFERENCES },
  windowInfo: new Map(),
  tabGroupInfo: new Map(),
  currentTagContext: null
};

function getUrlKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return url;
  }
}

const hasChromeStorageSync = Boolean(chrome.storage && chrome.storage.sync);

function storageGet(key) {
  if (hasChromeStorageSync) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(key, resolve);
    });
  }

  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : undefined;
    return Promise.resolve({ [key]: value });
  } catch (error) {
    console.error('讀取本地儲存時發生錯誤', error);
    return Promise.resolve({ [key]: undefined });
  }
}

function storageSet(items) {
  if (hasChromeStorageSync) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(items, resolve);
    });
  }

  try {
    Object.entries(items).forEach(([key, value]) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    });
  } catch (error) {
    console.error('寫入本地儲存時發生錯誤', error);
  }
  return Promise.resolve();
}

function syncSelectionWithTabs() {
  const validIds = new Set(state.cachedTabs.map((tab) => tab.id));
  state.selectedTabIds = new Set(
    [...state.selectedTabIds].filter((tabId) => validIds.has(tabId))
  );
}

function showToast(message, timeout = 2600) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
    toast.textContent = '';
  }, timeout);
}

function normalizeString(value) {
  return value?.toLowerCase() ?? '';
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '未知時間';
  }
  const diff = Date.now() - timestamp;
  const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
  const seconds = Math.round(diff / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  if (Math.abs(seconds) < 60) {
    return rtf.format(-seconds, 'second');
  }
  if (Math.abs(minutes) < 60) {
    return rtf.format(-minutes, 'minute');
  }
  if (Math.abs(hours) < 24) {
    return rtf.format(-hours, 'hour');
  }
  return rtf.format(-days, 'day');
}

async function queryAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => (state.preferences.hideDiscarded ? !tab.discarded : true));
  } catch (error) {
    console.error('無法取得分頁資料', error);
    showToast('取得分頁資料時發生錯誤');
    return [];
  }
}

async function hydrateWindowInfo(tabs) {
  const uniqueWindowIds = [...new Set(tabs.map((tab) => tab.windowId))];
  const entries = await Promise.all(
    uniqueWindowIds.map(async (windowId) => {
      try {
        const windowData = await chrome.windows.get(windowId, {});
        return [windowId, windowData];
      } catch (error) {
        return [windowId, null];
      }
    })
  );
  state.windowInfo = new Map(entries);
}

async function hydrateTabGroupInfo(tabs) {
  if (!chrome.tabGroups || typeof chrome.tabGroups.get !== 'function') {
    state.tabGroupInfo = new Map();
    return;
  }
  const uniqueGroupIds = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => id && id !== -1))];
  const entries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      try {
        const group = await chrome.tabGroups.get(groupId);
        return [groupId, group];
      } catch (error) {
        return [groupId, null];
      }
    })
  );
  state.tabGroupInfo = new Map(entries);
}

function getDomainLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || '其他';
  } catch (error) {
    return '其他';
  }
}

function getTagsForTab(tab) {
  if (!tab.url) {
    return [];
  }
  const key = getUrlKey(tab.url);
  return state.tags[key] ?? [];
}

function sortTabs(tabs) {
  const [field, direction] = state.sorting.split('-');
  const factor = direction === 'desc' ? -1 : 1;
  return [...tabs].sort((a, b) => {
    switch (field) {
      case 'title':
        return normalizeString(a.title).localeCompare(normalizeString(b.title)) * factor;
      case 'domain':
        return getDomainLabel(a.url).localeCompare(getDomainLabel(b.url)) * factor;
      case 'lastAccessed':
        return ((a.lastAccessed || 0) - (b.lastAccessed || 0)) * factor;
      default:
        return 0;
    }
  });
}

function buildGroups(tabs) {
  if (state.grouping === 'none') {
    return [
      {
        key: 'all',
        title: `全部分頁 (${tabs.length})`,
        tabs
      }
    ];
  }

  if (state.grouping === 'window') {
    const groups = new Map();
    tabs.forEach((tab) => {
      const windowData = state.windowInfo.get(tab.windowId);
      const windowTitle = windowData?.title ? windowData.title : `視窗 ${tab.windowId}`;
      const displayTitle = windowData?.focused ? `${windowTitle}（目前視窗）` : windowTitle;
      if (!groups.has(tab.windowId)) {
        groups.set(tab.windowId, {
          key: `window-${tab.windowId}`,
          title: displayTitle,
          tabs: []
        });
      }
      groups.get(tab.windowId).tabs.push(tab);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      tabs: sortTabs(group.tabs)
    }));
  }

  if (state.grouping === 'domain') {
    const groups = new Map();
    tabs.forEach((tab) => {
      const domain = getDomainLabel(tab.url);
      if (!groups.has(domain)) {
        groups.set(domain, {
          key: `domain-${domain}`,
          title: domain,
          tabs: []
        });
      }
      groups.get(domain).tabs.push(tab);
    });
    return [...groups.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((group) => ({
        ...group,
        tabs: sortTabs(group.tabs)
      }));
  }

  if (state.grouping === 'tag') {
    const groups = new Map();
    const untagged = [];

    tabs.forEach((tab) => {
      const tags = getTagsForTab(tab);
      if (!tags.length) {
        untagged.push(tab);
        return;
      }
      tags.forEach((tag) => {
        if (!groups.has(tag)) {
          groups.set(tag, {
            key: `tag-${tag}`,
            title: `標籤：${tag}`,
            tabs: []
          });
        }
        groups.get(tag).tabs.push(tab);
      });
    });

    const groupArray = [...groups.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((group) => ({
        ...group,
        tabs: sortTabs([...new Set(group.tabs)])
      }));

    if (untagged.length) {
      groupArray.push({
        key: 'tag-untagged',
        title: '未標籤',
        tabs: sortTabs(untagged)
      });
    }

    return groupArray;
  }

  return [
    {
      key: 'all',
      title: `全部分頁 (${tabs.length})`,
      tabs
    }
  ];
}

function filterTabs(tabs) {
  const keyword = normalizeString(searchInput.value.trim());
  if (!keyword) {
    return tabs;
  }

  return tabs.filter((tab) => {
    const title = normalizeString(tab.title);
    const url = normalizeString(tab.url);
    const tags = getTagsForTab(tab).map(normalizeString);
    return (
      title.includes(keyword) ||
      url.includes(keyword) ||
      tags.some((tag) => tag.includes(keyword))
    );
  });
}

function renderTabs(groups) {
  cardsContainer.innerHTML = '';

  if (!groups.length || groups.every((group) => group.tabs.length === 0)) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    const groupElement = tabGroupTemplate.content.firstElementChild.cloneNode(true);
    const titleElement = groupElement.querySelector('.group-title');
    const countElement = groupElement.querySelector('.group-count');
    const container = groupElement.querySelector('.group-cards');

    titleElement.textContent = group.title;
    countElement.textContent = `${group.tabs.length} 個分頁`;

    group.tabs.forEach((tab, index) => {
      const card = createTabCard(tab);
      card.dataset.groupKey = group.key;
      card.dataset.index = `${index}`;
      container.appendChild(card);
    });

    fragment.appendChild(groupElement);
  });

  cardsContainer.appendChild(fragment);
  updateSelectionUI();
}

function createTabCard(tab) {
  const clone = tabCardTemplate.content.firstElementChild.cloneNode(true);
  const titleElement = clone.querySelector('.tab-title');
  const urlElement = clone.querySelector('.tab-url');
  const metaElement = clone.querySelector('.tab-meta');
  const faviconImg = clone.querySelector('.favicon');
  const pinnedBadge = clone.querySelector('.badge.pinned');
  const audibleBadge = clone.querySelector('.badge.audible');
  const lastAccess = clone.querySelector('.last-access');
  const focusButton = clone.querySelector('.focus-button');
  const muteButton = clone.querySelector('.mute-button');
  const closeButton = clone.querySelector('.close-button');
  const tagList = clone.querySelector('.tag-list');
  const addTagButton = clone.querySelector('.add-tag-button');
  const checkbox = clone.querySelector('.tab-checkbox');

  clone.dataset.tabId = tab.id;
  clone.dataset.windowId = tab.windowId;

  const titleText = tab.title?.trim() || '未命名分頁';
  titleElement.textContent = titleText;
  urlElement.textContent = tab.url || '';

  faviconImg.src = tab.favIconUrl || EMPTY_FAVICON;
  faviconImg.alt = `${titleText} 的網站圖示`;

  pinnedBadge.hidden = !tab.pinned;
  audibleBadge.hidden = !tab.audible;

  const metaItems = [];
  if (tab.mutedInfo?.muted) {
    metaItems.push('已靜音');
  }
  if (tab.discarded) {
    metaItems.push('已卸載');
  }
  if (state.tabGroupInfo.has(tab.groupId)) {
    const groupInfo = state.tabGroupInfo.get(tab.groupId);
    if (groupInfo?.title) {
      metaItems.push(`群組：${groupInfo.title}`);
    }
  }
  metaItems.push(`視窗：${tab.windowId}`);
  metaElement.textContent = metaItems.join(' · ');

  lastAccess.textContent = `最後瀏覽：${formatRelativeTime(tab.lastAccessed)}`;

  muteButton.textContent = tab.mutedInfo?.muted ? '取消靜音' : '靜音';

  renderTagList(tagList, tab);

  focusButton.addEventListener('click', () => focusTab(tab));
  muteButton.addEventListener('click', () => toggleMute(tab));
  closeButton.addEventListener('click', () => closeTab(tab));
  addTagButton.addEventListener('click', () => openTagDialog(tab));

  checkbox.dataset.tabId = `${tab.id}`;
  checkbox.hidden = !state.selectionMode;
  checkbox.checked = state.selectedTabIds.has(tab.id);
  checkbox.addEventListener('change', () => toggleTabSelection(tab.id, checkbox.checked));

  clone.addEventListener('click', (event) => {
    if (!state.selectionMode) {
      return;
    }
    const target = event.target;
    if (target === checkbox || target.closest('button')) {
      return;
    }
    checkbox.checked = !checkbox.checked;
    toggleTabSelection(tab.id, checkbox.checked);
  });

  clone.addEventListener('keydown', (event) => handleCardKeydown(event, tab));

  return clone;
}

function renderTagList(container, tab) {
  container.innerHTML = '';
  const tags = getTagsForTab(tab);
  const fragment = document.createDocumentFragment();
  tags.forEach((tag) => {
    const chip = tagChipTemplate.content.firstElementChild.cloneNode(true);
    chip.querySelector('.tag-text').textContent = tag;
    const removeButton = chip.querySelector('.remove-tag');
    removeButton.addEventListener('click', () => removeTag(tab, tag));
    fragment.appendChild(chip);
  });
  container.appendChild(fragment);
}

async function focusTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.error('切換分頁時發生錯誤', error);
    showToast('切換分頁失敗');
  }
}

async function toggleMute(tab) {
  try {
    const muted = !tab.mutedInfo?.muted;
    await chrome.tabs.update(tab.id, { muted });
    showToast(muted ? '已靜音此分頁' : '已恢復音訊');
    await refreshTabs();
  } catch (error) {
    console.error('切換靜音時發生錯誤', error);
    showToast('無法切換靜音狀態');
  }
}

async function closeTab(tab) {
  try {
    await chrome.tabs.remove(tab.id);
    showToast('已關閉分頁');
    await refreshTabs();
  } catch (error) {
    console.error('關閉分頁時發生錯誤', error);
    showToast('關閉分頁失敗');
  }
}

function toggleTabSelection(tabId, shouldSelect) {
  if (shouldSelect) {
    state.selectedTabIds.add(tabId);
  } else {
    state.selectedTabIds.delete(tabId);
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const selectionCount = state.selectedTabIds.size;
  if (state.selectionMode && selectionCount > 0) {
    bulkActions.hidden = false;
  } else {
    bulkActions.hidden = !state.selectionMode;
  }

  selectionCountLabel.textContent = `已選取 ${selectionCount} 個分頁`;

  const checkboxes = cardsContainer.querySelectorAll('.tab-checkbox');
  checkboxes.forEach((checkbox) => {
    checkbox.hidden = !state.selectionMode;
    const tabId = Number(checkbox.dataset.tabId);
    checkbox.checked = state.selectedTabIds.has(tabId);
  });

  toggleSelectionModeButton.textContent = state.selectionMode ? '關閉多選' : '開啟多選';
  toggleSelectionModeButton.setAttribute('aria-pressed', String(state.selectionMode));
}

function clearSelection() {
  state.selectedTabIds.clear();
  updateSelectionUI();
}

async function selectAllVisible() {
  const visibleTabIds = state.filteredTabs.map((tab) => tab.id);
  visibleTabIds.forEach((id) => state.selectedTabIds.add(id));
  updateSelectionUI();
}

async function bulkFocus() {
  const targetTab = state.cachedTabs.find((tab) => state.selectedTabIds.has(tab.id));
  if (!targetTab) {
    showToast('尚未選取分頁');
    return;
  }
  await focusTab(targetTab);
}

async function bulkClose() {
  if (!state.selectedTabIds.size) {
    return;
  }
  try {
    await chrome.tabs.remove([...state.selectedTabIds]);
    showToast('已關閉選取的分頁');
    state.selectedTabIds.clear();
    await refreshTabs();
  } catch (error) {
    console.error('批次關閉失敗', error);
    showToast('批次關閉失敗');
  }
}

async function bulkPinToggle() {
  if (!state.selectedTabIds.size) {
    return;
  }
  try {
    const selectedTabs = state.cachedTabs.filter((tab) => state.selectedTabIds.has(tab.id));
    const shouldPin = selectedTabs.some((tab) => !tab.pinned);
    await Promise.all(selectedTabs.map((tab) => chrome.tabs.update(tab.id, { pinned: shouldPin })));
    showToast(shouldPin ? '已釘選選取的分頁' : '已取消釘選');
    await refreshTabs();
  } catch (error) {
    console.error('批次釘選失敗', error);
    showToast('批次釘選失敗');
  }
}

async function bulkMoveToNewWindow() {
  if (!state.selectedTabIds.size) {
    return;
  }
  try {
    const tabIds = [...state.selectedTabIds];
    const firstId = tabIds[0];
    const createdWindow = await chrome.windows.create({ tabId: firstId, focused: true });
    if (tabIds.length > 1) {
      await chrome.tabs.move(tabIds.slice(1), { windowId: createdWindow.id, index: -1 });
    }
    showToast('已將分頁移動到新視窗');
    await refreshTabs();
  } catch (error) {
    console.error('移動到新視窗失敗', error);
    showToast('無法移動到新視窗');
  }
}

async function bulkCreateGroup() {
  if (!state.selectedTabIds.size) {
    return;
  }
  if (!chrome.tabs.group || !chrome.tabGroups || typeof chrome.tabGroups.update !== 'function') {
    showToast('此瀏覽器版本不支援分頁群組功能');
    return;
  }
  const title = window.prompt('請輸入新的分頁群組名稱', 'TabLibrary');
  if (title === null) {
    return;
  }
  try {
    const tabIds = [...state.selectedTabIds];
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title, color: 'blue' });
    showToast(`已建立分頁群組「${title}」`);
    await refreshTabs();
  } catch (error) {
    console.error('建立分頁群組失敗', error);
    showToast('無法建立分頁群組');
  }
}

function handleCardKeydown(event, tab) {
  const cards = Array.from(cardsContainer.querySelectorAll('.tab-card'));
  const currentIndex = cards.indexOf(event.currentTarget);
  if (currentIndex === -1) {
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      cards[(currentIndex + 1) % cards.length]?.focus();
      break;
    case 'ArrowUp':
      event.preventDefault();
      cards[(currentIndex - 1 + cards.length) % cards.length]?.focus();
      break;
    case 'Enter':
      event.preventDefault();
      focusTab(tab);
      break;
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      closeTab(tab);
      break;
    case ' ':
      if (state.selectionMode) {
        event.preventDefault();
        const checkbox = event.currentTarget.querySelector('.tab-checkbox');
        const nextValue = !checkbox.checked;
        checkbox.checked = nextValue;
        toggleTabSelection(tab.id, nextValue);
      }
      break;
    default:
      break;
  }
}

async function openTagDialog(tab) {
  state.currentTagContext = tab;
  tagDialogUrl.textContent = tab.title || tab.url || '未命名分頁';
  const tags = getTagsForTab(tab);
  tagDialogInput.value = tags.join(', ');
  tagDialog.showModal();
}

async function saveTagsFromDialog() {
  if (!state.currentTagContext?.url) {
    tagDialog.close();
    return;
  }
  const rawTags = tagDialogInput.value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const uniqueTags = [...new Set(rawTags)];
  const key = getUrlKey(state.currentTagContext.url);
  state.tags[key] = uniqueTags;
  await storageSet({ [STORAGE_KEYS.tags]: state.tags });
  showToast('已更新標籤');
  tagDialog.close();
  await refreshTabs();
}

async function removeTag(tab, tagToRemove) {
  if (!tab.url) {
    return;
  }
  const key = getUrlKey(tab.url);
  const existing = state.tags[key] ?? [];
  state.tags[key] = existing.filter((tag) => tag !== tagToRemove);
  await storageSet({ [STORAGE_KEYS.tags]: state.tags });
  showToast(`已移除標籤「${tagToRemove}」`);
  await refreshTabs();
}

async function saveSnapshot() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const snapshotId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const snapshot = {
      id: snapshotId,
      createdAt: Date.now(),
      windows: windows.map((window) => ({
        focused: window.focused,
        tabs: window.tabs?.map((tab) => ({
          url: tab.url,
          title: tab.title,
          pinned: tab.pinned,
          active: tab.active
        })) || []
      }))
    };

    const snapshots = [snapshot, ...state.snapshots].slice(0, 20);
    state.snapshots = snapshots;
    await storageSet({ [STORAGE_KEYS.snapshots]: snapshots });
    renderSnapshots();
    showToast('已儲存分頁快照');
  } catch (error) {
    console.error('儲存快照時發生錯誤', error);
    showToast('無法儲存快照');
  }
}

async function clearSnapshots() {
  if (!state.snapshots.length) {
    return;
  }
  const confirmed = window.confirm('確定要刪除所有快照嗎？此動作無法復原。');
  if (!confirmed) {
    return;
  }
  state.snapshots = [];
  await storageSet({ [STORAGE_KEYS.snapshots]: [] });
  renderSnapshots();
  showToast('已清除所有快照');
}

async function restoreSnapshot(snapshotId) {
  const snapshot = state.snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) {
    return;
  }
  try {
    for (const [index, windowData] of snapshot.windows.entries()) {
      if (!windowData.tabs.length) {
        continue;
      }
      const [firstTab, ...restTabs] = windowData.tabs;
      const createdWindow = await chrome.windows.create({
        url: firstTab.url,
        focused: index === 0
      });
      if (firstTab.pinned) {
        await chrome.tabs.update(createdWindow.tabs[0].id, { pinned: true });
      }
      for (const tab of restTabs) {
        const createdTab = await chrome.tabs.create({
          windowId: createdWindow.id,
          url: tab.url,
          active: tab.active
        });
        if (tab.pinned) {
          await chrome.tabs.update(createdTab.id, { pinned: true });
        }
      }
    }
    showToast('快照已回復完成');
  } catch (error) {
    console.error('回復快照時發生錯誤', error);
    showToast('無法回復快照');
  }
}

async function deleteSnapshot(snapshotId) {
  state.snapshots = state.snapshots.filter((snapshot) => snapshot.id !== snapshotId);
  await storageSet({ [STORAGE_KEYS.snapshots]: state.snapshots });
  renderSnapshots();
  showToast('已刪除快照');
}

function renderSnapshots() {
  snapshotList.innerHTML = '';
  if (!state.snapshots.length) {
    const emptyItem = document.createElement('li');
    emptyItem.textContent = '尚未儲存任何快照';
    emptyItem.className = 'snapshot-empty';
    snapshotList.appendChild(emptyItem);
    return;
  }

  const formatter = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const fragment = document.createDocumentFragment();
  state.snapshots.forEach((snapshot) => {
    const element = snapshotItemTemplate.content.firstElementChild.cloneNode(true);
    const title = element.querySelector('.snapshot-title');
    const meta = element.querySelector('.snapshot-meta');
    const restoreButton = element.querySelector('.restore-snapshot');
    const deleteButton = element.querySelector('.delete-snapshot');

    title.textContent = `快照 · ${formatter.format(snapshot.createdAt)}`;
    const tabCount = snapshot.windows.reduce((count, window) => count + window.tabs.length, 0);
    meta.textContent = `${snapshot.windows.length} 個視窗 · ${tabCount} 個分頁`;

    restoreButton.addEventListener('click', () => restoreSnapshot(snapshot.id));
    deleteButton.addEventListener('click', () => deleteSnapshot(snapshot.id));

    fragment.appendChild(element);
  });

  snapshotList.appendChild(fragment);
}

async function exportToJson() {
  const data = {
    exportedAt: new Date().toISOString(),
    tabs: state.filteredTabs.map((tab) => ({
      title: tab.title,
      url: tab.url,
      pinned: tab.pinned,
      audible: tab.audible,
      windowId: tab.windowId,
      groupId: tab.groupId,
      tags: getTagsForTab(tab)
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `page-library-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('已匯出為 JSON');
}

async function copyListToClipboard() {
  const lines = state.filteredTabs.map((tab, index) => {
    const tags = getTagsForTab(tab);
    const tagText = tags.length ? ` [${tags.join(', ')}]` : '';
    return `${index + 1}. ${tab.title} - ${tab.url}${tagText}`;
  });
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製分頁清單');
  } catch (error) {
    console.error('複製到剪貼簿失敗', error);
    showToast('無法複製到剪貼簿');
  }
}

async function loadPreferences() {
  const stored = await storageGet(STORAGE_KEYS.preferences);
  const preferences = stored[STORAGE_KEYS.preferences] ?? DEFAULT_PREFERENCES;
  state.preferences = { ...DEFAULT_PREFERENCES, ...preferences };
  state.grouping = state.preferences.defaultGrouping;
  state.sorting = state.preferences.defaultSorting;
  groupingSelect.value = state.grouping;
  sortSelect.value = state.sorting;
  preferencesForm.querySelector('[name="defaultGrouping"]').value = state.preferences.defaultGrouping;
  preferencesForm.querySelector('[name="defaultSorting"]').value = state.preferences.defaultSorting;
  preferencesForm.querySelector('[name="hideDiscarded"]').checked = state.preferences.hideDiscarded;
  preferencesForm.querySelector('[name="autoRefreshOnFocus"]').checked = state.preferences.autoRefreshOnFocus;
}

async function savePreferences(event) {
  event.preventDefault();
  const formData = new FormData(preferencesForm);
  const preferences = {
    defaultGrouping: formData.get('defaultGrouping'),
    defaultSorting: formData.get('defaultSorting'),
    hideDiscarded: formData.get('hideDiscarded') === 'on',
    autoRefreshOnFocus: formData.get('autoRefreshOnFocus') === 'on'
  };
  state.preferences = preferences;
  state.grouping = preferences.defaultGrouping;
  state.sorting = preferences.defaultSorting;
  await storageSet({ [STORAGE_KEYS.preferences]: preferences });
  showToast('設定已儲存');
  await refreshTabs();
}

async function loadTags() {
  const stored = await storageGet(STORAGE_KEYS.tags);
  state.tags = stored[STORAGE_KEYS.tags] ?? {};
}

async function loadSnapshots() {
  const stored = await storageGet(STORAGE_KEYS.snapshots);
  state.snapshots = stored[STORAGE_KEYS.snapshots] ?? [];
  renderSnapshots();
}

async function refreshTabs() {
  state.cachedTabs = await queryAllTabs();
  await hydrateWindowInfo(state.cachedTabs);
  await hydrateTabGroupInfo(state.cachedTabs);
  syncSelectionWithTabs();
  applyFilterAndRender();
}

function applyFilterAndRender() {
  const filtered = filterTabs(sortTabs(state.cachedTabs));
  state.filteredTabs = filtered;
  const groups = buildGroups(filtered);
  renderTabs(groups);
}

function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  if (!state.selectionMode) {
    state.selectedTabIds.clear();
  }
  updateSelectionUI();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && state.preferences.autoRefreshOnFocus) {
    refreshTabs();
  }
}

function setupEventListeners() {
  refreshButton.addEventListener('click', refreshTabs);
  searchInput.addEventListener('input', applyFilterAndRender);
  groupingSelect.addEventListener('change', () => {
    state.grouping = groupingSelect.value;
    applyFilterAndRender();
  });
  sortSelect.addEventListener('change', () => {
    state.sorting = sortSelect.value;
    applyFilterAndRender();
  });
  toggleSelectionModeButton.addEventListener('click', toggleSelectionMode);
  selectAllButton.addEventListener('click', selectAllVisible);
  clearSelectionButton.addEventListener('click', () => {
    clearSelection();
    updateSelectionUI();
  });
  bulkFocusButton.addEventListener('click', bulkFocus);
  bulkCloseButton.addEventListener('click', bulkClose);
  bulkPinButton.addEventListener('click', bulkPinToggle);
  bulkNewWindowButton.addEventListener('click', bulkMoveToNewWindow);
  bulkGroupButton.addEventListener('click', bulkCreateGroup);
  exportButton.addEventListener('click', exportToJson);
  copyButton.addEventListener('click', copyListToClipboard);
  saveSnapshotButton.addEventListener('click', saveSnapshot);
  clearSnapshotsButton.addEventListener('click', clearSnapshots);
  preferencesForm.addEventListener('submit', savePreferences);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  tagDialog.addEventListener('close', () => {
    state.currentTagContext = null;
    tagDialogInput.value = '';
  });
  tagDialogSaveButton.addEventListener('click', (event) => {
    event.preventDefault();
    saveTagsFromDialog();
  });
}

async function init() {
  await loadPreferences();
  await Promise.all([loadTags(), loadSnapshots()]);
  setupEventListeners();
  await refreshTabs();
}

init().catch((error) => {
  console.error('初始化失敗', error);
  showToast('初始化時發生錯誤');
});
