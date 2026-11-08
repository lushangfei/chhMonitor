const $ = (id) => document.getElementById(id);
// 打赏：打开扩展内置的收款码页面（微信 / 支付宝扫码，无需跳转登录）
const COFFEE_URL = chrome.runtime.getURL("donate.html");

document.addEventListener("DOMContentLoaded", () => {
  const c = $("coffee");
  if (c) c.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: COFFEE_URL });
  });
});

async function load() {
  const r = await chrome.storage.local.get(["settings"]);
  const s = Object.assign(
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
  $("interval").value = String(s.intervalMinutes);
  $("notify").checked = !!s.notify;
  $("notifyPopup").checked = !!s.notifyPopup;
  $("notifySound").checked = !!s.notifySound;
  updateNotificationControls();
  $("keywords").value = s.keywords || "";
  $("keywordFilter").checked = !!s.keywordFilter;
  $("authors").value = s.authors || "";
  $("authorFilter").checked = !!s.authorFilter;
  $("combine").value = s.combine === "and" ? "and" : "or";
}

function updateNotificationControls() {
  const enabled = $("notify").checked;
  $("notifyPopup").disabled = !enabled;
  $("notifySound").disabled = !enabled;
}

$("notify").addEventListener("change", updateNotificationControls);

$("save").addEventListener("click", async () => {
  const settings = {
    intervalMinutes: parseInt($("interval").value, 10) || 5,
    notify: $("notify").checked,
    notifyPopup: $("notifyPopup").checked,
    notifySound: $("notifySound").checked,
    keywords: $("keywords").value.trim(),
    keywordFilter: $("keywordFilter").checked,
    authors: $("authors").value.trim(),
    authorFilter: $("authorFilter").checked,
    combine: $("combine").value === "and" ? "and" : "or",
  };
  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: "settingsChanged" });
  const saved = $("saved");
  saved.classList.add("show");
  setTimeout(() => saved.classList.remove("show"), 1500);
});

load();
