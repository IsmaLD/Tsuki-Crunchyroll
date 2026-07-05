// Crunchyroll Auto Skip v3 — content script (corre en TODOS los frames)
// Frame del player (iframe con <video>): auto-skip, estado, comandos, shortcuts, PiP.
// Frame principal: scraping de página, CSS de layout (theater/tamaño), shortcuts next/prev.

const DEFAULTS = {
  // Auto-skip
  skipIntro: true, skipEnding: true, skipRecap: true, autoNext: true,
  // Player
  theater: false, playerSize: 'normal', dblClickMax: true,
  hideDim: false, hideSubs: false, hideBigPlay: false, hidePlayerUi: false,
  hideBanner: false, hideScrollbar: false, blurPreview: false,
  playerButton: true,
  // Atajos
  kbSeek: true, kbSpeed: true, kbNextPrev: true, disableNumpad: false,
  // Integraciones (usadas por background/popup)
  anilistSync: false, anilistClientId: '',
  discordPresence: false, discordDiscreet: false,
  language: 'auto',
};

let settings = { ...DEFAULTS };
const IS_TOP = window.top === window;

// ------------------------------------------------------------
// Ciclo de vida: cuando la extensión se recarga, este script queda
// huérfano ("Extension context invalidated"). Detectamos eso y nos
// auto-apagamos en vez de spamear errores cada segundo.
// ------------------------------------------------------------
const timers = [];
let dead = false;

function contextAlive() {
  try {
    return !dead && !!chrome.runtime?.id;
  } catch (e) {
    return false;
  }
}

function shutdown() {
  if (dead) return;
  dead = true;
  for (const t of timers) clearInterval(t);
  try { observer.disconnect(); } catch (e) {}
  console.info('[Tsuki] contexto invalidado (extensión recargada) — script antiguo apagado. Refresca la pestaña.');
}

function every(ms, fn) {
  const id = setInterval(() => {
    if (!contextAlive()) return shutdown();
    try { fn(); } catch (e) { /* nunca romper la página */ }
  }, ms);
  timers.push(id);
  return id;
}

try {
  console.info('[Tsuki] v' + chrome.runtime.getManifest().version + ' activo en', IS_TOP ? 'página principal' : 'iframe');
} catch (e) {}

function safeSend(msg) {
  if (!contextAlive()) return shutdown();
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch (e) {
    shutdown();
  }
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  applyCss();
});
chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue;
  }
  applyCss();
});

// ============================================================
// PATRONES DE TEXTO (multi-idioma)
// ============================================================
const INTRO_PATTERNS = [
  /skip\s*intro/i, /saltar\s*(la\s*)?intro/i, /pular\s*abertura/i,
  /passer\s*l['’]?intro/i, /intro\s*überspringen/i,
];
const ENDING_PATTERNS = [
  /skip\s*(credits|ending|outro)/i, /saltar\s*(los\s*)?cr[eé]ditos/i,
  /pular\s*(cr[eé]ditos|encerramento)/i, /passer\s*le\s*g[eé]n[eé]rique/i,
  /abspann\s*überspringen/i,
];
const RECAP_PATTERNS = [
  /skip\s*recap/i, /saltar\s*(el\s*)?resumen/i, /pular\s*recapitula[cç][aã]o/i,
  /passer\s*le\s*r[eé]cap/i, /zusammenfassung\s*überspringen/i,
];
const NEXT_PATTERNS = [
  /next\s*episode/i, /siguiente\s*episodio/i, /pr[oó]ximo\s*epis[oó]dio/i,
  /[eé]pisode\s*suivant/i, /n[aä]chste\s*(folge|episode)/i,
];
const PREV_PATTERNS = [
  /previous\s*episode/i, /episodio\s*anterior/i, /epis[oó]dio\s*anterior/i,
  /[eé]pisode\s*pr[eé]c[eé]dent/i, /vorherige\s*(folge|episode)/i,
];

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

// El player puede vivir dentro de shadow DOM según la variante del sitio;
// querySelector plano no lo ve. Caché + búsqueda profunda como fallback.
let cachedVideo = null;

function deepFindVideo(root) {
  const direct = root.querySelector && root.querySelector('video');
  if (direct) return direct;
  const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of all) {
    if (el.shadowRoot) {
      const v = deepFindVideo(el.shadowRoot);
      if (v) return v;
    }
  }
  return null;
}

function getVideo() {
  if (cachedVideo && cachedVideo.isConnected) return cachedVideo;
  cachedVideo = document.querySelector('video') || deepFindVideo(document);
  return cachedVideo;
}

// ============================================================
// CSS INYECTADO SEGÚN SETTINGS
// NOTA: los selectores de "ocultar X" son best-effort sobre la UI
// actual de Crunchyroll; ajustar aquí si un rediseño los rompe.
// ============================================================
const PLAYER_IFRAME_SEL =
  'iframe[src*="vilos"], iframe[src*="static.crunchyroll.com"]';

// El iframe del player puede cambiar de src con updates de Crunchyroll;
// fallback: el iframe más grande de la página.
function findPlayerIframe() {
  let iframe = document.querySelector(PLAYER_IFRAME_SEL);
  if (iframe) return iframe;
  let best = null;
  let bestArea = 0;
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea && r.width > 400) {
      best = f;
      bestArea = area;
    }
  }
  return best;
}

// Cuando el video vive en la página principal (sin iframe), el "player"
// es el contenedor que envuelve al <video> con ~sus mismas dimensiones.
function findPlayerWrapper(video) {
  const exact = video.closest('.video-player-wrapper') || video.closest('#player-container');
  if (exact) return exact;
  const vr = video.getBoundingClientRect();
  let candidate = video.parentElement || video;
  let cur = video.parentElement;
  let hops = 0;
  while (cur && cur !== document.body && hops < 8) {
    const r = cur.getBoundingClientRect();
    const similarW = Math.abs(r.width - vr.width) < Math.max(40, vr.width * 0.15);
    const similarH = Math.abs(r.height - vr.height) < Math.max(60, vr.height * 0.3);
    if (similarW && similarH) {
      candidate = cur;
      cur = cur.parentElement;
      hops++;
    } else {
      break;
    }
  }
  return candidate;
}

function findPlayerTarget() {
  const iframe = findPlayerIframe();
  if (iframe) return { el: iframe, isIframe: true };
  const video = getVideo();
  if (video) return { el: findPlayerWrapper(video), isIframe: false, video };
  return null;
}

const sizedElements = new Set();

function applyPlayerSizing() {
  if (!IS_TOP) return;
  // Layout actual: lo maneja el CSS exacto de buildCss(). Este JS queda como
  // fallback para layouts desconocidos (p. ej. si Crunchyroll vuelve a cambiar).
  if (document.querySelector('.video-player-wrapper')) {
    if (!settings.theater && settings.playerSize === 'normal') {
      for (const n of sizedElements) {
        for (const p of ['position','inset','width','height','min-height','z-index','background','max-width','max-height','aspect-ratio','overflow']) {
          n.style.removeProperty(p);
        }
      }
      sizedElements.clear();
    }
    return;
  }
  const target = findPlayerTarget();
  if (!target) return;
  const el = target.el;

  const setImp = (node, prop, val) => node.style.setProperty(prop, val, 'important');
  const clear = (node) => {
    for (const p of ['position', 'inset', 'width', 'height', 'min-height', 'z-index', 'background', 'max-width', 'max-height', 'aspect-ratio', 'overflow']) {
      node.style.removeProperty(p);
    }
  };

  if (settings.theater) {
    sizedElements.add(el);
    setImp(el, 'position', 'fixed');
    setImp(el, 'inset', '0');
    setImp(el, 'width', '100vw');
    setImp(el, 'height', '100vh');
    setImp(el, 'z-index', '2147483000');
    setImp(el, 'background', '#000');
    if (target.video) {
      sizedElements.add(target.video);
      setImp(target.video, 'width', '100%');
      setImp(target.video, 'height', '100%');
    }
    document.body.style.setProperty('overflow', 'hidden', 'important');
    return;
  }

  document.body.style.removeProperty('overflow');

  if (settings.playerSize === 'grande' || settings.playerSize === 'XL') {
    const vh = settings.playerSize === 'XL' ? '92vh' : '80vh';
    sizedElements.add(el);
    setImp(el, 'height', vh);
    setImp(el, 'min-height', vh);
    setImp(el, 'width', '100%');
    if (target.video) {
      sizedElements.add(target.video);
      setImp(target.video, 'width', '100%');
      setImp(target.video, 'height', '100%');
    }
    // Soltar restricciones de los contenedores (aspect-ratio, max-height)
    let node = el.parentElement;
    let hops = 0;
    while (node && node !== document.body && hops < 6) {
      sizedElements.add(node);
      setImp(node, 'max-width', 'none');
      setImp(node, 'max-height', 'none');
      setImp(node, 'height', 'auto');
      setImp(node, 'aspect-ratio', 'auto');
      node = node.parentElement;
      hops++;
    }
  } else {
    for (const n of sizedElements) clear(n);
    sizedElements.clear();
  }
}

every(1500, applyPlayerSizing);

function buildCss() {
  const rules = [];

  if (IS_TOP) {
    // theater / tamaño del player: lo maneja applyPlayerSizing() en JS
    if (settings.hideScrollbar) {
      rules.push('html{scrollbar-width:none !important;}');
      rules.push('html::-webkit-scrollbar{display:none !important;}');
    }
  }

  // Reglas del player (player Bitmovin/katamari actual, en la página principal;
  // se conservan fallbacks genéricos por si vuelve el iframe Vilos)
  if (getVideo() || !IS_TOP) {
    if (settings.hideDim) {
      // Gradientes de oscurecimiento arriba/abajo del player
      rules.push('[data-testid="top-gradient"]{display:none !important;}');
      rules.push('[data-testid="player-controls-root"] [class*="bg-gradient"]{background:none !important;}');
      rules.push('[class*="dim" i]{opacity:0 !important;}');
    }
    if (settings.hideSubs) {
      // Los subtítulos se renderizan en un div inline-styled con text-shadow
      rules.push('#player-container div[style*="text-shadow"]{display:none !important;}');
      rules.push('.libassjs-canvas-parent,canvas[class*="libass" i]{display:none !important;}');
    }
    if (settings.hideBigPlay) {
      rules.push('[class*="big-play" i],[data-testid*="bigPlay" i]{opacity:0 !important;pointer-events:none !important;}');
    }
    if (settings.hidePlayerUi) {
      rules.push('[data-testid="top-controls-autohide"],[data-testid="bottom-controls-autohide"],[data-testid="top-gradient"]{display:none !important;}');
      rules.push('[class*="control-bar" i],[class*="controlbar" i]{opacity:0 !important;}');
    }
    if (settings.hideBanner) {
      rules.push('.banner-wrapper{display:none !important;}');
      rules.push('[class*="upnext" i],[class*="up-next" i]{display:none !important;}');
    }
    if (settings.blurPreview) {
      // Trickplay = miniatura de preview al pasar el mouse por la timeline
      rules.push('img[data-testid="trickplay-image"]{filter:blur(12px) !important;}');
    }

    // Theater / tamaño del player (estructura actual: .video-player-wrapper
    // con un spacer que fuerza el aspect-ratio 16:9)
    if (settings.theater) {
      rules.push('.video-player-wrapper{position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:2147483000 !important;background:#000 !important;}');
      rules.push('.video-player-spacer{display:none !important;}');
      rules.push('html,body{overflow:hidden !important;}');
    } else if (settings.playerSize === 'grande') {
      rules.push('.video-player-wrapper{height:80vh !important;}');
      rules.push('.video-player-spacer{display:none !important;}');
    } else if (settings.playerSize === 'XL') {
      rules.push('.video-player-wrapper{height:92vh !important;}');
      rules.push('.video-player-spacer{display:none !important;}');
    }
  }

  return rules.join('\n');
}

let styleEl = null;
function applyCss() {
  const css = buildCss();
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'cras-style';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  if (styleEl.textContent !== css) styleEl.textContent = css;
}

// ============================================================
// AUTO-SKIP (click en botones nativos)
// ============================================================
const clickedRecently = new WeakSet();

function isVideoEnding() {
  const video = getVideo();
  if (!video || !isFinite(video.duration) || video.duration === 0) return false;
  return video.ended || video.duration - video.currentTime < 12;
}

function tryClickSkipButtons(root) {
  const candidates = root.querySelectorAll(
    'button, [role="button"], [data-testid*="skip" i], [class*="skip" i]'
  );

  for (const el of candidates) {
    if (clickedRecently.has(el)) continue;

    const text = (el.textContent || '').trim();
    if (!text || text.length > 40) continue;

    // El player nuevo premonta los botones de skip invisibles (opacity-0,
    // aria-hidden). Clickearlos antes de tiempo saltaría contenido incorrecto.
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;

    const isIntro = matchesAny(text, INTRO_PATTERNS);
    const isEnding = matchesAny(text, ENDING_PATTERNS);
    const isRecap = matchesAny(text, RECAP_PATTERNS);
    const isNext = matchesAny(text, NEXT_PATTERNS);

    const shouldClick =
      (isIntro && settings.skipIntro) ||
      (isEnding && settings.skipEnding) ||
      (isRecap && settings.skipRecap) ||
      (isNext && settings.autoNext && isVideoEnding());

    if (shouldClick) {
      clickedRecently.add(el);
      el.click();
      console.debug('[Tsuki] Click en:', text);
    }
  }
}

const observer = new MutationObserver(() => {
  tryClickSkipButtons(document);
  applyCss(); // re-asegurar el <style> si Crunchyroll reescribe el <head>
});
observer.observe(document.documentElement, { childList: true, subtree: true });
every(1500, () => tryClickSkipButtons(document));

// ============================================================
// SKIP POR SEEK (determinístico, no depende del botón nativo)
// Los tiempos vienen del endpoint de skip-events vía background.
// ============================================================
let localSkipEvents = null;
let skipEventsFor = null;
const skippedZones = new Set(); // permite re-ver una zona si el usuario rebobina a propósito

every(3000, () => {
  const id = lastPageInfo?.mediaId;
  if (!id || !getVideo()) return;
  if (id !== skipEventsFor) {
    localSkipEvents = null;
    skippedZones.clear();
    skipEventsFor = id;
  }
  if (localSkipEvents) return;
  try {
    chrome.runtime.sendMessage({ type: 'getSkipEvents', mediaId: id }, (events) => {
      if (chrome.runtime.lastError) return;
      if (skipEventsFor === id && events) {
        localSkipEvents = events;
        console.debug('[Tsuki] skip-events cargados:', Object.keys(events).join(', '));
      }
    });
  } catch (e) {}
});

function autoSeekSkip(video) {
  if (!localSkipEvents || video.paused) return;
  const t = video.currentTime;
  const zones = [
    ['intro', settings.skipIntro],
    ['recap', settings.skipRecap],
    ['credits', settings.skipEnding],
  ];
  for (const [name, enabled] of zones) {
    const ev = localSkipEvents[name];
    const key = skipEventsFor + ':' + name;
    if (enabled && ev && t >= ev.start + 0.3 && t < ev.end - 1 && !skippedZones.has(key)) {
      skippedZones.add(key); // solo auto-salta una vez: rebobinar manualmente permite verla
      video.currentTime = ev.end;
      console.debug('[Tsuki] seek-skip:', name, '→', ev.end + 's');
      return;
    }
  }
}

// Al volver a la pestaña (los timers estuvieron throttleados), chequear de inmediato
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const video = getVideo();
  if (video) autoSeekSkip(video);
  tryClickSkipButtons(document);
});

// ============================================================
// REPORTE DE ESTADO DEL VIDEO (frame del player)
// ============================================================
let loggedFrame = false;
every(1000, () => {
  const video = getVideo();
  if (!video) return;
  autoSeekSkip(video);
  if (!loggedFrame) {
    loggedFrame = true;
    console.info(
      '[Tsuki] video detectado en frame:',
      IS_TOP ? 'PÁGINA PRINCIPAL (sin iframe)' : 'IFRAME: ' + location.hostname
    );
  }
  safeSend({
    type: 'videoState',
    data: {
      currentTime: video.currentTime || 0,
      duration: isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      playbackRate: video.playbackRate,
      pip: !!document.pictureInPictureElement,
    },
  });
});

// ============================================================
// SCRAPING DE PÁGINA (solo frame principal)
// ============================================================
let lastPageInfo = null;

function findEpisodeLink(patterns) {
  const anchors = document.querySelectorAll('a[href*="/watch/"], [data-t]');
  for (const el of anchors) {
    const meta = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-t') || '',
      (el.textContent || '').trim().slice(0, 60),
    ].join(' | ');
    if (matchesAny(meta, patterns)) {
      const href = el.href || el.closest('a[href*="/watch/"]')?.href;
      if (href && href.includes('/watch/') && href !== location.href) return href;
    }
  }
  return null;
}

function scrapePageInfo() {
  if (!location.pathname.includes('/watch/')) return null;

  const info = { url: location.href };

  const idMatch = location.pathname.match(/\/watch\/([A-Z0-9]+)/i);
  if (idMatch) info.mediaId = idMatch[1];

  const h1 = document.querySelector('h1.title, h1');
  if (h1) info.episodeTitle = h1.textContent.trim();

  const showLink =
    document.querySelector('a[data-t="show-title-link"]') ||
    document.querySelector('a[href*="/series/"]');
  if (showLink && showLink.textContent.trim()) {
    info.seriesTitle = showLink.textContent.trim();
  }

  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage?.content) info.thumbnail = ogImage.content;

  // Selectores exactos de la página de watch actual, con fallback por texto
  info.nextUrl =
    document.querySelector('[data-t="next-episode"] a[href*="/watch/"]')?.href ||
    findEpisodeLink(NEXT_PATTERNS);
  info.prevUrl =
    document.querySelector('[data-t="prev-episode"] a[href*="/watch/"]')?.href ||
    findEpisodeLink(PREV_PATTERNS);

  return info;
}

if (IS_TOP) {
  every(2000, () => {
    const info = scrapePageInfo();
    if (info) {
      lastPageInfo = info;
      safeSend({ type: 'pageState', data: info });
    }
  });
}

// ============================================================
// COMANDOS DESDE EL POPUP
// ============================================================
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'command') return;

  const video = getVideo();

  switch (msg.action) {
    case 'playPause':
      if (video) video.paused ? video.play() : video.pause();
      break;
    case 'seek':
      if (video) video.currentTime = Math.max(0, video.currentTime + msg.delta);
      break;
    case 'seekTo':
      if (video && isFinite(msg.time)) video.currentTime = Math.max(0, msg.time);
      break;
    case 'setSpeed':
      if (video) video.playbackRate = msg.rate;
      break;
    case 'togglePip':
      if (video) {
        // Crunchyroll bloquea PiP con este atributo; se lo quitamos
        video.removeAttribute('disablepictureinpicture');
        video.disablePictureInPicture = false;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else {
          video.requestPictureInPicture().catch(() => {});
        }
      }
      break;
    case 'goToUrl':
      if (IS_TOP && msg.url) location.href = msg.url;
      break;
  }
});

// ============================================================
// ATAJOS DE TECLADO
// ============================================================
const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function stepSpeed(video, dir) {
  const current = video.playbackRate;
  let idx = SPEED_STEPS.findIndex((s) => Math.abs(s - current) < 0.01);
  if (idx === -1) idx = 1; // 1x
  idx = Math.min(SPEED_STEPS.length - 1, Math.max(0, idx + dir));
  video.playbackRate = SPEED_STEPS[idx];
}

document.addEventListener(
  'keydown',
  (e) => {
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    // Deshabilitar NumPad (frame del player, evita seeks accidentales)
    if (settings.disableNumpad && e.code.startsWith('Numpad')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const video = getVideo();

    if (video) {
      // Seek: S = +90s, Alt+S = −90s
      if (settings.kbSeek && e.key.toLowerCase() === 's') {
        video.currentTime = Math.max(0, video.currentTime + (e.altKey ? -90 : 90));
        return;
      }
      // Velocidad: + / −
      if (settings.kbSpeed && (e.key === '+' || e.key === '=')) {
        stepSpeed(video, 1);
        return;
      }
      if (settings.kbSpeed && e.key === '-') {
        stepSpeed(video, -1);
        return;
      }
    }

    // Next/prev episodio: N / P (frame principal, usa links scrapeados)
    if (IS_TOP && settings.kbNextPrev && lastPageInfo) {
      if (e.key.toLowerCase() === 'n' && lastPageInfo.nextUrl) {
        location.href = lastPageInfo.nextUrl;
      } else if (e.key.toLowerCase() === 'p' && lastPageInfo.prevUrl) {
        location.href = lastPageInfo.prevUrl;
      }
    }
  },
  true
);

// ============================================================
// MAXIMIZAR CON DOBLE CLICK (frame del player → fullscreen real)
// ============================================================
document.addEventListener('dblclick', (e) => {
  if (!settings.dblClickMax) return;
  const video = getVideo();
  if (!video) return;

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }

  if (IS_TOP) {
    // Video en la página principal: fullscreen del wrapper del player,
    // solo si el doble click cayó dentro de él
    const wrapper = findPlayerWrapper(video);
    if (wrapper.contains(e.target)) {
      wrapper.requestFullscreen().catch(() => {});
    }
  } else {
    // Video en iframe: todo el frame es el player
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

// ============================================================
// BOTÓN +90s INYECTADO EN EL PLAYER
// Intenta insertarse en la barra de controles nativa; si no la
// encuentra, cae a un botón flotante que aparece con el mouse.
// ============================================================
let playerBtn = null;

function makePlayerButton(inline) {
  const btn = document.createElement('button');
  btn.id = 'cras-plus90';
  btn.textContent = '+90s';
  btn.title = 'Adelantar 90s (saltar opening)';
  const base = 'font-family:system-ui,sans-serif;font-size:12px;font-weight:700;'
    + 'color:#F47521;background:rgba(20,20,20,.55);border:1px solid rgba(244,117,33,.55);'
    + 'border-radius:6px;padding:4px 9px;cursor:pointer;line-height:1;';
  btn.style.cssText = inline
    ? base + 'margin:0 6px;align-self:center;'
    : base + 'position:absolute;right:16px;bottom:64px;z-index:2147483000;'
      + 'opacity:0;transition:opacity .25s;pointer-events:none;';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const video = getVideo();
    if (video) video.currentTime = Math.max(0, video.currentTime + 90);
  });
  return btn;
}

function findControlBar() {
  // Heurística: elemento con el texto de tiempo "21:08 / 23:40" y de ahí
  // subir hasta una barra ancha y baja (la barra de controles).
  const timeRe = /^\s*\d{1,2}:\d{2}(:\d{2})?\s*\/\s*\d{1,2}:\d{2}(:\d{2})?\s*$/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let timeEl = null;
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.childElementCount === 0 && timeRe.test(el.textContent || '')) {
      timeEl = el;
      break;
    }
  }
  if (!timeEl) return null;

  const video = getVideo();
  const refWidth = video ? video.getBoundingClientRect().width : window.innerWidth;
  let node = timeEl.parentElement;
  while (node && node !== document.body) {
    const r = node.getBoundingClientRect();
    if (r.width > refWidth * 0.7 && r.height < 120) return node;
    node = node.parentElement;
  }
  return null;
}


// ============================================================
// MINI-PANEL DE LA EXTENSIÓN DENTRO DEL PLAYER
// ============================================================
let panelEl = null;

const PANEL_I18N = {
  es: {
    skipIntro: 'Saltar intro', skipEnding: 'Saltar ending', skipRecap: 'Saltar recap',
    autoNext: 'Auto siguiente ep.', theater: 'Theater mode',
    watched: '✓ Visto', footer: 'Ajustes completos: ícono de la extensión en la barra de Chrome',
    btnTitle: 'Adelantar 90s (saltar opening)',
  },
  en: {
    skipIntro: 'Skip intro', skipEnding: 'Skip ending', skipRecap: 'Skip recap',
    autoNext: 'Auto next ep.', theater: 'Theater mode',
    watched: '✓ Watched', footer: 'Full settings: extension icon in the Chrome toolbar',
    btnTitle: 'Forward 90s (skip opening)',
  },
};

function panelLang() {
  if (settings.language === 'es' || settings.language === 'en') return settings.language;
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}
function pt(key) { return PANEL_I18N[panelLang()][key]; }

const PANEL_TOGGLES = ['skipIntro', 'skipEnding', 'skipRecap', 'autoNext', 'theater'];

function closePlayerPanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
    document.removeEventListener('click', onDocClickClosePanel, true);
  }
}

function onDocClickClosePanel(e) {
  if (!panelEl) return;
  if (panelEl.contains(e.target)) return;
  // closest() cubre el click sobre el <img> interno del botón
  if (e.target.closest && e.target.closest('#cras-menu-btn')) return;
  closePlayerPanel();
}

function panelSwitchHtml(key) {
  const on = settings[key];
  return '<span class="cras-sw' + (on ? ' on' : '') + '" data-set="' + key + '">' +
    '<span class="cras-knob"></span></span>';
}

function renderPanelSpeeds() {
  const v = getVideo();
  const rate = v ? v.playbackRate : 1;
  return [1, 1.25, 1.5, 2].map((r) =>
    '<button class="cras-pill' + (Math.abs(r - rate) < 0.01 ? ' active' : '') + '" data-rate="' + r + '">' + r + 'x</button>'
  ).join('');
}

function togglePlayerPanel(holder) {
  if (panelEl) return closePlayerPanel();

  panelEl = document.createElement('div');
  panelEl.id = 'cras-panel';
  panelEl.innerHTML = `
    <style>
      #cras-panel {
        position: absolute; bottom: 74px; right: 0; width: 232px;
        background: #141414; border: 1px solid #2c2c2c; border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,.6); padding: 12px;
        font-family: system-ui, sans-serif; color: #e8e6e3; z-index: 2147483001;
        display: flex; flex-direction: column; gap: 10px; text-align: left;
        cursor: default; font-size: 12px; line-height: 1.35;
      }
      #cras-panel * { box-sizing: border-box; font-family: inherit; }
      #cras-panel .cras-head { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 12px; }
      #cras-panel .cras-head svg { flex: none; }
      #cras-panel .cras-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
      #cras-panel .cras-grid button, #cras-panel .cras-wide {
        height: 32px; border-radius: 7px; border: 1px solid #2c2c2c; background: #1d1d1d;
        color: #e8e6e3; font-size: 11px; font-weight: 700; cursor: pointer;
      }
      #cras-panel .cras-grid button:hover, #cras-panel .cras-wide:hover { background: #262626; }
      #cras-panel .cras-accent { border-color: rgba(244,117,33,.5) !important; color: #F47521 !important; background: rgba(244,117,33,.1) !important; }
      #cras-panel .cras-speeds { display: flex; gap: 4px; }
      #cras-panel .cras-pill {
        flex: 1; padding: 5px 0; border-radius: 999px; border: 1px solid #2c2c2c;
        background: #1d1d1d; color: #a09c96; font-size: 10.5px; font-weight: 600; cursor: pointer;
      }
      #cras-panel .cras-pill.active { background: #F47521; border-color: #F47521; color: #141414; }
      #cras-panel .cras-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 0; }
      #cras-panel .cras-sw {
        width: 32px; height: 18px; border-radius: 999px; background: #3a3a3a;
        position: relative; cursor: pointer; flex: none; transition: background .15s; display: inline-block;
      }
      #cras-panel .cras-sw.on { background: #F47521; }
      #cras-panel .cras-knob {
        position: absolute; top: 2.5px; left: 3px; width: 13px; height: 13px; border-radius: 50%;
        background: #fff; transition: transform .15s; display: block;
      }
      #cras-panel .cras-sw.on .cras-knob { transform: translateX(13px); }
      #cras-panel .cras-foot { font-size: 9.5px; color: #6d6a66; text-align: center; }
      #cras-panel hr { border: none; border-top: 1px solid #262626; margin: 0; }
    </style>
    <div class="cras-head">
      <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" style="width:16px;height:16px;border-radius:4px;display:block;" />
      Tsuki
    </div>
    <div class="cras-grid">
      <button data-act="seek" data-delta="-10">−10s</button>
      <button data-act="play">⏯</button>
      <button data-act="seek" data-delta="10">+10s</button>
      <button data-act="seek" data-delta="90" class="cras-accent">+90s</button>
    </div>
    <div class="cras-speeds">${renderPanelSpeeds()}</div>
    <hr />
    ${PANEL_TOGGLES.map((key) =>
      '<div class="cras-row"><span>' + pt(key) + '</span>' + panelSwitchHtml(key) + '</div>'
    ).join('')}
    <hr />
    <div class="cras-grid" style="grid-template-columns: 1fr 1fr;">
      <button data-act="pip">PiP</button>
      <button data-act="watched">${pt('watched')}</button>
    </div>
    <div class="cras-foot">${pt('footer')}</div>
  `;

  panelEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const video = getVideo();
    const sw = e.target.closest('.cras-sw');
    if (sw) {
      const key = sw.dataset.set;
      const newVal = !settings[key];
      settings[key] = newVal;
      try { chrome.storage.sync.set({ [key]: newVal }); } catch (err) {}
      sw.classList.toggle('on', newVal);
      applyCss();
      applyPlayerSizing();
      return;
    }
    const pill = e.target.closest('.cras-pill');
    if (pill && video) {
      video.playbackRate = parseFloat(pill.dataset.rate);
      panelEl.querySelectorAll('.cras-pill').forEach((p) =>
        p.classList.toggle('active', p === pill)
      );
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || !video) return;
    switch (btn.dataset.act) {
      case 'seek':
        video.currentTime = Math.max(0, video.currentTime + parseFloat(btn.dataset.delta));
        break;
      case 'play':
        video.paused ? video.play() : video.pause();
        break;
      case 'pip':
        video.removeAttribute('disablepictureinpicture');
        video.disablePictureInPicture = false;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else {
          video.requestPictureInPicture().catch(() => {});
        }
        break;
      case 'watched':
        if (isFinite(video.duration) && video.duration > 3) {
          video.currentTime = video.duration - 3;
        }
        break;
    }
  });

  holder.appendChild(panelEl);
  setTimeout(() => document.addEventListener('click', onDocClickClosePanel, true), 0);
}

function ensurePlayerButton() {
  const video = getVideo();
  if (!video) return;

  if (!settings.playerButton) {
    if (playerBtn) { playerBtn.remove(); playerBtn = null; }
    closePlayerPanel();
    return;
  }
  if (playerBtn && playerBtn.isConnected) return;

  // Player actual: botón de la extensión en el stack derecho que despliega
  // un mini-panel con las funciones principales (estilo menú nativo de CR)
  const stack = document.querySelector('[data-testid="bottom-right-controls-stack"]');
  if (stack) {
    const sibling = stack.querySelector('button');
    const holder = document.createElement('div');
    holder.className = 'kat:relative';
    holder.style.position = 'relative';

    playerBtn = document.createElement('button');
    playerBtn.id = 'cras-menu-btn';
    playerBtn.type = 'button';
    playerBtn.setAttribute('aria-label', 'Tsuki');
    playerBtn.setAttribute('aria-haspopup', 'menu');
    playerBtn.title = 'Tsuki';
    if (sibling) playerBtn.className = sibling.className; // look nativo
    const logoUrl = chrome.runtime.getURL('icons/icon48.png');
    playerBtn.innerHTML =
      '<img src="' + logoUrl + '" alt="" style="width:26px;height:26px;display:block;border-radius:6px;" />';
    playerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayerPanel(holder);
    });

    holder.appendChild(playerBtn);
    stack.insertBefore(holder, stack.firstChild);
    return;
  }

  const bar = findControlBar();
  if (bar) {
    playerBtn = makePlayerButton(true);
    // Insertar en el cluster derecho de la barra (último hijo con elementos)
    const rightCluster = bar.lastElementChild || bar;
    rightCluster.insertBefore(playerBtn, rightCluster.firstChild);
  } else {
    // Fallback: flotante sobre el player, visible al mover el mouse
    playerBtn = makePlayerButton(false);
    let host = document.body || document.documentElement;
    if (IS_TOP) {
      host = findPlayerWrapper(video);
      if (getComputedStyle(host).position === 'static') {
        host.style.setProperty('position', 'relative');
      }
    }
    host.appendChild(playerBtn);
    let hideTimer = null;
    document.addEventListener('mousemove', () => {
      if (!playerBtn) return;
      playerBtn.style.opacity = '1';
      playerBtn.style.pointerEvents = 'auto';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!playerBtn) return;
        playerBtn.style.opacity = '0';
        playerBtn.style.pointerEvents = 'none';
      }, 2500);
    });
  }
}

every(2000, ensurePlayerButton);
