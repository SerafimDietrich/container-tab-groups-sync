/// <reference types="webextension-polyfill" />

// #region logger
enum LogLevel {
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

function log(level: LogLevel, ...args: unknown[]): void {
  switch (level) {
    case LogLevel.INFO:
      // eslint-disable-next-line no-console
      console.info(...args);
      break;
    case LogLevel.WARN:
      // eslint-disable-next-line no-console
      console.warn(...args);
      break;
    case LogLevel.ERROR:
      // eslint-disable-next-line no-console
      console.error(...args);
      break;
    default:
      // eslint-disable-next-line no-console
      console.log(...args);
  }
}
// #endregion

// #region lock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GROUP_LOCKS: Map<number, Promise<any>> = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TAB_LOCKS: Map<number, Promise<any>> = new Map();
const DEFAULT_TIMEOUT_MS: number = 60000;

async function withGroupLock<T>(groupId: number, fn: () => Promise<T>): Promise<T> {
  while (GROUP_LOCKS.get(groupId)) {
    await GROUP_LOCKS.get(groupId);
  }

  let resolve: () => void = () => {};
  GROUP_LOCKS.set(groupId, new Promise<void>(r => (resolve = r)));

  try {
    return await promiseWithTimeout(fn(), `withGroupLock for groupId ${groupId} timed out`);
  } finally {
    GROUP_LOCKS.delete(groupId);

    resolve();
  }
}

async function withTabLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  while (TAB_LOCKS.get(tabId)) {
    await TAB_LOCKS.get(tabId);
  }

  let resolve: () => void = () => {};
  TAB_LOCKS.set(tabId, new Promise<void>(r => (resolve = r)));

  try {
    return await promiseWithTimeout(fn(), `withTabLock for tabId ${tabId} timed out`);
  } finally {
    TAB_LOCKS.delete(tabId);

    resolve();
  }
}

function promiseWithTimeout<T>(promise: Promise<T>, errorMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout: number = setTimeout(() => {
      reject(new Error(errorMsg));
    }, DEFAULT_TIMEOUT_MS);

    promise
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}
// #endregion

// #region reconcile tabs
const FIREFOX_DEFAULT_GROUP_ID: number = -1;
const RECONCILE_TIMEOUT_DURATION: number = 250;
const RECONCILE_QUEUE: Set<number> = new Set();

let reconcileTimeout: number = 0;

function scheduleReconcileTab(tabId: number): void {
  log(LogLevel.INFO, "Scheduling reconcile for tab:", tabId);

  RECONCILE_QUEUE.add(tabId);

  if (reconcileTimeout === 0) {
    reconcileTimeout = setTimeout(async () => {
      const tabIds: number[] = Array.from(RECONCILE_QUEUE);

      RECONCILE_QUEUE.clear();
      reconcileTimeout = 0;

      await batchReconcileTabs(tabIds);
    }, RECONCILE_TIMEOUT_DURATION);
  }
}

async function batchReconcileTabs(tabIds: number[]): Promise<void> {
  log(LogLevel.INFO, "Batch reconciling tabs:", tabIds);

  const tabGroupIdToCookieStoreId: Map<number, string> = await loadTabGroupIdToCookieStoreId();
  const tabs: browser.tabs.Tab[] = await browser.tabs.query({});
  const tabIdToTab: Map<number, browser.tabs.Tab> = new Map(
    tabs
      .filter(tab => tab.id !== undefined)
      .map(tab => [tab.id, tab] as [number, browser.tabs.Tab]),
  );

  await Promise.allSettled(
    tabIds.map(async tabId => {
      const tab: browser.tabs.Tab | undefined = tabIdToTab.get(tabId);

      if (tab) {
        const expectedCookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(
          // @ts-ignore: groupId is supported in Firefox 139+, but not in type definitions yet
          tab.groupId,
        );

        if (expectedCookieStoreId && tab.cookieStoreId !== expectedCookieStoreId) {
          // @ts-ignore: groupId is supported in Firefox 139+, but not in type definitions yet
          await withGroupLock(tab.groupId, async () => {
            await moveTabToContextualIdentity(tab, expectedCookieStoreId);
          });
        }
      } else {
        log(LogLevel.INFO, "Tab with ID", tabId, "doesn't exist (anymore).");
      }
    }),
  );
}
// #endregion

// #region storage
const LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID: string = "tabGroupIdToCookieStoreId";

async function loadTabGroupIdToCookieStoreId(): Promise<Map<number, string>> {
  try {
    return new Map(
      Object.entries(
        (await browser.storage.local.get(LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID))[
          LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID
        ] || {},
      ).map(([k, v]: [string, unknown]) => [Number(k), v as string]),
    ).set(FIREFOX_DEFAULT_GROUP_ID, FIREFOX_DEFAULT_COOKIE_STORE_ID);
  } catch (error) {
    log(
      LogLevel.ERROR,
      "Failed to load ",
      LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
      ":",
      error,
    );

    return new Map([[FIREFOX_DEFAULT_GROUP_ID, FIREFOX_DEFAULT_COOKIE_STORE_ID]]);
  }
}

async function saveTabGroupIdToCookieStoreId(map: Map<number, string>): Promise<void> {
  try {
    await browser.storage.local.set({
      [LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID]: Object.fromEntries(
        Array.from(map.entries()).map(([k, v]: [number, string]) => [String(k), v]),
      ),
    });
  } catch (error) {
    log(
      LogLevel.ERROR,
      "Failed to save ",
      LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
      ":",
      error,
    );
  }
}

async function getCookieStoreId(tabGroupId: number): Promise<string | undefined> {
  return (await loadTabGroupIdToCookieStoreId()).get(tabGroupId);
}

async function setCookieStoreId(
  tabGroupId: number,
  cookieStoreId: string,
): Promise<string | undefined> {
  log(LogLevel.INFO, "Setting cookieStoreId for tabGroupId:", tabGroupId, cookieStoreId);

  const tabGroupIdToCookieStoreId: Map<number, string> = await loadTabGroupIdToCookieStoreId();
  const oldCookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroupId);

  tabGroupIdToCookieStoreId.set(tabGroupId, cookieStoreId);

  await saveTabGroupIdToCookieStoreId(tabGroupIdToCookieStoreId);
  return oldCookieStoreId;
}

async function removeCookieStoreId(tabGroupId: number): Promise<string | undefined> {
  log(LogLevel.INFO, "Removing cookieStoreId for tabGroupId:", tabGroupId);

  const tabGroupIdToCookieStoreId: Map<number, string> = await loadTabGroupIdToCookieStoreId();
  const oldCookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroupId);

  tabGroupIdToCookieStoreId.delete(tabGroupId);

  await saveTabGroupIdToCookieStoreId(tabGroupIdToCookieStoreId);
  return oldCookieStoreId;
}
// #endregion

// #region contextual identities
const FIREFOX_DEFAULT_COOKIE_STORE_ID: string = "firefox-default";
const DEFAULT_NAME: string = browser.i18n.getMessage("unnamedGroup") || "Unnamed Group";
const DEFAULT_COLOR: string = "blue";
const DEFAULT_ICON: string = "circle";

async function createContextualIdentity(
  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  tabGroup: browser.tabGroups.TabGroup,
): Promise<void> {
  await withGroupLock(tabGroup.id, async () => {
    log(LogLevel.INFO, "Creating contextual identity for tab group:", tabGroup);

    const contextualIdentity: browser.contextualIdentities.ContextualIdentity =
      await browser.contextualIdentities.create({
        name: DEFAULT_NAME,
        color: DEFAULT_COLOR,
        icon: DEFAULT_ICON,
      });

    try {
      await browser.contextualIdentities.update(contextualIdentity.cookieStoreId, {
        name: tabGroup.title,
      });
    } catch {}

    try {
      await browser.contextualIdentities.update(contextualIdentity.cookieStoreId, {
        color: tabGroup.color,
      });
    } catch {}

    await setCookieStoreId(tabGroup.id, contextualIdentity.cookieStoreId);
  });
}

async function removeContextualIdentity(
  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  tabGroup: browser.tabGroups.TabGroup,
): Promise<void> {
  await withGroupLock(tabGroup.id, async () => {
    log(LogLevel.INFO, "Removing contextual identity for tab group:", tabGroup);

    const cookieStoreId: string | undefined = await removeCookieStoreId(tabGroup.id);

    if (cookieStoreId) {
      (
        await browser.tabs.query({
          cookieStoreId: cookieStoreId,
        })
      ).forEach(async tab => {
        await moveTabToContextualIdentity(tab, FIREFOX_DEFAULT_COOKIE_STORE_ID);
      });

      await browser.contextualIdentities.remove(cookieStoreId);
    }
  });
}

async function moveTabToContextualIdentity(
  tab: browser.tabs.Tab,
  cookieStoreId: string,
): Promise<void> {
  if (tab.id) {
    await withTabLock(tab.id, async () => {
      if (tab.id && tab.cookieStoreId !== cookieStoreId) {
        log(LogLevel.INFO, "Moving tab to contextual identity:", tab.id, cookieStoreId);

        if (tab.discarded) {
          log(LogLevel.INFO, "Tab is discarded, activating:", tab);

          await browser.tabs.update(tab.id, { active: true });
        }

        if (tab.status !== "complete") {
          if (tab.status !== "loading") {
            log(LogLevel.INFO, "Tab is not complete, reloading:", tab);

            await browser.tabs.reload(tab.id);
          } else {
            log(LogLevel.INFO, "Tab is loading, waiting:", tab);

            await waitForTabComplete(tab.id);
          }
        }

        await browser.tabs.create({
          windowId: tab.windowId,
          index: tab.index,
          url: tab.url,
          active: false,
          pinned: tab.pinned,
          openerTabId: tab.id,
          cookieStoreId: cookieStoreId,
          openInReaderMode: tab.isInReaderMode,
          muted: tab.mutedInfo?.muted,
        });

        await browser.tabs.remove(tab.id);
      }
    });
  } else {
    log(LogLevel.WARN, "Tab has no ID, cannot move to contextual identity:", tab);
  }
}
// #endregion

// #region event listeners
// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.runtime.onInstalled.addListener(details => {
  log(LogLevel.INFO, "Extension installed/updated:", details);

  onStartup();
});

browser.runtime.onStartup.addListener(() => {
  log(LogLevel.INFO, "Extension started");

  onStartup();
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onCreated.addListener(async tabGroup => {
  log(LogLevel.INFO, "Tab group created:", tabGroup);

  await createContextualIdentity(tabGroup);
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onUpdated.addListener(async tabGroup => {
  log(LogLevel.INFO, "Tab group updated:", tabGroup);

  const cookieStoreId: string | undefined = await getCookieStoreId(tabGroup.id);

  if (cookieStoreId) {
    try {
      await browser.contextualIdentities.update(cookieStoreId, {
        name: tabGroup.title,
      });
    } catch {}

    try {
      await browser.contextualIdentities.update(cookieStoreId, {
        color: tabGroup.color,
      });
    } catch {}
  }
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onRemoved.addListener(async tabGroup => {
  log(LogLevel.INFO, "Tab group removed:", tabGroup);

  await removeContextualIdentity(tabGroup);
});

browser.contextualIdentities.onRemoved.addListener(async onRemovedChangeInfo => {
  log(LogLevel.INFO, "Contextual identity removed:", onRemovedChangeInfo);

  const tabGroupIdToCookieStoreId: Map<number, string> = await loadTabGroupIdToCookieStoreId();

  for (const [tabGroupId, cookieStoreId] of tabGroupIdToCookieStoreId.entries()) {
    if (cookieStoreId === onRemovedChangeInfo.contextualIdentity.cookieStoreId) {
      tabGroupIdToCookieStoreId.delete(tabGroupId);
    }
  }

  await saveTabGroupIdToCookieStoreId(tabGroupIdToCookieStoreId);
});

browser.tabs.onAttached.addListener(scheduleReconcileTab);

browser.tabs.onCreated.addListener(tab => {
  if (tab.id) {
    log(LogLevel.INFO, "Tab created:", tab);

    scheduleReconcileTab(tab.id);
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  log(LogLevel.INFO, "Tab updated:", tabId, changeInfo);

  scheduleReconcileTab(tabId);
});
// #endregion

// #region startup
async function onStartup(): Promise<void> {
  const tabGroupIdToCookieStoreId: Map<number, string> = await loadTabGroupIdToCookieStoreId();
  tabGroupIdToCookieStoreId.delete(FIREFOX_DEFAULT_GROUP_ID);
  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  const tabGroups: browser.tabGroups.TabGroup[] = await browser.tabGroups.query({});
  const tabGroupIds: Set<number> = new Set(tabGroups.map(tabGroup => tabGroup.id));

  for (const groupId of tabGroupIdToCookieStoreId.keys()) {
    if (!tabGroupIds.has(groupId)) {
      // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
      await removeContextualIdentity(await browser.tabGroups.get(groupId));
    }
  }

  for (const tabGroup of tabGroups) {
    const cookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroup.id);

    if (!cookieStoreId) {
      await createContextualIdentity(tabGroup);
    }
  }

  batchReconcileTabs(
    (await browser.tabs.query({}))
      .map(tab => tab.id)
      .filter((id): id is number => id !== undefined),
  );
}
// #endregion

// #region util
async function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise(resolve =>
    browser.tabs.onUpdated.addListener(async function listener(
      updatedTabId: number,
      _: browser.tabs._OnUpdatedChangeInfo,
      tab: browser.tabs.Tab,
    ): Promise<void> {
      if (updatedTabId === tabId) {
        if (tab.discarded) {
          log(LogLevel.INFO, "Tab is discarded, activating:", tab);

          await browser.tabs.update(tabId, { active: true });
        }

        if (tab.status === "complete") {
          log(LogLevel.INFO, "Tab is complete, resolving:", tab);

          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        } else if (tab.status !== "loading") {
          log(LogLevel.INFO, "Tab is not loading, reloading:", tab);

          await browser.tabs.reload(tabId);
          resolve();
        }
      }
    }),
  );
}
// #endregion
