# CHH / V2EX 新帖提醒（非官方）

一个 Chrome 扩展（Manifest V3），用于监控 Chiphell 二手交易区和 V2EX「二手交易」节点的新帖并及时提醒。
**非官方第三方工具，与 Chiphell 和 V2EX 均无关联。**

> 📦 已上架 **[Chrome 应用商店](https://chromewebstore.google.com/detail/chh-%E4%BA%8C%E6%89%8B%E5%8C%BA%E4%B8%8A%E6%96%B0%E6%8F%90%E9%86%92%EF%BC%88%E9%9D%9E%E5%AE%98%E6%96%B9%EF%BC%89/aipfcjlcbjcdflfjbndifpdngmakbhea)** —— 点击一键安装。

## 功能

- 📛 **角标计数**：图标上显示未读新帖数量
- 🔎 **多站点监控**：同时监控 Chiphell 二手区和 V2EX「二手交易」节点
- 📋 **列表直达**：点图标弹出列表（标题 + 发帖人），点条目在新标签打开原帖
- 🔔 **新帖提醒**：总开关控制角标和帖子红点；开启后可分别控制桌面提示与提示音
- 🏷️ **关键词过滤**：填写并启用时只提醒标题命中的新帖；关键词留空则不限制标题（发帖人筛选独立生效）
- 👤 **发帖人过滤**：只盯指定卖家，可与关键词按「或 / 且」组合
- ⏱️ **自定义刷新周期**：1–30 分钟，附随机抖动规避频率风控
- 🔐 **登录检测**：登录过期时在弹窗提示重新登录

## 安装

**推荐**：直接从 [Chrome 应用商店](https://chromewebstore.google.com/detail/chh-%E4%BA%8C%E6%89%8B%E5%8C%BA%E4%B8%8A%E6%96%B0%E6%8F%90%E9%86%92%EF%BC%88%E9%9D%9E%E5%AE%98%E6%96%B9%EF%BC%89/aipfcjlcbjcdflfjbndifpdngmakbhea) 一键安装，自动更新。

监控 Chiphell 需要同一个 Chrome 已登录 chiphell.com；V2EX 节点使用公开 JSON Feed。

### 开发者模式（本地开发 / 自行修改）

1. 打开 `chrome://extensions/`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本目录
4. 监控 Chiphell 需要同一个 Chrome 已登录 chiphell.com；V2EX 节点使用公开 JSON Feed

## 使用

- 点扩展图标查看新帖列表；滚动查看时只将实际显示的条目标为已读，未展示的新帖保留未读状态，通知开启时显示角标
- 点弹窗右下角 **设置** 配置：刷新周期、通知总开关、桌面提示、提示音、关键词、发帖人、组合方式
- 改动设置或代码后，到 `chrome://extensions/` 点 🔄 重新加载

## 工作原理

- 后台 service worker 用 `chrome.alarms` 定时拉取 Chiphell 版块页面和 V2EX JSON Feed，分别解析帖子并用来源 + 帖子 ID 判定"新帖"。
- 首次安装建立基线（不把历史帖当新帖）；之后仅未出现过的帖子算新。
- 登录检测：页面是否含"退出登录"链接。

## 隐私

不收集任何数据，所有设置与记录仅存于本机 `chrome.storage.local`，绝不上传服务器。详见 [PRIVACY.md](./PRIVACY.md)。

## 目录结构

```
chiphell-monitor/
├── manifest.json        扩展清单
├── background.js        后台：定时检查 / 解析 / 通知 / 徽标
├── popup.html/.js       弹窗：新帖列表 + 直达 + 登录提示
├── options.html/.js     设置：周期 / 通知 / 关键词 / 发帖人
├── icons/               图标 16/48/128
├── donate/              赞赏码（微信 / 支付宝）
├── PRIVACY.md           隐私政策
├── LICENSE              MIT 许可证
└── README.md
```

## 赞赏支持

如果这个小工具帮到了你，欢迎请作者喝杯咖啡，感谢支持 🙏

| 微信 | 支付宝 |
|:---:|:---:|
| <img src="./donate/wechatpay.png" width="220" alt="微信赞赏码"> | <img src="./donate/alipay.jpg" width="220" alt="支付宝收款码"> |

## 免责声明

本扩展为第三方非官方工具，与 Chiphell 和 V2EX 均无关联。请在遵守目标网站使用条款的前提下合理使用。

## 许可证

[MIT](./LICENSE) © 2026 lucifer

---

# CHH Marketplace New-Post Alert (Unofficial)

A Chrome extension (Manifest V3) that monitors Chiphell's second-hand section and V2EX's all4all node for new posts and alerts you promptly.
**Unofficial third-party tool, not affiliated with Chiphell or V2EX.**

> 📦 Available on the **[Chrome Web Store](https://chromewebstore.google.com/detail/chh-%E4%BA%8C%E6%89%8B%E5%8C%BA%E4%B8%8A%E6%96%B0%E6%8F%90%E9%86%92%EF%BC%88%E9%9D%9E%E5%AE%98%E6%96%B9%EF%BC%89/aipfcjlcbjcdflfjbndifpdngmakbhea)** — install with one click.

## Features

- 📛 **Badge count**: shows the number of unread new posts on the icon
- 🔎 **Multi-site monitoring**: tracks Chiphell's second-hand section and V2EX's all4all node
- 📋 **Direct list access**: click the icon for a popup list (title + poster); click an item to open the original post in a new tab
- 🔔 **New-post alerts**: the master toggle controls the badge and unread dots, with separate switches for desktop notifications and sound
- 🏷️ **Keyword filter**: when enabled with keywords, only matching titles trigger alerts; empty keywords allow all titles (author filtering still applies)
- 👤 **Poster filter**: watch only specific sellers, combinable with keywords via "OR / AND"
- ⏱️ **Custom refresh interval**: 1–30 minutes, with random jitter to avoid rate-limit controls
- 🔐 **Login detection**: the popup prompts you to log in again when your session expires

## Installation

**Recommended**: install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/chh-%E4%BA%8C%E6%89%8B%E5%8C%BA%E4%B8%8A%E6%96%B0%E6%8F%90%E9%86%92%EF%BC%88%E9%9D%9E%E5%AE%98%E6%96%B9%EF%BC%89/aipfcjlcbjcdflfjbndifpdngmakbhea) for one-click install and automatic updates.

Chiphell monitoring requires the same Chrome profile to be logged in to chiphell.com; the V2EX node uses its public JSON Feed.

### Developer Mode (for local development / customization)

1. Open `chrome://extensions/`
2. Enable **Developer mode** in the top-right corner
3. Click **Load unpacked** and select this directory
4. Chiphell monitoring requires the same Chrome profile to be logged in to chiphell.com; the V2EX node uses its public JSON Feed

## Usage

- Click the extension icon to view the list; unread posts are marked as read when visible while scrolling
- Click **Settings** at the bottom-right of the popup to configure: refresh interval, notification toggle, keywords, posters, and combination mode
- After changing settings or code, go to `chrome://extensions/` and click 🔄 to reload

## How It Works

- A background service worker uses `chrome.alarms` to fetch Chiphell's forum page and V2EX's JSON Feed, then identifies new posts by source and post ID.
- Only unread posts visible in the popup scroll area are marked as read; unseen posts retain their badge count.
- On first install it establishes a baseline (so historical posts aren't treated as new); afterward, only posts not seen before count as new.
- Login detection: whether the page contains a "log out" link.

## Privacy

Collects no data. All settings and records are stored only on your machine in `chrome.storage.local` and are never uploaded to any server. See [PRIVACY.md](./PRIVACY.md) for details.

## Directory Structure

```
chiphell-monitor/
├── manifest.json        Extension manifest
├── background.js        Background: scheduled checks / parsing / notifications / badge
├── popup.html/.js       Popup: new-post list + direct links + login prompt
├── options.html/.js     Settings: interval / notifications / keywords / posters
├── icons/               Icons 16/48/128
├── donate/              Donation QR codes (WeChat / Alipay)
├── PRIVACY.md           Privacy policy
├── LICENSE              MIT License
└── README.md
```

## Support the Project

If this little tool helps you, feel free to buy the author a coffee — thanks for your support 🙏

| WeChat Pay | Alipay |
|:---:|:---:|
| <img src="./donate/wechatpay.png" width="220" alt="WeChat Pay"> | <img src="./donate/alipay.jpg" width="220" alt="Alipay"> |

## Disclaimer

This extension is an unofficial third-party tool with no affiliation to Chiphell or V2EX. Please use it reasonably and in compliance with the target websites' terms of service.

## License

[MIT](./LICENSE) © 2026 lucifer
