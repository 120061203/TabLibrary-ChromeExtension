const cardsContainer = document.getElementById('cards-container');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const refreshButton = document.getElementById('refresh-button');
const groupingSelect = document.getElementById('grouping-select');
const sortSelect = document.getElementById('sort-select');
const exportButton = document.getElementById('export-button');
const toast = document.getElementById('toast');

const tabGroupTemplate = document.getElementById('tab-group-template');
const tabCardTemplate = document.getElementById('tab-card-template');

const EMPTY_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAK0lEQVQoU2N89uzZfzYwYGA4EKrAxIScAHEAYkawApKNgQlYNA0bBwDq5Q98o+SXfgAAAABJRU5ErkJggg==';

const state = {
  cachedTabs: [],
  filteredTabs: [],
  grouping: groupingSelect.value,
  sorting: sortSelect.value,
  windowInfo: new Map()
};

function showToast(message, timeout = 2500) {
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
  if (Math.abs(diff) < 60 * 1000) {
    return rtf.format(Math.round(-diff / 1000), 'second');
  }
  if (Math.abs(diff) < 60 * 60 * 1000) {
    return rtf.format(Math.round(-diff / (60 * 1000)), 'minute');
  }
  if (Math.abs(diff) < 24 * 60 * 60 * 1000) {
    return rtf.format(Math.round(-diff / (60 * 60 * 1000)), 'hour');
  }
  return rtf.format(Math.round(-diff / (24 * 60 * 60 * 1000)), 'day');
}

async function queryAllTabs() {
  try {
    return await chrome.tabs.query({});
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

function getDomainLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || '其他';
  } catch (error) {
    return '其他';
  }
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
      const title = windowData?.title ? windowData.title : `視窗 ${tab.windowId}`;
      const displayTitle = windowData?.focused ? `${title}（目前視窗）` : title;
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
    return title.includes(keyword) || url.includes(keyword);
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

    group.tabs.forEach((tab) => {
      const card = createTabCard(tab);
      container.appendChild(card);
    });

    fragment.appendChild(groupElement);
  });

  cardsContainer.appendChild(fragment);
}

function createTabCard(tab) {
  const clone = tabCardTemplate.content.firstElementChild.cloneNode(true);
  const titleElement = clone.querySelector('.tab-title');
  const urlElement = clone.querySelector('.tab-url');
  const metaElement = clone.querySelector('.tab-meta');
  const faviconImg = clone.querySelector('.favicon');
  const focusButton = clone.querySelector('.focus-button');
  const closeButton = clone.querySelector('.close-button');

  const titleText = tab.title?.trim() || '未命名分頁';
  titleElement.textContent = titleText;
  urlElement.textContent = tab.url || '';

  faviconImg.src = tab.favIconUrl || EMPTY_FAVICON;
  faviconImg.alt = `${titleText} 的網站圖示`;

  const details = [];
  if (tab.pinned) {
    details.push('釘選');
  }
  if (tab.audible && !tab.mutedInfo?.muted) {
    details.push('有音訊');
  }
  details.push(`視窗：${tab.windowId}`);
  details.push(`最後瀏覽：${formatRelativeTime(tab.lastAccessed)}`);
  metaElement.textContent = details.join(' · ');

  focusButton.addEventListener('click', () => focusTab(tab));
  closeButton.addEventListener('click', () => closeTab(tab));

  return clone;
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

async function closeTab(tab) {
  try {
    await chrome.tabs.remove(tab.id);
    showToast('已關閉分頁');
    await refreshTabs();
  } catch (error) {
    console.error('關閉分頁時發生錯誤', error);
    showToast('無法關閉分頁');
  }
}

function applyFilterAndRender() {
  const sorted = sortTabs(state.cachedTabs);
  const filtered = filterTabs(sorted);
  state.filteredTabs = filtered;
  const groups = buildGroups(filtered);
  renderTabs(groups);
}

async function refreshTabs() {
  state.cachedTabs = await queryAllTabs();
  await hydrateWindowInfo(state.cachedTabs);
  applyFilterAndRender();
}

async function exportToJson() {
  if (!state.filteredTabs.length) {
    showToast('目前沒有可匯出的分頁');
    return;
  }

  const data = {
    exportedAt: new Date().toISOString(),
    tabs: state.filteredTabs.map((tab) => ({
      title: tab.title,
      url: tab.url,
      pinned: tab.pinned,
      audible: tab.audible,
      windowId: tab.windowId,
      lastAccessed: tab.lastAccessed
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tablibrary-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('已匯出 JSON');
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
  exportButton.addEventListener('click', exportToJson);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshTabs();
    }
  });
}

async function init() {
  setupEventListeners();
  await refreshTabs();
}

init().catch((error) => {
  console.error('初始化失敗', error);
  showToast('初始化時發生錯誤');
});
