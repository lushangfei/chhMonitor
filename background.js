// Chiphell 二手区监控 - service worker (MV3)

const MONITOR_URL =
  "https://www.chiphell.com/forum-328-1.html";
const LOGIN_URL = "https://www.chiphell.com/member.php?mod=logging&action=login";
const V2EX_URL = "https://www.v2ex.com/go/all4all?p=1";
const V2EX_FEED_URL = "https://www.v2ex.com/feed/all4all.json";
const ALARM = "ch_check";
const REQUEST_TIMEOUT_MS = 15000;
const KNOWN_CAP = 800; // 记忆的历史帖子 id 上限，防止无限增长

// 检查和已读操作共用队列，避免异步读后写相互覆盖。
let operationQueue = Promise.resolve();
function serializeOperation(operation) {
  const result = operationQueue.then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

// ---------- 存储辅助 ----------
async function getSettings() {
  const r = await chrome.storage.local.get(["settings"]);
  return Object.assign(
    {
      intervalMinutes: 5,
      notify: false,
      notifyPopup: true,
      notifySound: false,
      keywords: "",
      keywordFilter: false,
      authors: "",
      authorFilter: false,
      combine: "or",
    },
    r.settings || {}
  );
}

// 关键词解析：支持中英文逗号 / 顿号 / 分号 / 换行分隔。
// 不按空格分隔，以便支持 "R5 5600" 这类短语关键词。
function parseKeywords(raw) {
  if (!raw) return [];
  return raw
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 按包含匹配关键词；短语中的空格可匹配空白或常见连接符。
// 例如 "iPhone" 可命中 "iPhone17"，"R5 5600" 仍按完整短语匹配。
function keywordPattern(keyword) {
  const parts = keyword.trim().split(/\s+/).map(escapeRegExp);
  const phrase = parts.join("[\\s\\-_/\\/·・‐‑‒–—]+");
  return new RegExp(phrase, "i");
}

function matchKeywords(title, keywords) {
  return keywords.some((keyword) => keywordPattern(keyword).test(title || ""));
}

// 发帖人解析：按逗号 / 顿号 / 分号 / 换行分隔（不按空格，用户名可能含空格）
function parseAuthors(raw) {
  if (!raw) return [];
  return raw
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
async function getState() {
  const r = await chrome.storage.local.get(["state"]);
  return r.state || {};
}
async function patchState(patch) {
  const s = await getState();
  await chrome.storage.local.set({ state: Object.assign({}, s, patch) });
}
function ensureDefaults() {
  return serializeOperation(async () => {
    const r = await chrome.storage.local.get(["settings", "state"]);
    await chrome.storage.local.set({
      settings: Object.assign(
        {
          intervalMinutes: 5,
          notify: false,
          notifyPopup: true,
          notifySound: false,
          keywords: "",
          keywordFilter: false,
          authors: "",
          authorFilter: false,
          combine: "or",
        },
        r.settings || {}
      ),
      state: r.state || {},
    });
  });
}

// ---------- HTML 解析（service worker 无 DOMParser，用正则） ----------
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

function parseDisplayTime(value, now = Date.now()) {
  const text = decodeEntities(stripTags(value || "")).trim();
  if (!text) return null;

  const relative = text.match(/(刚刚|\d+\s*秒前|\d+\s*分钟前|\d+\s*小时前|\d+\s*天前)/);
  if (relative) {
    if (relative[1] === "刚刚") return now;
    const amount = Number(relative[1].match(/\d+/)[0]);
    const unit = relative[1];
    const factor = unit.includes("秒") ? 1000 : unit.includes("分钟") ? 60000 : unit.includes("小时") ? 3600000 : 86400000;
    return now - amount * factor;
  }

  const relativeDay = text.match(/(今天|昨天|前天)\s*(\d{1,2}):(\d{2})/);
  if (relativeDay) {
    const date = new Date(now);
    date.setDate(date.getDate() - ({ 今天: 0, 昨天: 1, 前天: 2 }[relativeDay[1]]));
    date.setHours(Number(relativeDay[2]), Number(relativeDay[3]), 0, 0);
    return date.getTime();
  }

  // JSON Feed 用带时区的 ISO 8601 时间（例如 +00:00）；直接解析以保留时区，
  // 不能把 UTC 的小时误当成本地时间。
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const zoned = Date.parse(text);
    if (!Number.isNaN(zoned)) return zoned;
  }

  const fullDate = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (fullDate) {
    return new Date(
      Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]),
      Number(fullDate[4] || 0), Number(fullDate[5] || 0), Number(fullDate[6] || 0)
    ).getTime();
  }

  const shortDate = text.match(/(?:^|\D)(\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (shortDate) {
    const current = new Date(now);
    let year = current.getFullYear();
    let date = new Date(year, Number(shortDate[1]) - 1, Number(shortDate[2]), Number(shortDate[3] || 0), Number(shortDate[4] || 0));
    if (date.getTime() > now + 86400000) date = new Date(year - 1, Number(shortDate[1]) - 1, Number(shortDate[2]), Number(shortDate[3] || 0), Number(shortDate[4] || 0));
    return date.getTime();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractChiphellPostTime(block) {
  const byCells = [...block.matchAll(/<td\b[^>]*class=["'][^"']*\bby\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/g)];
  // Discuz 每行先列发帖人/发帖时间，再列最后回复人/回复时间；取第一个 by 单元格与 V2EX 的 date_published 对齐。
  const postCell = byCells[0]?.[1] || block;
  const attrs = [...postCell.matchAll(/(?:title|datetime)=["']([^"']+)["']/g)];
  for (const attr of attrs) {
    const parsed = parseDisplayTime(attr[1]);
    if (parsed !== null) return parsed;
  }
  const em = [...postCell.matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/g)].pop();
  if (em) return parseDisplayTime(em[1]);
  return parseDisplayTime(postCell);
}

function sortNewestFirst(threads) {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const aTime = Number(a.thread.publishedAt) || 0;
      const bTime = Number(b.thread.publishedAt) || 0;
      return bTime - aTime || a.index - b.index;
    })
    .map(({ thread }) => thread);
}

// 只解析 normalthread_（普通主题），忽略置顶 stickthread_
function parseThreads(html) {
  const threads = [];
  const re = /<tbody id="normalthread_(\d+)">([\s\S]*?)<\/tbody>/g;
  let m;
  while ((m = re.exec(html))) {
    const tid = m[1];
    const block = m[2];
    const tm = block.match(/<a[^>]*class="s xst"[^>]*>([\s\S]*?)<\/a>/);
    if (!tm) continue;
    const title = decodeEntities(stripTags(tm[1])).trim();
    if (!title) continue;
    // Chiphell 会把版规作为普通主题返回（没有 stickthread_ 标记）；它不是一条需要监控的交易帖。
    if (/版规/.test(title)) continue;
    let author = "";
    const am = block.match(/<td class="by">[\s\S]*?<cite>([\s\S]*?)<\/cite>/);
    if (am) author = decodeEntities(stripTags(am[1])).trim();
    threads.push({
      tid: `chh:${tid}`,
      title,
      author,
      publishedAt: extractChiphellPostTime(block),
      url: `https://www.chiphell.com/thread-${tid}-1-1.html`,
      source: "chiphell",
      sourceLabel: "Chiphell",
    });
  }
  return threads;
}

function parseV2exFeed(json) {
  const feed = JSON.parse(json);
  return (feed.items || [])
    .filter((item) => item && item.id && item.title && item.url)
    .map((item) => {
      const author = Array.isArray(item.authors) ? item.authors[0] : item.author;
      const id = String(item.id).match(/\/t\/(\d+)/)?.[1] || String(item.id);
      const date = item.date_published || item.date_modified;
      const publishedAt = date ? Date.parse(date) : null;
      return {
        tid: `v2ex:${id}`,
        title: item.title,
        author: (author && author.name) || "",
        publishedAt: Number.isNaN(publishedAt) ? null : publishedAt,
        url: item.url,
        source: "v2ex",
        sourceLabel: "V2EX",
      };
    });
}

// 登录检测：登录后页面含 退出登录 链接（action=logout）
function detectLogin(html) {
  return /action=logout/.test(html);
}

// ---------- 徽标 / 通知 ----------
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}
function updateBadge(count, settings) {
  setBadge(settings.notify && count ? String(count) : "", "#c8102e");
}
async function syncBadge() {
  const [state, settings] = await Promise.all([getState(), getSettings()]);
  updateBadge((state.unreadTids || []).length, settings);
}
async function notify(title, message, targetUrl = MONITOR_URL, stableId = "") {
  const notificationId = stableId || `monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { notificationTargets = {} } = await chrome.storage.local.get(["notificationTargets"]);
  await chrome.storage.local.set({ notificationTargets: { ...notificationTargets, [notificationId]: targetUrl } });
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 1,
  });
}

let offscreenCreation;
async function playNotificationSound() {
  const documentUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length === 0) {
    if (!offscreenCreation) {
      offscreenCreation = chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play the user-enabled new post notification sound.",
      }).finally(() => { offscreenCreation = undefined; });
    }
    await offscreenCreation;
  }
  const response = await chrome.runtime.sendMessage({ type: "playNotificationSound" });
  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "提示音播放失败");
  }
}

function notificationBatchId(threads) {
  const value = threads.map((thread) => thread.tid).sort().join("|");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return `monitor-batch-${(hash >>> 0).toString(36)}`;
}

// ---------- 核心检查 ----------
async function fetchText(url, options) {
  const controller = new AbortController();
  // 定时器一直保留到正文读完，覆盖已返回响应头、正文却卡住的情况。
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("请求超时（15 秒）");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let checkInFlight;
function runCheck(reason) {
  // 自动、手动和页面加载触发同一轮检查，共享结果，避免堆积重复请求。
  if (!checkInFlight) {
    checkInFlight = serializeOperation(() => performCheck(reason))
      .finally(() => { checkInFlight = undefined; });
  }
  return checkInFlight;
}

async function performCheck(reason) {
  const settings = await getSettings();
  const st = await getState();

  const [chiphellResult, v2exResult] = await Promise.all([
    fetchText(MONITOR_URL, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml" },
    }).then((html) => ({ loggedIn: detectLogin(html), threads: parseThreads(html) })).catch((error) => ({ error })),
    fetchText(V2EX_FEED_URL, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/feed+json, application/json" },
    }).then((text) => ({ threads: parseV2exFeed(text) })).catch((error) => ({ error })),
  ]);

  // 关键词和发帖人过滤同时应用于 Chiphell 与 V2EX。
  const kws = parseKeywords(settings.keywords);
  const authors = parseAuthors(settings.authors);
  const kwOn = !!settings.keywordFilter && kws.length > 0;
  const auOn = !!settings.authorFilter && authors.length > 0;
  const anyFilter = kwOn || auOn;
  const combineAnd = settings.combine === "and";
  const matchKw = (title) => matchKeywords(title, kws);
  const matchAu = (author) => authors.includes((author || "").toLowerCase());
  const isAlertable = (t) => {
    if (kwOn && !auOn) return matchKw(t.title);
    if (!kwOn && auOn) return matchAu(t.author);
    // 两个过滤器都开：按组合方式
    return combineAnd
      ? matchKw(t.title) && matchAu(t.author)
      : matchKw(t.title) || matchAu(t.author);
  };
  const known = new Set((st.knownTids || []).map((id) =>
    String(id).startsWith("chh:") || String(id).startsWith("v2ex:")
      ? String(id)
      : `chh:${id}`
  ));
  const unread = new Set((st.unreadTids || []).map((id) =>
    String(id).startsWith("chh:") || String(id).startsWith("v2ex:")
      ? String(id)
      : `chh:${id}`
  ));
  let threads = (st.threads || []).map((t) => ({
    ...t,
    tid: String(t.tid).startsWith("chh:") || String(t.tid).startsWith("v2ex:")
      ? String(t.tid)
      : `chh:${t.tid}`,
    source: t.source || "chiphell",
    sourceLabel: t.sourceLabel || "Chiphell",
  }));
  const pendingAlerts = new Map(
    (st.pendingAlerts || []).map((thread) => [thread.tid, thread])
  );
  const errors = [];
  const sourceStatus = {};
  let nextState = {};
  let notifyLogin = false;

  const sourceResults = [
    { key: "chiphell", label: "Chiphell", result: chiphellResult, seeded: !!st.seeded },
    { key: "v2ex", label: "V2EX", result: v2exResult, seeded: !!st.v2exSeeded },
  ];

  for (const source of sourceResults) {
    const { result } = source;
    if (result.error) {
      const message = result.error.message || "检查失败";
      errors.push(`${source.label}：${message}`);
      sourceStatus[source.key] = { ok: false, error: message, count: 0 };
      continue;
    }
    if (source.key === "chiphell" && !result.loggedIn) {
      nextState.loginOk = false;
      const message = "需要登录或登录已过期";
      errors.push(`Chiphell：${message}`);
      sourceStatus[source.key] = { ok: false, error: message, count: 0 };
      if (settings.notify && settings.notifyPopup && !st.loginWarned) {
        notifyLogin = true;
      }
      continue;
    }
    if (!result.threads.length) {
      const message = "未解析到帖子";
      errors.push(`${source.label}：${message}`);
      sourceStatus[source.key] = { ok: false, error: message, count: 0 };
      continue;
    }

    const current = result.threads.map((thread) => ({
      ...thread,
      match: anyFilter && isAlertable(thread),
    }));
    const brandNew = source.seeded ? current.filter((thread) => !known.has(thread.tid)) : [];
    // 未启用任何筛选时，所有新帖都符合提醒条件；只有启用了筛选才执行匹配。
    const matchingNew = anyFilter ? brandNew.filter(isAlertable) : brandNew;
    matchingNew.forEach((thread) => {
      unread.add(thread.tid);
      if (settings.notify && (settings.notifyPopup || settings.notifySound)) {
        pendingAlerts.set(thread.tid, thread);
      }
    });
    current.forEach((thread) => known.add(thread.tid));
    const currentIds = new Set(current.map((thread) => thread.tid));
    // 未读帖即使滚出来源首页也要保留，直到用户实际看到。
    threads = threads.filter((thread) => thread.source !== source.key ||
      (unread.has(thread.tid) && !currentIds.has(thread.tid))).concat(current);
    sourceStatus[source.key] = { ok: true, error: "", count: current.length };
    nextState[source.key === "chiphell" ? "seeded" : "v2exSeeded"] = true;
    if (source.key === "chiphell") {
      nextState.loginOk = true;
      nextState.loginWarned = false;
      nextState.lastLoginNotificationError = "";
    }
  }

  const chiphellThreads = threads.filter((thread) => thread.source === "chiphell");
  const v2exThreads = threads.filter((thread) => thread.source === "v2ex");
  threads = sortNewestFirst([...v2exThreads, ...chiphellThreads]);
  const knownArr = [...known].slice(-KNOWN_CAP);
  await patchState({
    ...nextState,
    knownTids: knownArr,
    unreadTids: [...unread],
    pendingAlerts: [...pendingAlerts.values()],
    threads,
    lastCheck: Date.now(),
    lastError: errors.join("；"),
    sourceStatus,
  });

  updateBadge(unread.size, await getSettings());

  // 先保存两个来源的检查结果，再发送登录提醒；失败时下一轮继续重试。
  if (notifyLogin) {
    try {
      await notify("Chiphell 监控：需要登录", "检测到未登录或登录已过期，点击扩展图标去登录。", LOGIN_URL, "monitor-login-required");
      await patchState({ loginWarned: true, lastLoginNotificationError: "" });
    } catch (error) {
      await patchState({ loginWarned: false, lastLoginNotificationError: error.message || "登录提醒发送失败" });
    }
  }

  if (settings.notify && (settings.notifyPopup || settings.notifySound) && pendingAlerts.size > 0) {
    const batch = sortNewestFirst([...pendingAlerts.values()]);
    const head = batch
      .slice(0, 3)
      .map((thread) => `• [${thread.sourceLabel || "新帖"}] ${thread.title}`)
      .join("\n");
    const more = batch.length > 3 ? `\n…共 ${batch.length} 条` : "";
    const targetUrl = batch[0].source === "v2ex" ? V2EX_URL : MONITOR_URL;
    try {
      if (settings.notifyPopup) {
        await notify(
          `CHH / V2EX ${batch.length} 条新帖${anyFilter ? "（命中过滤）" : ""}`,
          head + more,
          targetUrl,
          notificationBatchId(batch)
        );
      }
      if (settings.notifySound) await playNotificationSound();
      await patchState({ pendingAlerts: [], lastNotificationError: "" });
    } catch (error) {
      await patchState({
        pendingAlerts: batch,
        lastNotificationError: error.message || "通知发送失败",
      });
    }
  }
}

function markRead(tids) {
  const displayed = new Set(Array.isArray(tids) ? tids : []);
  return serializeOperation(async () => {
    const state = await getState();
    const unreadTids = (state.unreadTids || []).filter((tid) => !displayed.has(tid));
    await patchState({ unreadTids });
    updateBadge(unreadTids.length, await getSettings());
  });
}

// ---------- 定时器（带抖动，规避流控） ----------
async function scheduleNext() {
  const settings = await getSettings();
  const base = Math.max(1, settings.intervalMinutes || 5);
  const jitter = base * 0.25 * Math.random(); // 0 ~ 25% 抖动
  chrome.alarms.create(ALARM, { delayInMinutes: base + jitter });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) runCheck("alarm").finally(scheduleNext);
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await serializeOperation(syncBadge);
  await runCheck("install");
  scheduleNext();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await serializeOperation(syncBadge);
  runCheck("startup");
  scheduleNext();
});

// 点击通知 -> 打开二手区
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const { notificationTargets = {} } = await chrome.storage.local.get(["notificationTargets"]);
  const url = notificationTargets[notificationId] || MONITOR_URL;
  delete notificationTargets[notificationId];
  await chrome.storage.local.set({ notificationTargets });
  chrome.tabs.create({ url });
});

// 当用户在 chiphell 页面完成加载（如重新登录后页面刷新）时，立即复查一次，
// 让"登录过期 -> 重新登录"后扩展状态自动刷新，无需手动点刷新。
let lastAutoCheck = 0;
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = (tab && tab.url) || "";
  if (!url.includes("chiphell.com") && !url.includes("v2ex.com/go/all4all")) return;
  const st = await getState();
  const now = Date.now();
  // 登录过期时优先立即复查；否则 30 秒节流，避免频繁请求触发风控
  if (st.loginOk === false || now - lastAutoCheck > 30000) {
    lastAutoCheck = now;
    await runCheck("tab-loaded");
    await scheduleNext();
  }
});

// ---------- 消息（来自 popup / options） ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.type === "playNotificationSound") return false;
  (async () => {
    if (msg.type === "getState") {
      send({ ok: true, state: await getState(), settings: await getSettings() });
    } else if (msg.type === "checkNow") {
      await runCheck("manual");
      await scheduleNext();
      send({ ok: true, state: await getState(), settings: await getSettings() });
    } else if (msg.type === "markRead") {
      await markRead(msg.tids);
      send({ ok: true });
    } else if (msg.type === "settingsChanged") {
      // 关闭通知时立即隐藏角标；队列同步可避免被正在进行的检查覆盖。
      if (!(await getSettings()).notify) setBadge("", "#c8102e");
      await serializeOperation(syncBadge);
      await scheduleNext();
      send({ ok: true });
    } else {
      send({ ok: false });
    }
  })();
  return true; // 异步响应
});
