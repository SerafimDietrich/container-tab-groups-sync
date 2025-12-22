/// <reference types="webextension-polyfill" />

// storage
const LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID: string = "tabGroupIdToCookieStoreId";
let tabGroupIdToCookieStoreId: Map<number, string> = new Map();

// locks
type Lock_ = { promise: Promise<void>; resolve: () => void };
const GROUP_LOCKS: Map<number, Lock_> = new Map();
const GROUP_TIMEOUT_MS: number = 10000;
const TAB_LOCKS: Map<number, Lock_> = new Map();
const TAB_TIMEOUT_MS: number = 1000;

// reconcile queue
const RECONCILE_QUEUE: Set<number> = new Set();
const RECONCILE_TIMEOUT_DURATION: number = 500;
const RECONCILE_MAX_CONCURRENT: number = 20;
let reconcileTimeout: number = 0;

// Firefox defaults
const FIREFOX_DEFAULT_COOKIE_STORE_ID: string = "firefox-default";

// default contextual identities
const DEFAULT_NAME: string = browser.i18n.getMessage("unnamedGroup") || "Unnamed Group";
const DEFAULT_COLOR: string = "blue";
const DEFAULT_ICON: string = "circle";

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
async function withGroupLock<T>(groupId: number, fn: () => Promise<T>): Promise<T> {
  let existing: Lock_ | undefined = GROUP_LOCKS.get(groupId);

  while (existing) {
    await existing.promise;
    existing = GROUP_LOCKS.get(groupId);
  }

  let resolve: () => void = () => {};

  GROUP_LOCKS.set(groupId, { promise: new Promise<void>(r => (resolve = r)), resolve: resolve });

  try {
    return await promiseWithTimeout(fn(), GROUP_TIMEOUT_MS, `timed out (${GROUP_TIMEOUT_MS})`);
  } finally {
    try {
      resolve();
    } catch {}

    GROUP_LOCKS.delete(groupId);
  }
}

async function withTabLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  let existing: Lock_ | undefined = TAB_LOCKS.get(tabId);

  while (existing) {
    await existing.promise;
    existing = TAB_LOCKS.get(tabId);
  }

  let resolve: () => void = () => {};

  TAB_LOCKS.set(tabId, { promise: new Promise<void>(r => (resolve = r)), resolve: resolve });

  try {
    return await promiseWithTimeout(fn(), TAB_TIMEOUT_MS, `timed out (${TAB_TIMEOUT_MS})`);
  } finally {
    try {
      resolve();
    } catch {}

    TAB_LOCKS.delete(tabId);
  }
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled: boolean = false;

    const clearAll: () => void = () => {
      settled = true;
    };

    const timeout: number = setTimeout(() => {
      if (settled) {
        return;
      }

      clearAll();

      try {
        reject(new Error(errorMsg));
      } finally {
        promise.catch(() => {});
      }
    }, timeoutMs);

    const onAbort: () => void = () => {
      if (settled) {
        return;
      }

      clearAll();
      clearTimeout(timeout);

      try {
        reject(new Error("aborted"));
      } finally {
        promise.catch(() => {});
      }
    };

    if (signal) {
      if (signal.aborted) {
        return onAbort();
      }

      signal.addEventListener("abort", onAbort);
    }

    promise
      .then(result => {
        if (settled) {
          return;
        }

        clearAll();
        clearTimeout(timeout);

        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }

        resolve(result);
      })
      .catch(err => {
        if (settled) {
          return;
        }

        clearAll();
        clearTimeout(timeout);

        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }

        reject(err);
      });
  });
}
// #endregion

// #region storage
async function loadTabGroupIdToCookieStoreId(): Promise<void> {
  if (tabGroupIdToCookieStoreId.size !== 0) {
    return;
  }

  try {
    const raw: Record<string, unknown> =
      (await browser.storage.local.get(LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID))[
        LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID
      ] || {};

    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      tabGroupIdToCookieStoreId = new Map(
        Object.entries(raw).map(([k, v]: [string, unknown]) => [Number(k), v as string]),
      ).set(browser.tabGroups.TAB_GROUP_ID_NONE, FIREFOX_DEFAULT_COOKIE_STORE_ID);
    } else {
      log(
        LogLevel.ERROR,
        "Invalid data in local storage for",
        LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
        ", resetting to default",
      );

      tabGroupIdToCookieStoreId = new Map([[browser.tabGroups.TAB_GROUP_ID_NONE, FIREFOX_DEFAULT_COOKIE_STORE_ID]]);
    }
  } catch (error) {
    log(LogLevel.ERROR, "Failed to load", LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID, "from local storage:", error);

    tabGroupIdToCookieStoreId = new Map([[browser.tabGroups.TAB_GROUP_ID_NONE, FIREFOX_DEFAULT_COOKIE_STORE_ID]]);
  }
}

async function saveTabGroupIdToCookieStoreId(): Promise<void> {
  if (tabGroupIdToCookieStoreId.size === 0) {
    return;
  }

  try {
    await browser.storage.local.set({
      [LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID]: Object.fromEntries(
        Array.from(tabGroupIdToCookieStoreId.entries()).map(([k, v]: [number, string]) => [String(k), v]),
      ),
    });
  } catch (error) {
    log(LogLevel.ERROR, "Failed to save", LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID, "to local storage:", error);
  }
}
// #endregion

// #region 1 event listeners
browser.runtime.onInstalled.addListener(async details => {
  try {
    log(LogLevel.INFO, "Extension installed/updated", details);

    await onStartup();
  } catch (error) {
    log(LogLevel.ERROR, "Error in onInstalled/onStartup", error);
  }
});

browser.runtime.onStartup.addListener(async () => {
  try {
    log(LogLevel.INFO, "Extension started");

    await onStartup();
  } catch (error) {
    log(LogLevel.ERROR, "Error in onStartup/onStartup", error);
  }
});

browser.tabGroups.onCreated.addListener(async tabGroup => {
  try {
    log(LogLevel.INFO, "Tab group created", tabGroup);

    await createContextualIdentityForTabGroup(tabGroup.id, tabGroup.title, tabGroup.color);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onCreated/createContextualIdentity", error);
  }
});

browser.tabGroups.onUpdated.addListener(async tabGroup => {
  try {
    log(LogLevel.INFO, "Tab group updated", tabGroup);

    await loadTabGroupIdToCookieStoreId();
    const cookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroup.id);

    if (!cookieStoreId) {
      return;
    }

    try {
      log(LogLevel.INFO, "Cookie-Store-ID obtained", tabGroup);

      await updateContextualIdentity(cookieStoreId, tabGroup.title, tabGroup.color);
    } catch (error) {
      log(LogLevel.ERROR, "Error in onUpdated/updateContextualIdentity", error);
    }
  } catch (error) {
    log(LogLevel.ERROR, "Error in onUpdated handler", error);
  }
});

browser.contextualIdentities.onRemoved.addListener(async onRemovedChangeInfo => {
  try {
    log(LogLevel.INFO, "Contextual identity removed", onRemovedChangeInfo);

    await removeAssociationsForCookieStoreId(onRemovedChangeInfo.contextualIdentity.cookieStoreId);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onRemoved/removeAssociationsForCookieStoreId", error);
  }
});

browser.tabs.onAttached.addListener((tabId, changeInfo) => {
  try {
    log(LogLevel.INFO, "Tab attached", tabId, changeInfo);

    scheduleReconcileTab(tabId);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onAttached/scheduleReconcileTab", error);
  }
});

browser.tabs.onCreated.addListener(tab => {
  if (!tab.id) {
    return;
  }

  try {
    log(LogLevel.INFO, "Tab created", tab);

    scheduleReconcileTab(tab.id);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onCreated/scheduleReconcileTab", error);
  }
});

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo) => {
    if (changeInfo.status === "loading" || changeInfo.discarded === true) {
      return;
    }

    try {
      log(LogLevel.INFO, "Tab updated", tabId, changeInfo);

      scheduleReconcileTab(tabId);
    } catch (error) {
      log(LogLevel.ERROR, "Error in onUpdated/scheduleReconcileTab", error);
    }
  },
  { properties: ["discarded", "groupId", "status"] },
);
// #endregion

// #region 2.1 wrapper
async function onStartup(): Promise<void> {
  await loadTabGroupIdToCookieStoreId();
  const tabGroupIdToCookieStoreIdWithOutDefault: Map<number, string> = new Map(tabGroupIdToCookieStoreId);
  tabGroupIdToCookieStoreIdWithOutDefault.delete(browser.tabGroups.TAB_GROUP_ID_NONE);

  const tabs: browser.tabs.Tab[] = await browser.tabs.query({});
  const tabGroups: browser.tabGroups.TabGroup[] = await browser.tabGroups.query({});

  for (const groupId of tabGroupIdToCookieStoreIdWithOutDefault.keys()) {
    if (!tabGroups.find(tabGroup => tabGroup.id === groupId) && !tabs.find(tab => tab.groupId === groupId)) {
      await removeContextualIdentityForTabGroup(groupId);
    }
  }

  for (const tabGroup of tabGroups) {
    if (!tabGroupIdToCookieStoreIdWithOutDefault.get(tabGroup.id)) {
      await createContextualIdentityForTabGroup(tabGroup.id, tabGroup.title, tabGroup.color);
    }
  }

  tabs.forEach(tab => {
    if (typeof tab.id === "number" && !tab.discarded && tab.status === "complete") {
      scheduleReconcileTab(tab.id);
    }
  });
}

function scheduleReconcileTab(tabId: number): void {
  log(LogLevel.INFO, "Scheduling reconcile for tab:", tabId);

  RECONCILE_QUEUE.add(tabId);

  if (reconcileTimeout === 0) {
    reconcileTimeout = setTimeout(async () => {
      const tabIdsToProcess: number[] = Array.from(RECONCILE_QUEUE).slice(0, RECONCILE_MAX_CONCURRENT);
      const tabIdsToRequeue: number[] = Array.from(RECONCILE_QUEUE).slice(RECONCILE_MAX_CONCURRENT);

      RECONCILE_QUEUE.clear();
      tabIdsToRequeue.forEach(id => RECONCILE_QUEUE.add(id));
      (await batchReconcileTabs(tabIdsToProcess, tabIdsToRequeue.length === 0)).forEach(id => RECONCILE_QUEUE.add(id));

      reconcileTimeout = 0;
    }, RECONCILE_TIMEOUT_DURATION);
  }
}
// #endregion

// #region 2.2 tasks (also group locks)
async function createContextualIdentityForTabGroup(
  tabGroupId: number,
  tabGroupTitle: string | undefined,
  tabGroupColor: browser.tabGroups.Color,
): Promise<void> {
  await withGroupLock(tabGroupId, async () => {
    await loadTabGroupIdToCookieStoreId();

    if (tabGroupIdToCookieStoreId.get(tabGroupId)) {
      return;
    }

    log(LogLevel.INFO, "Creating contextual identity for tab group:", tabGroupId);

    const contextualIdentity: browser.contextualIdentities.ContextualIdentity =
      await browser.contextualIdentities.create({
        name: DEFAULT_NAME,
        color: DEFAULT_COLOR,
        icon: DEFAULT_ICON,
      });

    await updateContextualIdentity(contextualIdentity.cookieStoreId, tabGroupTitle, tabGroupColor);
    tabGroupIdToCookieStoreId.set(tabGroupId, contextualIdentity.cookieStoreId);
    await saveTabGroupIdToCookieStoreId();
  });
}

async function removeContextualIdentityForTabGroup(tabGroupId: number): Promise<void> {
  await withGroupLock(tabGroupId, async () => {
    await loadTabGroupIdToCookieStoreId();
    const cookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroupId);

    if (!cookieStoreId) {
      return;
    }

    log(LogLevel.INFO, "Removing contextual identity for tab group:", tabGroupId);

    try {
      await browser.contextualIdentities.remove(cookieStoreId);
    } catch (error) {
      log(LogLevel.ERROR, "Failed to remove contextual identity:", cookieStoreId, error);
    }

    tabGroupIdToCookieStoreId.delete(tabGroupId);
    await saveTabGroupIdToCookieStoreId();
  });
}

async function removeContextualIdentity(cookieStoreId: string): Promise<void> {
  log(LogLevel.INFO, "Removing contextual identity:", cookieStoreId);

  try {
    await browser.contextualIdentities.remove(cookieStoreId);
  } catch (error) {
    log(LogLevel.ERROR, "Failed to remove contextual identity:", cookieStoreId, error);
  }
}

async function removeAssociationsForCookieStoreId(cookieStoreIdOld: string): Promise<void> {
  await loadTabGroupIdToCookieStoreId();

  const tabGroupsToDelete: Set<number> = new Set();

  for (const [tabGroupId, cookieStoreId] of tabGroupIdToCookieStoreId.entries()) {
    if (cookieStoreId === cookieStoreIdOld) {
      tabGroupsToDelete.add(tabGroupId);
    }
  }

  tabGroupsToDelete.forEach(tabGroupId => tabGroupIdToCookieStoreId.delete(tabGroupId));

  await saveTabGroupIdToCookieStoreId();
}

async function batchReconcileTabs(tabIdsToProcess: number[], cleanupContextualIdentities: boolean): Promise<number[]> {
  log(LogLevel.INFO, "Batch reconciling tabs:", tabIdsToProcess);

  await loadTabGroupIdToCookieStoreId();

  let tabIdsNotProcessed: number[] = [];
  let abandonedContextualIdentities: Set<string> = new Set();

  await Promise.allSettled(
    tabIdsToProcess.map(async tabId => {
      try {
        const tab: browser.tabs.Tab = await browser.tabs.get(tabId);

        if (!tab.groupId) {
          return;
        }

        const expectedCookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tab.groupId);

        if (!expectedCookieStoreId) {
          return;
        }

        await withGroupLock(tab.groupId, async () => {
          const previousCookieStoreId: string | undefined = tab.cookieStoreId;

          if (await moveTabToContextualIdentity(tab, expectedCookieStoreId)) {
            if (
              cleanupContextualIdentities &&
              previousCookieStoreId &&
              previousCookieStoreId !== FIREFOX_DEFAULT_COOKIE_STORE_ID
            ) {
              abandonedContextualIdentities.add(previousCookieStoreId);
            }
          } else {
            tabIdsNotProcessed.push(tabId);
          }
        });
      } catch (error) {
        log(LogLevel.ERROR, "Failed to reconcile tab:", tabId, error);
      }
    }),
  );

  if (cleanupContextualIdentities) {
    await Promise.allSettled(
      Array.from(abandonedContextualIdentities).map(async cookieStoreIdOld => {
        if ((await browser.tabs.query({ cookieStoreId: cookieStoreIdOld })).length === 0) {
          await removeContextualIdentity(cookieStoreIdOld);
          await removeAssociationsForCookieStoreId(cookieStoreIdOld);
        }
      }),
    );
  }

  return tabIdsNotProcessed;
}
// #endregion

// #region 3 helper
async function moveTabToContextualIdentity(tab: browser.tabs.Tab, cookieStoreId: string): Promise<boolean> {
  let processed: boolean = true;

  if (!tab.id) {
    log(LogLevel.WARN, "Tab has no ID, cannot move to contextual identity:", tab.id);

    return false;
  }

  await withTabLock(tab.id, async () => {
    if (!tab.id || tab.cookieStoreId === cookieStoreId) {
      return;
    }

    try {
      await browser.tabs.get(tab.id);
    } catch (error) {
      log(LogLevel.WARN, "Tab no longer exists, cannot move:", tab.id, error);

      return;
    }

    if (tab.discarded || tab.status !== "complete") {
      log(LogLevel.INFO, "Tab is not ready:", tab.id);

      processed = false;
      return;
    }

    log(LogLevel.INFO, "Moving tab to contextual identity:", tab.id, cookieStoreId);

    await browser.tabs.create({
      windowId: tab.windowId,
      index: tab.index,
      url: tab.url,
      active: tab.active,
      pinned: tab.pinned,
      openerTabId: tab.id,
      cookieStoreId: cookieStoreId,
      openInReaderMode: tab.isInReaderMode,
      muted: tab.mutedInfo?.muted,
    });

    try {
      await browser.tabs.remove(tab.id);
    } catch (error) {
      log(LogLevel.ERROR, "Failed to remove old tab after moving:", tab.id, error);
    }
  });

  return processed;
}
// #endregion

// #region util
async function updateContextualIdentity(
  cookieStoreId: string,
  tabGroupTitle: string | undefined,
  tabGroupColor: browser.tabGroups.Color,
): Promise<void> {
  try {
    await browser.contextualIdentities.update(cookieStoreId, {
      name: tabGroupTitle,
    });
  } catch {}

  try {
    await browser.contextualIdentities.update(cookieStoreId, {
      color: tabGroupColor,
    });
  } catch {}
}
// #endregion
