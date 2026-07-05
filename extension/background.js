// Background service worker v3 — estado por pestaña + fetch de skip-events.
// El fetch de skip-events va aquí porque el background no sufre CORS
// (host_permissions lo autoriza) y así cacheamos por episodio.

const tabState = new Map();
const skipEventsCache = new Map(); // mediaId -> {intro, credits, recap, preview} | null

function getState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { video: null, page: null, skipEvents: null, updatedAt: 0 });
  }
  return tabState.get(tabId);
}

async function fetchSkipEvents(mediaId) {
  if (skipEventsCache.has(mediaId)) return skipEventsCache.get(mediaId);
  let result = null;
  try {
    const res = await fetch(
      `https://static.crunchyroll.com/skip-events/production/${mediaId}.json`
    );
    if (res.ok) {
      const json = await res.json();
      result = {};
      for (const key of ['intro', 'credits', 'recap', 'preview']) {
        const ev = json[key];
        if (ev && isFinite(ev.start) && isFinite(ev.end) && ev.end > ev.start) {
          result[key] = { start: ev.start, end: ev.end };
        }
      }
      if (Object.keys(result).length === 0) result = null;
    }
  } catch (e) {
    result = null;
  }
  skipEventsCache.set(mediaId, result);
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Reportes desde content scripts
  if (sender.tab && msg.type === 'videoState') {
    const state = getState(sender.tab.id);
    state.video = msg.data;
    state.updatedAt = Date.now();
    maybeSyncProgress(sender.tab.id);
    pushPresence(sender.tab.id);
    return;
  }

  if (sender.tab && msg.type === 'pageState') {
    const state = getState(sender.tab.id);
    const prevMediaId = state.page?.mediaId;
    const prevSeries = state.page?.seriesTitle;
    state.page = msg.data;
    state.updatedAt = Date.now();

    const mediaId = msg.data.mediaId;
    if (mediaId && mediaId !== prevMediaId) {
      state.skipEvents = null;
      fetchSkipEvents(mediaId).then((events) => {
        const current = tabState.get(sender.tab.id);
        if (current && current.page?.mediaId === mediaId) {
          current.skipEvents = events;
        }
      });
    }

    const series = msg.data.seriesTitle;
    if (series && series !== prevSeries) {
      state.anilist = null;
      lookupAnilist(series).then((media) => {
        const current = tabState.get(sender.tab.id);
        if (current && current.page?.seriesTitle === series) {
          current.anilist = media;
        }
      });
    }
    return;
  }

  // Consultas desde el popup
  if (msg.type === 'getState') {
    sendResponse(tabState.get(msg.tabId) || null);
    return;
  }

  // Comandos desde el popup → a todos los frames de la pestaña
  if (msg.type === 'command') {
    chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') tabState.delete(tabId);
});

// ============================================================
// ANILIST — consultas públicas (sin auth) + sync de progreso (OAuth)
// ============================================================
const ANILIST_API = 'https://graphql.anilist.co';
const anilistCache = new Map(); // seriesTitle -> media | null
const syncedEpisodes = new Set(); // `${mediaId}:${episode}` ya sincronizados

async function anilistQuery(query, variables, token = null) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
  return json.data;
}

async function lookupAnilist(seriesTitle) {
  if (anilistCache.has(seriesTitle)) return anilistCache.get(seriesTitle);
  let media = null;
  try {
    const data = await anilistQuery(
      `query ($search: String) {
        Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english }
          siteUrl
          status
          episodes
          nextAiringEpisode { episode airingAt timeUntilAiring }
        }
      }`,
      { search: seriesTitle }
    );
    media = data.Media || null;
  } catch (e) {
    media = null;
  }
  anilistCache.set(seriesTitle, media);
  return media;
}

function parseEpisodeNumber(episodeTitle) {
  const m = (episodeTitle || '').match(/\bE(\d{1,4})\b/i);
  return m ? parseInt(m[1], 10) : null;
}

async function maybeSyncProgress(tabId) {
  const state = tabState.get(tabId);
  if (!state?.video || !state?.page) return;

  const { anilistSync } = await chrome.storage.sync.get({ anilistSync: false });
  if (!anilistSync) return;

  const { anilistToken } = await chrome.storage.local.get('anilistToken');
  if (!anilistToken) return;

  const { video, page } = state;
  if (!video.duration || video.currentTime / video.duration < 0.85) return;

  const episode = parseEpisodeNumber(page.episodeTitle);
  if (!episode || !page.seriesTitle) return;

  const media = await lookupAnilist(page.seriesTitle);
  if (!media) return;

  const key = `${media.id}:${episode}`;
  if (syncedEpisodes.has(key)) return;
  syncedEpisodes.add(key);

  try {
    await anilistQuery(
      `mutation ($mediaId: Int, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id progress }
      }`,
      { mediaId: media.id, progress: episode },
      anilistToken
    );
    state.anilistLastSync = { episode, at: Date.now() };
  } catch (e) {
    syncedEpisodes.delete(key); // reintentar en el próximo tick
  }
}

// Client ID por defecto de Tsuki (cliente de AniList del desarrollador,
// con Redirect URL registrada al extension ID fijo). El usuario puede
// poner el suyo propio en Ajustes si prefiere.
const DEFAULT_ANILIST_CLIENT_ID = '45080';

// OAuth implicit grant de AniList vía chrome.identity
async function anilistAuth() {
  let { anilistClientId } = await chrome.storage.sync.get({ anilistClientId: '' });
  if (!anilistClientId) anilistClientId = DEFAULT_ANILIST_CLIENT_ID;

  const redirect = chrome.identity.getRedirectURL();
  const authUrl =
    `https://anilist.co/api/v2/oauth/authorize` +
    `?client_id=${encodeURIComponent(anilistClientId)}&response_type=token`;

  try {
    const resultUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
    const fragment = new URL(resultUrl).hash.slice(1);
    const token = new URLSearchParams(fragment).get('access_token');
    if (!token) return { ok: false, error: 'AniList no devolvió token' };
    await chrome.storage.local.set({ anilistToken: token });
    return { ok: true, redirect };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Mensajería adicional (AniList)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'anilistAuth') {
    anilistAuth().then(sendResponse);
    return true; // respuesta asíncrona
  }
  if (msg.type === 'anilistLogout') {
    chrome.storage.local.remove('anilistToken').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'getSkipEvents') {
    fetchSkipEvents(msg.mediaId).then(sendResponse);
    return true; // respuesta asíncrona
  }
  if (msg.type === 'anilistStatus') {
    chrome.storage.local.get('anilistToken').then(({ anilistToken }) => {
      sendResponse({ connected: !!anilistToken, redirect: chrome.identity.getRedirectURL() });
    });
    return true;
  }
});


// ============================================================
// DISCORD RICH PRESENCE (vía Tsuki Bridge en localhost)
// ============================================================
const BRIDGE_URL = 'http://127.0.0.1:21387';
const NATIVE_HOST = 'com.tsuki.bridge';
let lastPresencePush = 0;
let presenceTabId = null;

// --- Native messaging: UN solo puerto persistente. ---
// Reglas de ciclo de vida:
//  - El host SOLO se lanza si Discord Rich Presence está activado.
//  - Un único puerto reutilizado (cada connectNative lanza un proceso nuevo,
//    así que jamás se crean conexiones por-ping o por-click).
//  - Al apagar el toggle: clear + disconnect → el host se cierra solo.
let nativePort = null;
let nativeUnavailable = false;
let pendingResponses = [];

function connectPort() {
  if (nativePort) return nativePort;
  if (nativeUnavailable) return null;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener((m) => {
      const resolver = pendingResponses.shift();
      if (resolver) resolver(m);
    });
    port.onDisconnect.addListener(() => {
      nativePort = null;
      pendingResponses.splice(0).forEach((r) => r(null));
      if (chrome.runtime.lastError?.message?.includes('not found')) {
        nativeUnavailable = true;
      }
    });
    nativePort = port;
    return port;
  } catch (e) {
    nativeUnavailable = true;
    return null;
  }
}

function disconnectPort() {
  if (nativePort) {
    try { nativePort.disconnect(); } catch (e) {}
    nativePort = null;
  }
  pendingResponses.splice(0).forEach((r) => r(null));
}

// Envía por el puerto persistente y espera la respuesta del host
function portRequest(msg, timeoutMs = 800) {
  return new Promise((resolve) => {
    const port = connectPort();
    if (!port) return resolve(null);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, timeoutMs);
    pendingResponses.push((m) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(m); }
    });
    try {
      port.postMessage(msg);
    } catch (e) {
      disconnectPort();
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    }
  });
}

// Envía al bridge por la vía disponible. Devuelve 'native' | 'http' | null.
async function sendToBridge(type, data) {
  const port = connectPort();
  if (port) {
    try {
      port.postMessage({ type, data });
      return 'native';
    } catch (e) {
      disconnectPort(); // puerto muerto: probar HTTP en este envío
    }
  }
  try {
    const path = type === 'presence' ? '/presence' : '/' + type;
    await fetch(BRIDGE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    return 'http';
  } catch (e) {
    return null;
  }
}

function resolveLang(language) {
  if (language === 'es' || language === 'en') return language;
  return (chrome.i18n.getUILanguage() || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}

async function pushPresence(tabId) {
  const { discordPresence, discordDiscreet, language } = await chrome.storage.sync.get({
    discordPresence: false,
    discordDiscreet: false,
    language: 'auto',
  });
  if (!discordPresence) return;

  const state = tabState.get(tabId);
  if (!state?.video || !state?.page) return;

  // Si hay varios tabs con video, el último que reporta gana
  presenceTabId = tabId;

  // Throttle: push cada 10s, o inmediato si cambió el estado de pausa
  const now = Date.now();
  const key = `${state.page.mediaId}:${state.video.paused}:${discordDiscreet}`;
  if (now - lastPresencePush < 10000 && key === pushPresence._lastKey) return;
  pushPresence._lastKey = key;
  lastPresencePush = now;

  await sendToBridge('presence', {
        style: discordDiscreet ? 'discreto' : 'normal',
        lang: resolveLang(language),
        episode: parseEpisodeNumber(state.page.episodeTitle) || 0,
        playbackRate: state.video.playbackRate || 1,
        series: state.page.seriesTitle || '',
        episodeTitle: state.page.episodeTitle || '',
        currentTime: state.video.currentTime,
        duration: state.video.duration,
        paused: state.video.paused,
        thumbnail: state.page.thumbnail || '',
        url: state.page.url || '',
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === presenceTabId) {
    presenceTabId = null;
    sendToBridge('clear');
  }
});

// Ping para que el popup muestre el estado del bridge
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'bridgePing') {
    (async () => {
      const { discordPresence } = await chrome.storage.sync.get({ discordPresence: false });
      if (!discordPresence) {
        // Toggle apagado: NO lanzar el host solo para chequear
        disconnectPort();
        sendResponse({ connected: false, disabled: true });
        return;
      }
      nativeUnavailable = false; // popup abierto: reintentar si acaban de instalar
      const res = await portRequest({ type: 'ping' });
      if (res) {
        sendResponse({ connected: true, mode: 'native' });
        return;
      }
      disconnectPort();
      try {
        const j = await fetch(BRIDGE_URL + '/ping').then((r) => r.json());
        sendResponse({ connected: !!j.ok, mode: 'http' });
      } catch (e) {
        sendResponse({ connected: false });
      }
    })();
    return true;
  }
});


// Al apagar el toggle de Discord, limpiar la actividad de inmediato
// (sin esto, la última actividad quedaba visible hasta el auto-clear de 25s)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.discordPresence) {
    if (changes.discordPresence.newValue === false) {
      pushPresence._lastKey = '';
      // Limpiar la actividad y CERRAR el host: sin toggle no hay proceso
      (async () => {
        if (nativePort) {
          await portRequest({ type: 'clear' }, 500);
        } else {
          fetch(BRIDGE_URL + '/clear', { method: 'POST' }).catch(() => {});
        }
        disconnectPort();
      })();
    } else {
      nativeUnavailable = false; // recién activado: permitir conexión
    }
  }
  if (area === 'sync' && changes.discordDiscreet) {
    pushPresence._lastKey = '';
    lastPresencePush = 0; // el próximo videoState (≤1s) empuja el estilo nuevo
  }
});
