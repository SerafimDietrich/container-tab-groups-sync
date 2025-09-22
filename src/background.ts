/// <reference types="webextension-polyfill" />

// storage
const LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID: string = "tabGroupIdToCookieStoreId";
let tabGroupIdToCookieStoreId: Map<number, string> = new Map();

// locks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GROUP_LOCKS: Map<number, Promise<any>> = new Map();
const GROUP_TIMEOUT_MS: number = 60000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TAB_LOCKS: Map<number, Promise<any>> = new Map();
const TAB_TIMEOUT_MS: number = 10000;

// reconcile queue
const RECONCILE_TIMEOUT_DURATION: number = 250;
const RECONCILE_QUEUE: Set<number> = new Set();
const RECONCILE_MAX_CONCURRENT: number = 20;
let reconcileTimeout: number = 0;

// Firefox defaults
const FIREFOX_DEFAULT_GROUP_ID: number = -1;
const FIREFOX_DEFAULT_COOKIE_STORE_ID: string = "firefox-default";

// default contextual identities
const DEFAULT_NAME: string = browser.i18n.getMessage("unnamedGroup") || "Unnamed Group";
const DEFAULT_COLOR: string = "blue";
const DEFAULT_ICON: string = "circle";

self.addEventListener("unhandledrejection", event => {
  log(LogLevel.ERROR, "Unhandled Promise Rejection:", event);
});

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
  while (GROUP_LOCKS.get(groupId)) {
    await GROUP_LOCKS.get(groupId);
  }

  let resolve: () => void = () => {};
  GROUP_LOCKS.set(groupId, new Promise<void>(r => (resolve = r)));

  try {
    return await promiseWithTimeout(
      fn(),
      GROUP_TIMEOUT_MS,
      `timed out (${GROUP_TIMEOUT_MS})`,
    );
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
    return await promiseWithTimeout(
      fn(),
      TAB_TIMEOUT_MS,
      `timed out (${TAB_TIMEOUT_MS})`,
    );
  } finally {
    TAB_LOCKS.delete(tabId);

    resolve();
  }
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout: number = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);

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

// #region storage
async function loadTabGroupIdToCookieStoreId(): Promise<void> {
  if (tabGroupIdToCookieStoreId.size === 0) {
    try {
      const raw: Record<string, unknown> =
        (await browser.storage.local.get(LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID))[
          LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID
        ] || {};

      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        tabGroupIdToCookieStoreId = new Map(
          Object.entries(raw).map(([k, v]: [string, unknown]) => [Number(k), v as string]),
        ).set(FIREFOX_DEFAULT_GROUP_ID, FIREFOX_DEFAULT_COOKIE_STORE_ID);
      } else {
        log(
          LogLevel.ERROR,
          "Invalid data in local storage for",
          LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
          ", resetting to default",
        );

        tabGroupIdToCookieStoreId = new Map([
          [FIREFOX_DEFAULT_GROUP_ID, FIREFOX_DEFAULT_COOKIE_STORE_ID],
        ]);
      }
    } catch (error) {
      log(
        LogLevel.ERROR,
        "Failed to load",
        LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
        "from local storage:",
        error,
      );

      tabGroupIdToCookieStoreId = new Map([
        [FIREFOX_DEFAULT_GROUP_ID, FIREFOX_DEFAULT_COOKIE_STORE_ID],
      ]);
    }
  }
}

async function saveTabGroupIdToCookieStoreId(): Promise<void> {
  try {
    await browser.storage.local.set({
      [LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID]: Object.fromEntries(
        Array.from(tabGroupIdToCookieStoreId.entries()).map(([k, v]: [number, string]) => [
          String(k),
          v,
        ]),
      ),
    });
  } catch (error) {
    log(
      LogLevel.ERROR,
      "Failed to save",
      LOCAL_STORAGE_TAB_GROUP_ID_TO_COOKIE_STORE_ID,
      "to local storage:",
      error,
    );
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
    log(LogLevel.ERROR, "Error in onStartup event", error);
  }
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onCreated.addListener(async tabGroup => {
  try {
    log(LogLevel.INFO, "Tab group created", tabGroup);
    await createContextualIdentity(tabGroup);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onCreated/createContextualIdentity", tabGroup, error);
  }
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onUpdated.addListener(async tabGroup => {
  try {
    log(LogLevel.INFO, "Tab group updated", tabGroup);
    await loadTabGroupIdToCookieStoreId();
    const cookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroup.id);

    if (cookieStoreId) {
      try {
        await updateContextualIdentity(tabGroup, cookieStoreId);
      } catch (error) {
        log(
          LogLevel.ERROR,
          "Error in onUpdated/updateContextualIdentity",
          tabGroup,
          cookieStoreId,
          error,
        );
      }
    }
  } catch (error) {
    log(LogLevel.ERROR, "Error in onUpdated handler", tabGroup, error);
  }
});

// @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
browser.tabGroups.onRemoved.addListener(async tabGroup => {
  try {
    log(LogLevel.INFO, "Tab group removed", tabGroup);
    await removeContextualIdentity(tabGroup);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onRemoved/removeContextualIdentity", tabGroup, error);
  }
});

browser.contextualIdentities.onRemoved.addListener(async onRemovedChangeInfo => {
  try {
    log(LogLevel.INFO, "Contextual identity removed", onRemovedChangeInfo);
    await removeAssociationsForCookieStoreId(onRemovedChangeInfo.contextualIdentity.cookieStoreId);
  } catch (error) {
    log(
      LogLevel.ERROR,
      "Error in onRemoved/removeAssociationsForCookieStoreId",
      onRemovedChangeInfo,
      error,
    );
  }
});

browser.tabs.onAttached.addListener((tabId, changeInfo) => {
  try {
    log(LogLevel.INFO, "Tab attached", tabId, changeInfo);
    scheduleReconcileTab(tabId);
  } catch (error) {
    log(LogLevel.ERROR, "Error in onAttached/scheduleReconcileTab", tabId, error);
  }
});

browser.tabs.onCreated.addListener(tab => {
  if (tab.id) {
    try {
      log(LogLevel.INFO, "Tab created", tab);
      scheduleReconcileTab(tab.id);
    } catch (error) {
      log(LogLevel.ERROR, "Error in onCreated/scheduleReconcileTab", tab, error);
    }
  }
});

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo) => {
    if (changeInfo.status !== "loading") {
      try {
        log(LogLevel.INFO, "Tab updated", tabId, changeInfo);
        scheduleReconcileTab(tabId);
      } catch (error) {
        log(LogLevel.ERROR, "Error in onUpdated/scheduleReconcileTab", tabId, error);
      }
    }
  },
  // @ts-ignore: groupId is supported in Firefox 138+, but not in type definitions yet
  { properties: ["groupId", "status"] },
);
// #endregion

// #region 2.1 wrapper
async function onStartup(): Promise<void> {
  await loadTabGroupIdToCookieStoreId();
  const tabGroupIdToCookieStoreIdWithOutDefault: Map<number, string> = new Map(
    tabGroupIdToCookieStoreId,
  );
  tabGroupIdToCookieStoreIdWithOutDefault.delete(FIREFOX_DEFAULT_GROUP_ID);

  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  const tabGroups: browser.tabGroups.TabGroup[] = await browser.tabGroups.query({});

  // Remove contextual identities for tab groups that no longer exist
  for (const groupId of tabGroupIdToCookieStoreIdWithOutDefault.keys()) {
    if (!tabGroups.find(tabGroup => tabGroup.id === groupId)) {
      await removeContextualIdentity(groupId);
    }
  }

  // Create contextual identities for tab groups that don't have one yet
  for (const tabGroup of tabGroups) {
    if (!tabGroupIdToCookieStoreIdWithOutDefault.get(tabGroup.id)) {
      await createContextualIdentity(tabGroup);
    }
  }

  // Reconcile all tabs
  (await browser.tabs.query({})).forEach(tab => {
    if (typeof tab.id === "number") {
      scheduleReconcileTab(tab.id);
    }
  });
}

function scheduleReconcileTab(tabId: number): void {
  log(LogLevel.INFO, "Scheduling reconcile for tab:", tabId);

  RECONCILE_QUEUE.add(tabId);

  if (reconcileTimeout === 0) {
    reconcileTimeout = setTimeout(async () => {
      const tabIdsToProcess: number[] = Array.from(RECONCILE_QUEUE).slice(
        0,
        RECONCILE_MAX_CONCURRENT,
      );
      const tabIdsToRequeue: number[] = Array.from(RECONCILE_QUEUE).slice(RECONCILE_MAX_CONCURRENT);

      RECONCILE_QUEUE.clear();
      tabIdsToRequeue.forEach(id => RECONCILE_QUEUE.add(id));
      reconcileTimeout = 0;

      await batchReconcileTabs(tabIdsToProcess);
    }, RECONCILE_TIMEOUT_DURATION);
  }
}
// #endregion

// #region 2.2 tasks (also group locks)
async function createContextualIdentity(
  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  tabGroup: browser.tabGroups.TabGroup,
): Promise<void> {
  await withGroupLock(tabGroup.id, async () => {
    await loadTabGroupIdToCookieStoreId();

    if (!tabGroupIdToCookieStoreId.get(tabGroup.id)) {
      log(LogLevel.INFO, "Creating contextual identity for tab group:", tabGroup.id);

      const contextualIdentity: browser.contextualIdentities.ContextualIdentity =
        await browser.contextualIdentities.create({
          name: DEFAULT_NAME,
          color: DEFAULT_COLOR,
          icon: DEFAULT_ICON,
        });

      await updateContextualIdentity(tabGroup, contextualIdentity.cookieStoreId);
      tabGroupIdToCookieStoreId.set(tabGroup.id, contextualIdentity.cookieStoreId);
      await saveTabGroupIdToCookieStoreId();
    }
  });
}

async function removeContextualIdentity(tabGroupId: number): Promise<void> {
  await withGroupLock(tabGroupId, async () => {
    await loadTabGroupIdToCookieStoreId();
    const cookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(tabGroupId);

    if (cookieStoreId) {
      try {
        log(LogLevel.INFO, "Removing contextual identity for tab group:", tabGroupId);

        (
          await browser.tabs.query({
            cookieStoreId: cookieStoreId,
          })
        ).forEach(async tab => {
          await moveTabToContextualIdentity(tab, FIREFOX_DEFAULT_COOKIE_STORE_ID);
        });

        await browser.contextualIdentities.remove(cookieStoreId);
      } catch (error) {
        log(LogLevel.ERROR, "Failed to remove contextual identity:", cookieStoreId, error);
      }
    }
  });
}

async function removeAssociationsForCookieStoreId(cookieStoreIdOld: string): Promise<void> {
  await loadTabGroupIdToCookieStoreId();

  for (const [tabGroupId, cookieStoreId] of tabGroupIdToCookieStoreId.entries()) {
    if (cookieStoreId === cookieStoreIdOld) {
      tabGroupIdToCookieStoreId.delete(tabGroupId);
    }
  }

  await saveTabGroupIdToCookieStoreId();
}

async function batchReconcileTabs(tabIds: number[]): Promise<void> {
  log(LogLevel.INFO, "Batch reconciling tabs:", tabIds);

  await loadTabGroupIdToCookieStoreId();

  // move tabs to their expected contextual identity
  await Promise.allSettled(
    tabIds.map(async tabId => {
      try {
        const tab: browser.tabs.Tab = await browser.tabs.get(tabId);

        const expectedCookieStoreId: string | undefined = tabGroupIdToCookieStoreId.get(
          // @ts-ignore: groupId is supported in Firefox 138+, but not in type definitions yet
          tab.groupId,
        );

        if (expectedCookieStoreId) {
          // @ts-ignore: groupId is supported in Firefox 138+, but not in type definitions yet
          await withGroupLock(tab.groupId, async () => {
            await moveTabToContextualIdentity(tab, expectedCookieStoreId);
          });
        }
      } catch (error) {
        log(LogLevel.ERROR, "Failed to reconcile tab:", tabId, error);
      }
    }),
  );
}
// #endregion

// #region 3 helper
async function moveTabToContextualIdentity(
  tab: browser.tabs.Tab,
  cookieStoreId: string,
): Promise<void> {
  if (tab.id) {
    await withTabLock(tab.id, async () => {
      if (tab.id && tab.cookieStoreId !== cookieStoreId) {
        try {
          await browser.tabs.get(tab.id);
        } catch (error) {
          log(LogLevel.WARN, "Tab no longer exists, cannot move:", tab.id, error);

          return;
        }

        log(LogLevel.INFO, "Moving tab to contextual identity:", tab.id, cookieStoreId);

        if (tab.discarded) {
          log(LogLevel.INFO, "Tab is discarded, activating:", tab.id);

          await browser.tabs.update(tab.id, { active: true });
        }

        if (tab.status !== "complete") {
          if (tab.status !== "loading") {
            log(LogLevel.INFO, "Tab is not complete and isn't loading, reloading:", tab.id);

            await browser.tabs.reload(tab.id);
          } else {
            log(LogLevel.INFO, "Tab is loading, waiting:", tab.id);

            await waitForTabComplete(tab.id);
          }
        }

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
      }
    });
  } else {
    log(LogLevel.WARN, "Tab has no ID, cannot move to contextual identity:", tab.id);
  }
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
          log(LogLevel.INFO, "Tab is discarded, activating:", tab.id);

          await browser.tabs.update(tabId, { active: true });
        }

        if (tab.status === "complete") {
          log(LogLevel.INFO, "Tab is complete, resolving:", tab.id);

          browser.tabs.onUpdated.removeListener(listener);
          resolve();
        } else if (tab.status !== "loading") {
          log(LogLevel.INFO, "Tab is not complete and isn't loading, reloading:", tab.id);

          await browser.tabs.reload(tabId);
          resolve();
        }
      }
    }),
  );
}

async function updateContextualIdentity(
  // @ts-ignore: tabGroups is supported in Firefox 139+, but not in type definitions yet
  tabGroup: browser.tabGroups.TabGroup,
  cookieStoreId: string,
): Promise<void> {
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
// #endregion
