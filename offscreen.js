async function playChime() {
  const context = new AudioContext();
  await context.resume();

  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.setValueAtTime(1175, now + 0.12);
  oscillator.connect(gain);
  oscillator.start(now);
  oscillator.stop(now + 0.29);

  await new Promise((resolve) => { oscillator.onended = resolve; });
  await context.close();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "playNotificationSound") return false;
  playChime().then(
    () => sendResponse({ ok: true }),
    (error) => sendResponse({ ok: false, error: error.message || "提示音播放失败" })
  );
  return true;
});
