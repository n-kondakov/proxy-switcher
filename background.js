const proxyHealth = {};

function buildPAC(proxies, domains, globalActiveId) {
  const proxyStr = p => p.socks ? `SOCKS5 ${p.host}:${p.port}` : `PROXY ${p.host}:${p.port}`;
  const direct = `function FindProxyForURL(url, host) { return "DIRECT"; }`;

  if (globalActiveId) {
    const p = proxies.find(x => x.id === globalActiveId);
    return p ? `function FindProxyForURL(url, host) { return "${proxyStr(p)}"; }` : direct;
  }

  const active = (domains || []).filter(d => d.enabled !== false);
  if (!active.length) return direct;

  const cases = active.map(d => {
    const host = d.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const p = proxies.find(x => x.id === d.proxyId);
    return `  if (dnsDomainIs(host, "${host}") || host === "${host}") return "${p ? proxyStr(p) : "DIRECT"}";`;
  }).join("\n");

  return `function FindProxyForURL(url, host) {\n${cases}\n  return "DIRECT";\n}`;
}

function applyPAC(pac) {
  chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pac } }, scope: "regular" });
}

function clearProxy() {
  chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
}

function refreshProxy() {
  chrome.storage.local.get(["proxies", "domains", "globalActiveId", "globalMode"], data => {
    const proxies = data.proxies || [];
    const domains = data.domains || [];
    const activeId = data.globalMode ? data.globalActiveId : null;
    const hasDomains = domains.some(d => d.enabled !== false && proxies.find(p => p.id === d.proxyId));

    if (!activeId && !hasDomains) return clearProxy();
    applyPAC(buildPAC(proxies, domains, activeId));
  });
}

function setHealth(id, state) {
  if (proxyHealth[id] === state) return;
  proxyHealth[id] = state;
  chrome.runtime.sendMessage({ type: "HEALTH_UPDATE", id, state }).catch(() => {});
}

// Слушаем ошибки прокси пассивно — никаких запросов наружу не делаем
chrome.proxy.onProxyError.addListener(details => {
  chrome.storage.local.get(["proxies", "globalActiveId", "globalMode", "autoEnabled"], data => {
    const currentId = data.globalActiveId;
    if (currentId) setHealth(currentId, "fail");

    if (!data.autoEnabled || !data.globalMode) return;

    const allAuto = (data.proxies || []).filter(p => p.autoSwitch);
    if (allAuto.length < 2) return;

    const curIdx = allAuto.findIndex(p => p.id === currentId);
    const next = allAuto[(curIdx + 1) % allAuto.length];
    if (!next || next.id === currentId) return;

    chrome.storage.local.set({ globalActiveId: next.id }, () => {
      refreshProxy();
      setHealth(next.id, "ok");
      chrome.runtime.sendMessage({ type: "FAILOVER_SWITCHED", from: currentId, to: next.id }).catch(() => {});
    });
  });
});

// Прокси успешно применён — помечаем как живой
chrome.proxy.settings.onChange.addListener(() => {
  chrome.storage.local.get(["globalActiveId", "globalMode"], data => {
    if (data.globalMode && data.globalActiveId) setHealth(data.globalActiveId, "ok");
  });
});

function applyWebRTC(enabled) {
  const value = enabled ? "disable_non_proxied_udp" : "default";
  chrome.privacy.network.webRTCIPHandlingPolicy.set({ value, scope: "regular" });
}

// Список публичных прокси-серверов для Twitch (от rte.net.ru).
// Они перехватывают запросы к usher.ttvnw.net — серверу плейлистов Twitch,
// который и отдаёт ссылки на нужное качество. Через прокси он возвращает 1080p.
const TWITCH_PROXIES = [
  "https://proxy4.rte.net.ru/",
  "https://proxy7.rte.net.ru/",
  "https://proxy5.rte.net.ru/",
  "https://proxy6.rte.net.ru/",
];

let twitchProxyUrl = null;

async function findTwitchProxy() {
  for (const url of TWITCH_PROXIES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url + "https://google.com", {
        method: "HEAD",
        mode: "cors",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return url;
    } catch {
      // этот прокси недоступен, пробуем следующий
    }
  }
  return null;
}

async function applyTwitch(enabled) {
  // Правило id=100 зарезервировано под Twitch
  if (!enabled) {
    twitchProxyUrl = null;
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [100] });
    return;
  }

  const proxy = await findTwitchProxy();
  if (!proxy) {
    console.warn("Twitch 1080p: нет доступных прокси");
    return;
  }

  twitchProxyUrl = proxy;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [100],
    addRules: [{
      id: 100,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: proxy + "\\0" },
      },
      condition: {
        initiatorDomains: ["twitch.tv"],
        regexFilter: "^https://usher\\.ttvnw\\.net/.*",
        resourceTypes: ["xmlhttprequest", "media"],
      },
    }],
  });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "REFRESH")    refreshProxy();
  if (msg.type === "SET_WEBRTC") applyWebRTC(msg.enabled);
  if (msg.type === "SET_TWITCH") applyTwitch(msg.enabled);
  if (msg.type === "GET_HEALTH") {
    chrome.runtime.sendMessage({ type: "HEALTH_SNAPSHOT", data: proxyHealth }).catch(() => {});
  }
});

function init() {
  refreshProxy();
  chrome.storage.local.get(["webrtcProtect", "twitchHD"], data => {
    applyWebRTC(data.webrtcProtect !== false);
    applyTwitch(data.twitchHD || false);
  });
}

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);