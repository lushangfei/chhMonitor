const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const turn = () => new Promise(setImmediate);
const post = (tid, publishedAt = 1) => ({ tid, title: tid, source: tid.startsWith('chh:') ? 'chiphell' : 'v2ex', publishedAt });
const response = (threads) => ({ ok: true, text: async () => JSON.stringify(threads) });

function background(fetch, initial = {}) {
  const data = { settings: { notify: false }, state: { seeded: true, v2exSeeded: true, ...initial } };
  const timers = new Map();
  const badges = [];
  const notifications = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: {
      get: async (keys) => structuredClone(Object.fromEntries(keys.map((key) => [key, data[key]]))),
      set: async (items) => Object.assign(data, structuredClone(items)),
    } },
    action: { setBadgeText: ({ text }) => badges.push(text), setBadgeBackgroundColor() {} },
    alarms: { onAlarm: event },
    runtime: { onInstalled: event, onStartup: event, onMessage: event },
    notifications: { onClicked: event, create: async (id, options) => notifications.push({ id, ...options }) }, tabs: { onUpdated: event },
  };
  const context = vm.createContext({ chrome, fetch, AbortController,
    setTimeout: (fn) => { const id = Symbol(); timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  // Network fixtures isolate scheduling/storage from the forum HTML format.
  vm.runInContext('parseThreads = JSON.parse; parseV2exFeed = JSON.parse; detectLogin = () => true;', context);
  return { context, data, timers, badges, notifications };
}

for (const stalledSource of ['chiphell', 'v2ex']) {
  for (const phase of ['headers', 'body']) {
    test(`${stalledSource} timeout during ${phase} still commits the healthy source`, async () => {
      const healthyId = stalledSource === 'chiphell' ? 'v2ex:new' : 'chh:new';
      const env = background((url, { signal }) => {
        if (url.includes(stalledSource)) {
          const pending = () => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
          return phase === 'body' ? Promise.resolve({ ok: true, text: pending }) : pending();
        }
        return Promise.resolve(response([post(healthyId)]));
      });
      const checking = env.context.runCheck('manual');
      await turn();
      assert.equal(env.timers.size, 1);
      [...env.timers.values()][0]();
      await checking;
      assert.deepEqual(env.data.state.unreadTids, [healthyId]);
      assert.equal(env.data.state.sourceStatus[stalledSource].ok, false);
      assert.match(env.data.state.lastError, /请求超时/);
      assert.equal(env.badges.at(-1), '1');
      assert.equal(env.timers.size, 0);
    });
  }
}

test('overlapping triggers share one check; reads during fetch preserve newly arrived unread posts', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  const env = background(async (url) => {
    requests++;
    await gate;
    return response(url.includes('chiphell') ? [post('chh:old'), post('chh:new', 2)] : [post('v2ex:old')]);
  }, { knownTids: ['chh:old', 'v2ex:old'], unreadTids: ['chh:old'] });
  const first = env.context.runCheck('alarm');
  const second = env.context.runCheck('manual');
  assert.equal(first, second);
  await turn();
  const reading = env.context.markRead(['chh:old']);
  release();
  await Promise.all([first, second, reading]);
  assert.equal(requests, 2);
  assert.deepEqual(env.data.state.unreadTids, ['chh:new']);
  assert.equal(env.badges.at(-1), '1');
  await env.context.markRead();
  assert.deepEqual(env.data.state.unreadTids, ['chh:new']);
  await env.context.runCheck('later');
  assert.equal(requests, 4);
  assert.deepEqual(env.data.state.unreadTids, ['chh:new']);
});

test('unseen unread posts remain accessible after falling off the source homepage', async () => {
  const env = background(async (url) => response([post(url.includes('chiphell') ? 'chh:new' : 'v2ex:old')]), {
    knownTids: ['chh:old', 'v2ex:old'], unreadTids: ['chh:old'], threads: [post('chh:old')],
  });
  await env.context.runCheck('manual');
  assert(env.data.state.threads.some((thread) => thread.tid === 'chh:old'));
  await env.context.markRead(['chh:old']);
  await env.context.runCheck('manual');
  assert(!env.data.state.threads.some((thread) => thread.tid === 'chh:old'));
});

test('failed check releases the operation queue for subsequent reads/checks', async () => {
  const env = background(async () => response([post('chh:new')]));
  vm.runInContext('const originalGetSettings = getSettings; getSettings = async () => { throw new Error("storage unavailable"); };', env.context);
  await assert.rejects(env.context.runCheck('manual'), /storage unavailable/);
  vm.runInContext('getSettings = originalGetSettings;', env.context);
  await env.context.runCheck('manual');
  await env.context.markRead(['chh:new']);
  assert.deepEqual(env.data.state.unreadTids, []);
});

test('popup exposes all posts, reports source failure with cached data, and acknowledges only visible rows', () => {
  class Element {
    constructor() { this.children = []; this.style = {}; }
    set innerHTML(value) { this.children = []; this.html = value; }
    get innerHTML() { return this.html || this.textContent || ''; }
    appendChild(element) { this.children.push(element); }
    addEventListener() {}
  }
  const elements = new Map();
  const messages = [];
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    disconnect() { this.observed.clear(); }
  }
  const context = vm.createContext({
    document: { getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    }, createElement: () => new Element() },
    IntersectionObserver: Observer,
    chrome: { runtime: { getURL: (s) => s, sendMessage: (message) => {
      messages.push(message); return Promise.resolve();
    } } },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), context);
  const threads = Array.from({ length: 100 }, (_, i) => post(`chh:${i}`));
  context.render({ loginOk: true, threads, unreadTids: threads.map((t) => t.tid),
    lastLoginNotificationError: 'login failed', lastNotificationError: 'post failed',
    sourceStatus: { chiphell: { ok: true }, v2ex: { ok: false, error: 'HTTP 503' } },
  });
  assert.equal(elements.get('list').children.length, 100);
  assert.equal(elements.get('sourceBanner').style.display, 'block');
  assert.match(elements.get('sourceBanner').textContent, /V2EX：HTTP 503/);
  assert.equal(elements.get('statusText').textContent, '部分来源异常');
  assert.match(elements.get('notifyBanner').textContent, /登录提醒：login failed/);
  assert.match(elements.get('notifyBanner').textContent, /新帖提醒：post failed/);
  assert.equal(messages.filter((m) => m.type === 'markRead').length, 0);
  const observer = observers.at(-1);
  observer.callback([
    { target: elements.get('list').children[0], isIntersecting: true },
    { target: elements.get('list').children[50], isIntersecting: false },
  ]);
  assert.deepEqual(Array.from(messages.at(-1).tids), ['chh:0']);
  observer.callback([{ target: elements.get('list').children[50], isIntersecting: true }]);
  assert.deepEqual(Array.from(messages.at(-1).tids), ['chh:50']);
  context.render({ threads, unreadTids: [], sourceStatus: { chiphell: { ok: true }, v2ex: { ok: true } } });
  assert.equal(elements.get('sourceBanner').style.display, 'none');
  assert.equal(elements.get('notifyBanner').style.display, 'none');
});

for (const settings of [
  { keywords: "", keywordFilter: false },
  { keywords: "", keywordFilter: true },
  { keywords: "  ,，;\n", keywordFilter: true },
  { keywords: "iphone", keywordFilter: false },
  { keywords: "iphone", keywordFilter: true },
]) {
  test(`optional keywords: ${JSON.stringify(settings)} sends the expected batch`, async () => {
    const env = background(async (url) => response(url.includes('chiphell')
      ? [post('chh:iphone17'), post('chh:switch')]
      : [post('v2ex:iphone17'), post('v2ex:mac')]));
    env.data.settings = { notify: true, notifyPopup: true, notifySound: false, ...settings };
    await env.context.runCheck('manual');
    const filtered = settings.keywordFilter && settings.keywords === 'iphone';
    assert.equal(env.data.state.unreadTids.length, filtered ? 2 : 4);
    assert.equal(env.notifications.length, 1);
    assert.match(env.notifications[0].title, filtered ? /2 条新帖/ : /4 条新帖/);
    if (filtered) assert(env.data.state.unreadTids.every((id) => id.includes('iphone17')));
  });
}

test('login notification failure preserves V2EX results and retries independently of new-post notifications', async () => {
  let loggedIn = false;
  let failLogin = true;
  let loginAttempts = 0;
  const env = background(async (url) => response(url.includes('chiphell') ? [post('chh:old')] : [post('v2ex:new')]));
  env.context.detectLogin = () => loggedIn;
  env.data.settings = { notify: true, notifyPopup: true, notifySound: false };
  env.context.chrome.notifications.create = async (id, options) => {
    if (id === 'monitor-login-required') {
      loginAttempts++;
      assert.equal(env.data.state.sourceStatus.v2ex.ok, true);
      assert.deepEqual(env.data.state.unreadTids, ['v2ex:new']);
      if (failLogin) throw new Error('notification permission denied');
    }
    env.notifications.push({ id, ...options });
  };
  await env.context.runCheck('manual');
  assert.equal(env.data.state.loginOk, false);
  assert.equal(env.data.state.loginWarned, false);
  assert.equal(env.data.state.sourceStatus.chiphell.ok, false);
  assert.match(env.data.state.lastError, /Chiphell/);
  assert.match(env.data.state.lastLoginNotificationError, /permission denied/);
  assert.equal(env.data.state.lastNotificationError, '');
  assert.equal(env.notifications.length, 1);
  assert.match(env.notifications[0].title, /1 条新帖/);
  assert.equal(env.badges.at(-1), '1');
  failLogin = false;
  await env.context.runCheck('retry');
  assert.equal(loginAttempts, 2);
  assert.equal(env.data.state.loginWarned, true);
  assert.equal(env.data.state.lastLoginNotificationError, '');
  assert.equal(env.data.notificationTargets['monitor-login-required'], 'https://www.chiphell.com/member.php?mod=logging&action=login');
  await env.context.runCheck('again');
  assert.equal(loginAttempts, 2);
  loggedIn = true;
  await env.context.runCheck('logged-in');
  assert.equal(env.data.state.loginOk, true);
  assert.equal(env.data.state.loginWarned, false);
  assert.equal(env.data.state.lastLoginNotificationError, '');
});

test('enabling desktop notifications while logged out sends the previously unsent login warning', async () => {
  const env = background(async (url) => response([post(url.includes('chiphell') ? 'chh:old' : 'v2ex:old')]));
  env.context.detectLogin = () => false;
  await env.context.runCheck('notifications-off');
  assert.notEqual(env.data.state.loginWarned, true);
  env.data.settings = { notify: true, notifyPopup: true, notifySound: false };
  await env.context.runCheck('notifications-on');
  assert.equal(env.data.state.loginWarned, true);
  assert.equal(env.notifications.filter((n) => n.id === 'monitor-login-required').length, 1);
});
