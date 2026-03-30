let proxies = [];
let domains = [];
let globalMode = false;
let autoEnabled = false;
let globalActiveId = null;
let editingId = null;
let currentProto = "socks5";
let proxyStatus = {};

const $ = id => document.getElementById(id);
const createElement = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function save(obj, cb) {
  chrome.storage.local.set(obj, cb);
}

function apply() {
  chrome.runtime.sendMessage({ type: "REFRESH" });
}

// Переключение вкладок
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $("tab-" + tab.dataset.tab).classList.add("active");
  });
});

function updateStatus() {
  const chip = $("statusChip");
  const dot = $("statusDot");
  const txt = $("statusTxt");
  const sub = $("hdrSub");

  chip.className = "status-chip";
  dot.className = "dot";

  if (autoEnabled) {
    chip.classList.add("global");
    dot.classList.add("pulse");
    const p = proxies.find(x => x.id === globalActiveId);
    txt.textContent = "FAILOVER";
    sub.textContent = p ? `⟳ ${p.name || p.host}` : "Failover";
  } else if (globalMode && globalActiveId) {
    chip.classList.add("global");
    dot.classList.add("pulse");
    const p = proxies.find(x => x.id === globalActiveId);
    txt.textContent = "GLOBAL";
    sub.textContent = p ? p.name || p.host : "Global";
    $("globalBar").classList.add("active-global");
  } else {
    $("globalBar").classList.remove("active-global");
    const active = domains.filter(d => d.enabled !== false);
    if (active.length) {
      chip.classList.add("on");
      dot.classList.add("pulse");
      txt.textContent = `${active.length} domain${active.length > 1 ? "s" : ""}`;
      sub.textContent = "Domain mode";
    } else {
      txt.textContent = "DIRECT";
      sub.textContent = "No proxy";
    }
  }
}

function renderProxies() {
  const list = $("proxyList");
  $("proxyCount").textContent = proxies.length;

  if (!proxies.length) {
    list.innerHTML = `<div class="no-proxies"><div class="no-proxies-icon">🔌</div>Добавь прокси-серверы<br>для начала работы</div>`;
    return;
  }

  list.innerHTML = "";

  proxies.forEach(p => {
    const isSelected = (globalMode || autoEnabled) && p.id === globalActiveId;
    const status = proxyStatus[p.id] || { state: "unknown" };
    const dotCls = status.state === "ok" ? "ok" : status.state === "fail" ? "fail" : "";
    const statusTxt = status.state === "ok" ? "online" : status.state === "fail" ? "недоступен" : "—";

    const card = createElement("div", `proxy-card${isSelected ? " selected" : ""}${p.autoSwitch ? " auto-marked" : ""}`);
    card.innerHTML = `
      <div class="proxy-card-radio"><div class="proxy-card-radio-dot"></div></div>
      <div class="proxy-card-info">
        <div class="proxy-card-name">${escHtml(p.name || p.host)}</div>
        <div class="proxy-card-addr">
          <span class="conn-dot ${dotCls}"></span>
          <span>${escHtml(p.host)}:${escHtml(p.port)}${p.username ? " 🔑" : ""}</span>
          <span class="ping-ms ${dotCls}">${statusTxt}</span>
        </div>
      </div>
      <div class="proxy-card-badges">
        <span class="badge ${p.socks ? "badge-socks" : "badge-http"}">${p.socks ? "SOCKS5" : "HTTP"}</span>
        ${p.autoSwitch ? '<span class="badge badge-auto">AUTO</span>' : ""}
      </div>
      <div class="proxy-card-actions">
        <button class="icon-btn edit" title="Редактировать" data-id="${p.id}">✎</button>
        <button class="icon-btn del" title="Удалить" data-id="${p.id}">×</button>
      </div>
    `;

    card.addEventListener("click", e => {
      if (e.target.closest(".icon-btn")) return;
      globalActiveId = p.id;
      save({ globalActiveId }, () => { renderProxies(); updateStatus(); apply(); });
    });

    card.querySelector(".edit").addEventListener("click", e => { e.stopPropagation(); openModal(p.id); });
    card.querySelector(".del").addEventListener("click", e => { e.stopPropagation(); deleteProxy(p.id); });

    list.appendChild(card);
  });

  updateDomainSelect();
}

function deleteProxy(id) {
  proxies = proxies.filter(p => p.id !== id);
  if (globalActiveId === id) globalActiveId = proxies[0]?.id || null;
  domains = domains.map(d => d.proxyId === id ? { ...d, proxyId: proxies[0]?.id || null } : d);
  save({ proxies, domains, globalActiveId }, () => { renderProxies(); renderDomains(); updateStatus(); apply(); });
}

function renderDomains() {
  const list = $("domainList");
  $("domainCount").textContent = domains.length;

  if (!domains.length) {
    list.innerHTML = `<div class="domain-empty"><div class="domain-empty-icon">🌐</div>Добавь домены — прокси будет<br>работать только для них.<br>Нажми на точку чтобы отключить.</div>`;
    return;
  }

  list.innerHTML = "";

  domains.forEach((d, idx) => {
    const p = proxies.find(x => x.id === d.proxyId);
    const enabled = d.enabled !== false;
    const item = createElement("div", `domain-item${!enabled ? " disabled" : ""}`);

    item.innerHTML = `
      <div class="domain-en-dot" title="${enabled ? "Отключить" : "Включить"}"></div>
      <span class="domain-name-text">${escHtml(d.domain)}</span>
      <span class="domain-proxy-badge ${p ? (p.socks ? "socks" : "http") : ""}">${p ? escHtml(p.name || p.host) : "—"}</span>
      <button class="icon-btn del" title="Удалить" data-idx="${idx}">×</button>
    `;

    item.querySelector(".domain-en-dot").addEventListener("click", () => {
      domains[idx] = { ...d, enabled: !enabled };
      save({ domains }, () => { renderDomains(); updateStatus(); apply(); });
    });

    item.querySelector(".del").addEventListener("click", () => {
      domains.splice(idx, 1);
      save({ domains }, () => { renderDomains(); updateStatus(); apply(); });
    });

    list.appendChild(item);
  });
}

function updateDomainSelect() {
  const sel = $("domainProxySelect");
  const prev = sel.value;
  sel.innerHTML = "";

  if (!proxies.length) {
    const opt = createElement("option", null, "— нет прокси —");
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }

  proxies.forEach(p => {
    const opt = createElement("option");
    opt.value = p.id;
    opt.textContent = (p.name || p.host) + (p.socks ? " [S5]" : " [H]");
    sel.appendChild(opt);
  });

  if (prev && proxies.find(p => p.id === prev)) sel.value = prev;
}

function addDomain() {
  const val = $("domainInput").value.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*/, "")
    .toLowerCase();

  if (!val || domains.find(d => d.domain === val)) {
    $("domainInput").focus();
    return;
  }

  const proxyId = $("domainProxySelect").value || proxies[0]?.id || null;
  domains.push({ domain: val, proxyId, enabled: true });
  $("domainInput").value = "";
  $("domainInput").focus();
  save({ domains }, () => { renderDomains(); updateStatus(); apply(); });
}

$("addDomainBtn").addEventListener("click", addDomain);
$("domainInput").addEventListener("keydown", e => { if (e.key === "Enter") addDomain(); });

$("globalToggle").addEventListener("change", function () {
  globalMode = this.checked;
  if (globalMode && !globalActiveId && proxies.length) globalActiveId = proxies[0].id;
  save({ globalMode, globalActiveId }, () => { renderProxies(); updateStatus(); apply(); });
});

$("autoHeader").addEventListener("click", function (e) {
  if (e.target.closest(".tog")) return;
  $("autoBody").classList.toggle("open");
});

$("autoTogLabel").addEventListener("click", e => e.stopPropagation());

$("autoToggle").addEventListener("change", function () {
  autoEnabled = this.checked;
  save({ autoEnabled }, () => { updateStatus(); renderProxies(); apply(); });
});

// Слушаем обновления статуса прокси от background
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "HEALTH_UPDATE") {
    proxyStatus[msg.id] = { state: msg.state };
    renderProxies();
  }
  if (msg.type === "HEALTH_SNAPSHOT") {
    Object.entries(msg.data || {}).forEach(([id, state]) => {
      proxyStatus[id] = { state };
    });
    renderProxies();
  }
  if (msg.type === "FAILOVER_SWITCHED") {
    globalActiveId = msg.to;
    if (msg.from) proxyStatus[msg.from] = { state: "fail" };
    proxyStatus[msg.to] = { state: "ok" };
    save({ globalActiveId });
    renderProxies();
    updateStatus();
  }
});

chrome.runtime.sendMessage({ type: "GET_HEALTH" });

// Синхронизация globalActiveId если failover сработал в фоне
setInterval(() => {
  if (!autoEnabled) return;
  chrome.storage.local.get("globalActiveId", d => {
    if (d.globalActiveId !== globalActiveId) {
      globalActiveId = d.globalActiveId;
      renderProxies();
      updateStatus();
    }
  });
}, 2000);

function openModal(id) {
  editingId = id;
  const p = id ? proxies.find(x => x.id === id) : null;

  $("modalTitle").textContent = id ? "Редактировать прокси" : "Добавить прокси";
  $("mName").value = p?.name || "";
  $("mHost").value = p?.host || "";
  $("mPort").value = p?.port || "";
  $("mUser").value = p?.username || "";
  $("mPass").value = p?.password || "";
  $("mAutoSwitch").checked = p?.autoSwitch || false;

  currentProto = p ? (p.socks ? "socks5" : "http") : "socks5";
  document.querySelectorAll(".proto-opt").forEach(o => {
    o.classList.remove("active", "active-http");
    if (o.dataset.proto === currentProto) {
      o.classList.add(currentProto === "socks5" ? "active" : "active-http");
    }
  });

  $("modalOverlay").classList.add("open");
  setTimeout(() => $("mName").focus(), 100);
}

function closeModal() {
  $("modalOverlay").classList.remove("open");
  editingId = null;
}

$("addProxyBtn").addEventListener("click", () => openModal(null));
$("modalClose").addEventListener("click", closeModal);
$("modalOverlay").addEventListener("click", e => { if (e.target === $("modalOverlay")) closeModal(); });

document.querySelectorAll(".proto-opt").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".proto-opt").forEach(o => o.classList.remove("active", "active-http"));
    currentProto = opt.dataset.proto;
    opt.classList.add(currentProto === "socks5" ? "active" : "active-http");
  });
});

$("modalSave").addEventListener("click", () => {
  const host = $("mHost").value.trim();
  const port = $("mPort").value.trim();

  if (!host || !port) {
    $("mHost").style.borderColor = "var(--red)";
    setTimeout(() => $("mHost").style.borderColor = "", 1500);
    return;
  }

  const proxy = {
    id:         editingId || uid(),
    name:       $("mName").value.trim() || host,
    host,
    port,
    username:   $("mUser").value.trim(),
    password:   $("mPass").value,
    socks:      currentProto === "socks5",
    autoSwitch: $("mAutoSwitch").checked,
  };

  if (editingId) {
    proxies = proxies.map(p => p.id === editingId ? proxy : p);
  } else {
    proxies.push(proxy);
    if (!globalActiveId) globalActiveId = proxy.id;
  }

  save({ proxies, globalActiveId }, () => { renderProxies(); renderDomains(); updateStatus(); apply(); });
  closeModal();
});

// Тултипы для кнопок "i"
function bindTooltip(btnId, tooltipId) {
  const btn = $(btnId);
  const tooltip = $(tooltipId);
  btn.addEventListener("click", e => { e.stopPropagation(); tooltip.classList.toggle("open"); });
  document.addEventListener("click", () => tooltip.classList.remove("open"));
}

bindTooltip("webrtcInfoBtn", "webrtcTooltip");
bindTooltip("twitchInfoBtn", "twitchTooltip");

function setWebRTC(enabled, persist) {
  $("webrtcToggle").checked = enabled;
  $("webrtcDesc").textContent = enabled ? "Включено — реальный IP скрыт" : "Отключено";
  $("webrtcDesc").className = enabled ? "tool-desc on" : "tool-desc";
  $("webrtcCard").classList.toggle("active-tool", enabled);
  updateToolsStatus();
  if (persist) {
    save({ webrtcProtect: enabled });
    chrome.runtime.sendMessage({ type: "SET_WEBRTC", enabled });
  }
}

function setTwitch(enabled, persist) {
  $("twitchToggle").checked = enabled;
  $("twitchDesc").textContent = enabled ? "Включено — CDN подменяется на EU" : "Отключено";
  $("twitchDesc").className = enabled ? "tool-desc on" : "tool-desc";
  $("twitchCard").classList.toggle("active-tool", enabled);
  updateToolsStatus();
  if (persist) {
    save({ twitchHD: enabled });
    chrome.runtime.sendMessage({ type: "SET_TWITCH", enabled });
  }
}

function updateToolsStatus() {
  const active = [];
  if ($("webrtcToggle").checked) active.push("WebRTC защита");
  if ($("twitchToggle").checked) active.push("Twitch 1080p");

  const block = $("toolsStatusBlock");
  const icon = block.querySelector(".tools-status-icon");
  const text = block.querySelector(".tools-status-text");

  if (active.length) {
    icon.textContent = "✅";
    text.textContent = "Активно: " + active.join(", ");
    text.style.color = "var(--green)";
  } else {
    icon.textContent = "💤";
    text.textContent = "Все инструменты отключены";
    text.style.color = "";
  }
}

$("webrtcToggle").addEventListener("change", function () { setWebRTC(this.checked, true); });
$("twitchToggle").addEventListener("change", function () { setTwitch(this.checked, true); });

function btnFeedback(id, successText, originalText, color) {
  const btn = $(id);
  btn.textContent = successText;
  btn.style.borderColor = `var(${color})`;
  btn.style.color = `var(${color})`;
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.borderColor = "";
    btn.style.color = "";
  }, 2000);
}

$("exportBtn").addEventListener("click", () => {
  const keys = ["proxies", "domains", "globalMode", "globalActiveId", "autoEnabled", "webrtcProtect", "twitchHD"];
  chrome.storage.local.get(keys, data => {
    const json = JSON.stringify({ _version: 1, ...data }, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `proxy-switcher-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
    btnFeedback("exportBtn", "✓ Сохранено", "⬆ Экспорт", "--green");
  });
});

$("importBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", function () {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data._version) throw new Error("Неверный формат");

      const { _version, ...toStore } = data;
      chrome.storage.local.set(toStore, () => {
        proxies        = toStore.proxies        || [];
        domains        = toStore.domains        || [];
        globalMode     = toStore.globalMode     || false;
        globalActiveId = toStore.globalActiveId || proxies[0]?.id || null;
        autoEnabled    = toStore.autoEnabled    || false;

        $("globalToggle").checked = globalMode;
        $("autoToggle").checked = autoEnabled;

        renderProxies();
        renderDomains();
        updateStatus();

        const webrtcOn = toStore.webrtcProtect !== false;
        setWebRTC(webrtcOn, false);
        setTwitch(toStore.twitchHD || false, false);
        chrome.runtime.sendMessage({ type: "SET_WEBRTC", enabled: webrtcOn });
        chrome.runtime.sendMessage({ type: "SET_TWITCH", enabled: toStore.twitchHD || false });
        apply();

        btnFeedback("importBtn", "✓ Загружено", "⬇ Импорт", "--green");
      });
    } catch {
      btnFeedback("importBtn", "✗ Ошибка", "⬇ Импорт", "--red");
    }
  };

  reader.readAsText(file);
  this.value = "";
});

// Загрузка состояния при открытии попапа
chrome.storage.local.get(
  ["proxies", "domains", "globalMode", "globalActiveId", "autoEnabled", "webrtcProtect", "twitchHD"],
  data => {
    proxies        = data.proxies        || [];
    domains        = data.domains        || [];
    globalMode     = data.globalMode     || false;
    globalActiveId = data.globalActiveId || proxies[0]?.id || null;
    autoEnabled    = data.autoEnabled    || false;

    $("globalToggle").checked = globalMode;
    $("autoToggle").checked = autoEnabled;

    renderProxies();
    renderDomains();
    updateStatus();

    // WebRTC включён по умолчанию
    const webrtcOn = data.webrtcProtect !== false;
    setWebRTC(webrtcOn, data.webrtcProtect === undefined);
    setTwitch(data.twitchHD || false, false);
  }
);