const LOGIN_URL = "https://www.chiphell.com/member.php?mod=logging&action=login";
// 打赏：打开扩展内置的收款码页面（微信 / 支付宝扫码，无需跳转登录）
const COFFEE_URL = chrome.runtime.getURL("donate.html");

const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  if (!ts) return "尚未检查";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let unreadObserver;

function render(state, settings) {
  if (unreadObserver) unreadObserver.disconnect();
  const dot = $("dot");
  const statusText = $("statusText");
  const banner = $("banner");
  const notifyBanner = $("notifyBanner");

  if (state.lastNotificationError) {
    notifyBanner.textContent = `系统通知发送失败，稍后重试：${state.lastNotificationError}`;
    notifyBanner.style.display = "block";
  } else {
    notifyBanner.style.display = "none";
  }

  if (state.loginOk === false) {
    dot.className = "dot bad";
    statusText.textContent = "Chiphell 未登录";
    banner.style.display = "block";
  } else if (state.loginOk === true) {
    dot.className = "dot ok";
    statusText.textContent = "已登录";
    banner.style.display = "none";
  } else {
    dot.className = "dot";
    statusText.textContent = "未知";
    banner.style.display = "none";
  }

  const sourceErrors = Object.entries(state.sourceStatus || {})
    .filter(([, status]) => status.ok === false)
    .map(([key, status]) => `${key === "chiphell" ? "Chiphell" : "V2EX"}：${status.error || "检查失败"}`);
  const sourceError = sourceErrors.join("；") || state.lastError || "";
  $("sourceBanner").textContent = sourceError;
  $("sourceBanner").style.display = sourceError ? "block" : "none";
  if (sourceError) {
    dot.className = "dot bad";
    statusText.textContent = Object.values(state.sourceStatus || {}).some((s) => s.ok)
      ? "部分来源异常" : "监控异常";
  }

  const list = $("list");
  const empty = $("empty");
  list.innerHTML = "";
  const threads = state.threads || [];
  const unread = new Set(state.unreadTids || []);

  // 只清除滚动视口中实际出现的未读项，后台按这些 ID 合并最新状态。
  const observedIds = new Map();
  const observer = new IntersectionObserver((entries) => {
    const tids = [];
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      tids.push(observedIds.get(entry.target));
      observer.unobserve(entry.target);
    }
    if (tids.length) chrome.runtime.sendMessage({ type: "markRead", tids });
  }, { root: list });
  unreadObserver = observer;

  if (threads.length === 0) {
    empty.style.display = "block";
    empty.textContent = state.lastError || "暂无帖子";
  } else {
    empty.style.display = "none";
    threads.forEach((t) => {
      const li = document.createElement("li");
      const isNew = unread.has(t.tid);
      const cls = [];
      if (isNew) cls.push("new");
      if (t.match) cls.push("match");
      li.className = cls.join(" ");
      const title = document.createElement("span");
      title.className = "t";
      title.innerHTML =
        (isNew ? '<span class="newdot"></span>' : "") +
        `<span class="source-tag">${escapeHtml(t.sourceLabel || "Chiphell")}</span>` +
        (t.match ? '<span class="kwtag">关键词</span>' : "") +
        escapeHtml(t.title);
      const by = document.createElement("span");
      by.className = "by";
      by.textContent = t.author ? "by " + t.author : "";
      li.appendChild(title);
      li.appendChild(by);
      li.addEventListener("click", () => chrome.tabs.create({ url: t.url }));
      list.appendChild(li);
      if (isNew) {
        observedIds.set(li, t.tid);
        unreadObserver.observe(li);
      }
    });
  }

  const meta = $("meta");
  const nUnread = (state.unreadTids || []).length;
  meta.textContent =
    (nUnread > 0 ? `${nUnread} 新 · ` : "") +
    `更新于 ${fmtTime(state.lastCheck)}`;
}

async function load() {
  const resp = await chrome.runtime.sendMessage({ type: "getState" });
  if (resp && resp.ok) render(resp.state, resp.settings);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

$("refresh").addEventListener("click", async () => {
  const btn = $("refresh");
  btn.disabled = true;
  btn.textContent = "刷新中…";
  const resp = await chrome.runtime.sendMessage({ type: "checkNow" });
  if (resp && resp.ok) render(resp.state, resp.settings);
  btn.disabled = false;
  btn.textContent = "立即刷新";
});

$("coffee").addEventListener("click", () => chrome.tabs.create({ url: COFFEE_URL }));
$("opt").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("loginLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: LOGIN_URL });
});

load();
