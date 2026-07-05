// Popup v3 — dashboard + ajustes completos

// Instalador del bridge (tsuki-setup.exe) en GitHub Releases
const BRIDGE_DOWNLOAD_URL = 'https://github.com/IsmaLD/Tsuki-Crunchyroll/releases/latest/download/tsuki-setup.exe';

const DEFAULTS = {
  skipIntro: true, skipEnding: true, skipRecap: true, autoNext: true,
  theater: false, playerSize: 'normal', dblClickMax: true,
  hideDim: false, hideSubs: false, hideBigPlay: false, hidePlayerUi: false,
  hideBanner: false, hideScrollbar: false, blurPreview: false,
  playerButton: true,
  kbSeek: true, kbSpeed: true, kbNextPrev: true, disableNumpad: false,
  anilistSync: false, anilistClientId: '',
  discordPresence: false, discordDiscreet: false,
  language: 'auto',
};

const SECTIONS = [
  { titleKey: 'secSkip', items: [
    { key: 'skipIntro' }, { key: 'skipEnding' }, { key: 'skipRecap' }, { key: 'autoNext' },
  ]},
  { titleKey: 'secPlayer', items: [
    { key: 'theater' },
    { key: 'playerSize', select: ['normal', 'grande', 'XL'] },
    { key: 'dblClickMax' }, { key: 'hideDim' }, { key: 'hideSubs' },
    { key: 'hideBigPlay' }, { key: 'hidePlayerUi' }, { key: 'hideBanner' },
    { key: 'hideScrollbar' }, { key: 'blurPreview' }, { key: 'playerButton' },
  ]},
  { titleKey: 'secKeys', items: [
    { key: 'kbSeek' }, { key: 'kbSpeed' }, { key: 'kbNextPrev' }, { key: 'disableNumpad' },
  ]},
];


// ============================================================
// I18N (es / en)
// ============================================================
const I18N = {
  es: {
    tabNow: 'Ahora', tabSettings: 'Ajustes',
    statusOn: 'Detectando video', statusOff: 'Inactivo',
    emptyTitle: 'No hay un episodio reproduciéndose',
    emptySub: 'Abre un episodio en Crunchyroll y los controles aparecerán aquí.',
    legend: 'zonas de auto-skip', noNext: 'Último episodio disponible',
    speed: 'Velocidad', pipOn: 'Salir de Picture-in-Picture', pipOff: 'Picture-in-Picture',
    watched: '✓ Marcar episodio como visto',
    skipping: (z) => `Saltando ${z}…`,
    nextSkip: (z, t) => `Próximo salto: ${z} en ${t}`,
    airing: (ep, date, rel) => `E${ep} sale el ${date} · en ${rel}`,
    secSkip: 'Auto-skip', secPlayer: 'Player', secKeys: 'Atajos de teclado',
    secIntegr: 'Integraciones', secConfig: 'Configuración',
    language: 'Idioma',
    exportCfg: 'Exportar configuración', importCfg: 'Importar configuración',
    resetCfg: 'Restablecer todo', resetConfirm: '¿Restablecer toda la configuración a los valores por defecto?',
    invalidCfg: 'Archivo de configuración inválido',
    alCreate: 'Cliente propio (opcional):', alStatusOn: '● Conectado', alStatusOff: '○ No conectado',
    alConnect: 'Conectar con AniList', alDisconnect: 'Desconectar',
    alSync: 'Sync automático de progreso', alSyncDesc: 'Actualiza tu lista de AniList al llegar al 85% del episodio',
    dcLabel: 'Discord Rich Presence', dcReq: 'Requiere Tsuki Bridge corriendo en tu PC',
    dcOn: '● Tsuki Bridge conectado', dcOff: '○ Tsuki Bridge no detectado',
    dcDownload: '⬇ Descargar Tsuki Bridge (instalación de un click)',
    dscLabel: 'Modo discreto', dscDesc: 'Muestra "Viendo anime" sin revelar serie ni episodio',
    s_skipIntro: ['Saltar intro', ''], s_skipEnding: ['Saltar ending / créditos', ''],
    s_skipRecap: ['Saltar recap', ''], s_autoNext: ['Auto siguiente episodio', ''],
    s_theater: ['Theater mode', 'El player ocupa toda la ventana'],
    s_playerSize: ['Agrandar player', ''], s_dblClickMax: ['Maximizar con doble click', ''],
    s_hideDim: ['Ocultar pantalla oscurecida (dim)', ''], s_hideSubs: ['Ocultar subtítulos', ''],
    s_hideBigPlay: ['Ocultar botón play/pause gigante', ''], s_hidePlayerUi: ['Ocultar UI del player', ''],
    s_hideBanner: ['Ocultar banner tras el último episodio', ''], s_hideScrollbar: ['Ocultar scrollbar', ''],
    s_blurPreview: ['Difuminar miniatura de preview', 'Anti-spoiler en la barra de progreso'],
    s_playerButton: ['Panel en el player', 'Botón en la barra de Crunchyroll con menú de la extensión'],
    s_kbSeek: ['Atajos de seek', 'S = +90s · Alt+S = −90s'],
    s_kbSpeed: ['Atajos de velocidad', '+ / − para cambiar velocidad'],
    s_kbNextPrev: ['Atajos next / prev episodio', 'N = siguiente · P = anterior'],
    s_disableNumpad: ['Deshabilitar NumPad', ''],
  },
  en: {
    tabNow: 'Now', tabSettings: 'Settings',
    statusOn: 'Video detected', statusOff: 'Idle',
    emptyTitle: 'No episode playing',
    emptySub: 'Open an episode on Crunchyroll and the controls will appear here.',
    legend: 'auto-skip zones', noNext: 'Last available episode',
    speed: 'Speed', pipOn: 'Exit Picture-in-Picture', pipOff: 'Picture-in-Picture',
    watched: '✓ Mark episode as watched',
    skipping: (z) => `Skipping ${z}…`,
    nextSkip: (z, t) => `Next skip: ${z} in ${t}`,
    airing: (ep, date, rel) => `E${ep} airs ${date} · in ${rel}`,
    secSkip: 'Auto-skip', secPlayer: 'Player', secKeys: 'Keyboard shortcuts',
    secIntegr: 'Integrations', secConfig: 'Settings',
    language: 'Language',
    exportCfg: 'Export settings', importCfg: 'Import settings',
    resetCfg: 'Reset all', resetConfirm: 'Reset all settings to defaults?',
    invalidCfg: 'Invalid settings file',
    alCreate: 'Custom client (optional):', alStatusOn: '● Connected', alStatusOff: '○ Not connected',
    alConnect: 'Connect AniList', alDisconnect: 'Disconnect',
    alSync: 'Auto-sync progress', alSyncDesc: 'Updates your AniList at 85% of the episode',
    dcLabel: 'Discord Rich Presence', dcReq: 'Requires Tsuki Bridge running on your PC',
    dcOn: '● Tsuki Bridge connected', dcOff: '○ Tsuki Bridge not detected',
    dcDownload: '⬇ Download Tsuki Bridge (one-click install)',
    dscLabel: 'Discreet mode', dscDesc: 'Shows "Watching anime" without revealing the series or episode',
    s_skipIntro: ['Skip intro', ''], s_skipEnding: ['Skip ending / credits', ''],
    s_skipRecap: ['Skip recap', ''], s_autoNext: ['Auto next episode', ''],
    s_theater: ['Theater mode', 'Player takes the whole window'],
    s_playerSize: ['Enlarge player', ''], s_dblClickMax: ['Maximize on double click', ''],
    s_hideDim: ['Hide dim overlay', ''], s_hideSubs: ['Hide subtitles', ''],
    s_hideBigPlay: ['Hide giant play/pause button', ''], s_hidePlayerUi: ['Hide player UI', ''],
    s_hideBanner: ['Hide banner after last episode', ''], s_hideScrollbar: ['Hide scrollbar', ''],
    s_blurPreview: ['Blur preview thumbnail', 'Anti-spoiler on the progress bar'],
    s_playerButton: ['In-player panel', 'Button on the Crunchyroll bar with the extension menu'],
    s_kbSeek: ['Seek shortcuts', 'S = +90s · Alt+S = −90s'],
    s_kbSpeed: ['Speed shortcuts', '+ / − to change speed'],
    s_kbNextPrev: ['Next / prev episode shortcuts', 'N = next · P = previous'],
    s_disableNumpad: ['Disable NumPad', ''],
  },
};

function lang() {
  if (settings.language === 'es' || settings.language === 'en') return settings.language;
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}
function t(key) { return I18N[lang()][key]; }

function applyStaticI18n() {
  $('tabNow').textContent = t('tabNow');
  $('tabSettings').textContent = t('tabSettings');
  $('emptyTitle').textContent = t('emptyTitle');
  $('emptySub').textContent = t('emptySub');
  $('legendText').textContent = t('legend');
  $('noNextHint').textContent = t('noNext');
  $('speedLabel').textContent = t('speed');
  $('markWatched').textContent = t('watched');
}

let settings = { ...DEFAULTS };
let activeTabId = null;
let lastState = null;

const $ = (id) => document.getElementById(id);

// ============================================================
// TABS
// ============================================================
function showTab(name) {
  $('tabNow').classList.toggle('active', name === 'now');
  $('tabSettings').classList.toggle('active', name === 'settings');
  $('panelNow').classList.toggle('active', name === 'now');
  $('panelSettings').classList.toggle('active', name === 'settings');
}
$('tabNow').addEventListener('click', () => showTab('now'));
$('tabSettings').addEventListener('click', () => showTab('settings'));

// ============================================================
// AJUSTES (render dinámico desde SECTIONS)
// ============================================================
function setSetting(key, value) {
  settings[key] = value;
  chrome.storage.sync.set({ [key]: value });
  renderSettings();
}

function renderSettings() {
  const wrap = $('settingsWrap');
  wrap.innerHTML = '';

  applyStaticI18n();

  // Selector de idioma
  const langSec = document.createElement('div');
  langSec.className = 'section';
  const langRow = document.createElement('div');
  langRow.className = 'setting-row';
  langRow.innerHTML = `<div class="setting-text"><div class="setting-label">${t('language')}</div></div>`;
  const langOpts = document.createElement('div');
  langOpts.className = 'size-opts';
  for (const opt of ['auto', 'es', 'en']) {
    const btn = document.createElement('button');
    btn.textContent = opt.toUpperCase();
    btn.classList.toggle('active', settings.language === opt);
    btn.addEventListener('click', () => setSetting('language', opt));
    langOpts.appendChild(btn);
  }
  langRow.appendChild(langOpts);
  langSec.appendChild(langRow);
  wrap.appendChild(langSec);

  for (const sec of SECTIONS) {
    const secEl = document.createElement('div');
    secEl.className = 'section';

    const titleEl = document.createElement('div');
    titleEl.className = 'section-title';
    titleEl.textContent = t(sec.titleKey);
    secEl.appendChild(titleEl);

    for (const item of sec.items) {
      const row = document.createElement('div');
      row.className = 'setting-row';

      const text = document.createElement('div');
      text.className = 'setting-text';
      const [labelTxt, descTxt] = t('s_' + item.key);
      const label = document.createElement('div');
      label.className = 'setting-label';
      label.textContent = labelTxt;
      text.appendChild(label);
      if (descTxt) {
        const desc = document.createElement('div');
        desc.className = 'setting-desc';
        desc.textContent = descTxt;
        text.appendChild(desc);
      }
      row.appendChild(text);

      if (item.select) {
        const opts = document.createElement('div');
        opts.className = 'size-opts';
        for (const opt of item.select) {
          const btn = document.createElement('button');
          btn.textContent = opt;
          btn.classList.toggle('active', settings[item.key] === opt);
          btn.addEventListener('click', () => setSetting(item.key, opt));
          opts.appendChild(btn);
        }
        row.appendChild(opts);
      } else {
        const sw = document.createElement('button');
        sw.className = 'switch' + (settings[item.key] ? ' on' : '');
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(!!settings[item.key]));
        const knob = document.createElement('span');
        knob.className = 'knob-s';
        sw.appendChild(knob);
        sw.addEventListener('click', () => setSetting(item.key, !settings[item.key]));
        row.appendChild(sw);
      }

      secEl.appendChild(row);
    }
    wrap.appendChild(secEl);
  }

  // Sección Integraciones (AniList)
  const integr = document.createElement('div');
  integr.className = 'section';
  integr.innerHTML = `
    <div class="section-title">${t('secIntegr')}</div>
    <div class="setting-row" style="border-bottom:none;flex-direction:column;align-items:stretch;gap:0;">
      <div class="setting-label" style="margin-bottom:6px;">AniList</div>
      <div class="integr-status off" id="alStatus">…</div>
      <div class="config-actions" style="margin-top:0;">
        <button id="alConnect">${t('alConnect')}</button>
      </div>
      <div class="integr-note" style="margin-top:8px;">${t('alCreate')}
        <a href="https://anilist.co/settings/developer" target="_blank">anilist.co/settings/developer</a>
        · Redirect URL: <span id="alRedirect">—</span></div>
      <input class="integr-input" id="alClientId" type="text" placeholder="Client ID (default: Tsuki)" />
    </div>
  `;
  wrap.appendChild(integr);

  // Toggle de sync automático (reutiliza el estilo de setting-row)
  const syncRow = document.createElement('div');
  syncRow.className = 'setting-row';
  syncRow.style.margin = '0 16px';
  syncRow.innerHTML = `
    <div class="setting-text">
      <div class="setting-label">${t('alSync')}</div>
      <div class="setting-desc">${t('alSyncDesc')}</div>
    </div>
  `;
  const syncSw = document.createElement('button');
  syncSw.className = 'switch' + (settings.anilistSync ? ' on' : '');
  syncSw.setAttribute('role', 'switch');
  const syncKnob = document.createElement('span');
  syncKnob.className = 'knob-s';
  syncSw.appendChild(syncKnob);
  syncSw.addEventListener('click', () => setSetting('anilistSync', !settings.anilistSync));
  syncRow.appendChild(syncSw);
  integr.appendChild(syncRow);

  const clientInput = integr.querySelector('#alClientId');
  clientInput.value = settings.anilistClientId || '';
  clientInput.addEventListener('change', () => {
    settings.anilistClientId = clientInput.value.trim();
    chrome.storage.sync.set({ anilistClientId: settings.anilistClientId });
  });

  const statusEl = integr.querySelector('#alStatus');
  const connectBtn = integr.querySelector('#alConnect');

  function refreshAlStatus() {
    chrome.runtime.sendMessage({ type: 'anilistStatus' }, (res) => {
      integr.querySelector('#alRedirect').textContent = res?.redirect || '—';
      const connected = !!res?.connected;
      statusEl.textContent = connected ? t('alStatusOn') : t('alStatusOff');
      statusEl.className = 'integr-status ' + (connected ? 'ok' : 'off');
      connectBtn.textContent = connected ? t('alDisconnect') : t('alConnect');
      connectBtn.onclick = () => {
        if (connected) {
          chrome.runtime.sendMessage({ type: 'anilistLogout' }, refreshAlStatus);
        } else {
          chrome.runtime.sendMessage({ type: 'anilistAuth' }, (r) => {
            if (r && !r.ok) alert('AniList: ' + r.error);
            refreshAlStatus();
          });
        }
      };
    });
  }
  refreshAlStatus();

  // --- Discord Rich Presence ---
  const dcRow = document.createElement('div');
  dcRow.className = 'setting-row';
  dcRow.style.margin = '0 16px';
  dcRow.innerHTML = `
    <div class="setting-text">
      <div class="setting-label">${t('dcLabel')}</div>
      <div class="setting-desc" id="dcDesc">${t('dcReq')}</div>
      <a id="dcDownload" href="${BRIDGE_DOWNLOAD_URL}" target="_blank"
         style="display:none; font-size:11px; color:#F47521; text-decoration:none; margin-top:4px;">${t('dcDownload')}</a>
    </div>
  `;
  const dcSw = document.createElement('button');
  dcSw.className = 'switch' + (settings.discordPresence ? ' on' : '');
  dcSw.setAttribute('role', 'switch');
  const dcKnob = document.createElement('span');
  dcKnob.className = 'knob-s';
  dcSw.appendChild(dcKnob);
  dcSw.addEventListener('click', () => setSetting('discordPresence', !settings.discordPresence));
  dcRow.appendChild(dcSw);
  integr.appendChild(dcRow);

  // --- Modo discreto ---
  const dscRow = document.createElement('div');
  dscRow.className = 'setting-row';
  dscRow.style.margin = '0 16px';
  dscRow.innerHTML = `
    <div class="setting-text">
      <div class="setting-label">${t('dscLabel')}</div>
      <div class="setting-desc">${t('dscDesc')}</div>
    </div>
  `;
  const dscSw = document.createElement('button');
  dscSw.className = 'switch' + (settings.discordDiscreet ? ' on' : '');
  dscSw.setAttribute('role', 'switch');
  const dscKnob = document.createElement('span');
  dscKnob.className = 'knob-s';
  dscSw.appendChild(dscKnob);
  dscSw.addEventListener('click', () => setSetting('discordDiscreet', !settings.discordDiscreet));
  dscRow.appendChild(dscSw);
  integr.appendChild(dscRow);

  chrome.runtime.sendMessage({ type: 'bridgePing' }, (res) => {
    const el = document.getElementById('dcDesc');
    if (!el) return;
    const dl = document.getElementById('dcDownload');
    if (res?.disabled) {
      el.textContent = t('dcReq');
      if (dl) dl.style.display = 'none';
      return;
    }
    if (res?.connected) {
      el.textContent = t('dcOn');
      el.style.color = '#2ecc71';
      if (dl) dl.style.display = 'none';
    } else {
      el.textContent = t('dcOff');
      if (dl) dl.style.display = 'block';
    }
  });

  // Sección Configuración
  const cfg = document.createElement('div');
  cfg.className = 'section';
  cfg.innerHTML = `
    <div class="section-title">${t('secConfig')}</div>
    <div class="config-actions">
      <button id="exportCfg">${t('exportCfg')}</button>
      <button id="importCfg">${t('importCfg')}</button>
      <button id="resetCfg" class="danger">${t('resetCfg')}</button>
    </div>
    <div class="version">Tsuki · v${chrome.runtime.getManifest().version}</div>
  `;
  wrap.appendChild(cfg);

  cfg.querySelector('#exportCfg').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tsuki-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  cfg.querySelector('#importCfg').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const clean = {};
        for (const key of Object.keys(DEFAULTS)) {
          if (key in data && typeof data[key] === typeof DEFAULTS[key]) {
            clean[key] = data[key];
          }
        }
        settings = { ...settings, ...clean };
        chrome.storage.sync.set(clean, renderSettings);
      } catch (e) {
        alert(t('invalidCfg'));
      }
    };
    input.click();
  });

  cfg.querySelector('#resetCfg').addEventListener('click', () => {
    if (!confirm(t('resetConfirm'))) return;
    settings = { ...DEFAULTS };
    chrome.storage.sync.set(DEFAULTS, renderSettings);
  });
}

// ============================================================
// DASHBOARD
// ============================================================
function fmt(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function sendCommand(command) {
  if (activeTabId == null) return;
  chrome.runtime.sendMessage({ type: 'command', tabId: activeTabId, ...command });
}

function renderZone(el, event, duration) {
  if (event && duration > 0) {
    el.style.left = (event.start / duration * 100) + '%';
    el.style.width = ((event.end - event.start) / duration * 100) + '%';
    el.style.display = 'block';
    return true;
  }
  el.style.display = 'none';
  return false;
}

function nextSkipLabel(skipEvents, tt) {
  if (!skipEvents) return null;
  const zones = [
    { ev: skipEvents.intro, on: settings.skipIntro, name: 'intro' },
    { ev: skipEvents.recap, on: settings.skipRecap, name: 'recap' },
    { ev: skipEvents.credits, on: settings.skipEnding, name: 'ending' },
  ].filter((z) => z.ev && z.on);

  for (const z of zones) {
    if (tt >= z.ev.start && tt < z.ev.end) return t('skipping')(z.name);
  }
  const upcoming = zones
    .filter((z) => z.ev.start > tt)
    .sort((a, b) => a.ev.start - b.ev.start)[0];
  if (upcoming) return t('nextSkip')(upcoming.name, fmt(upcoming.ev.start - tt));
  return null;
}

function fmtRelative(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function render(state) {
  const fresh = state && Date.now() - state.updatedAt < 6000;
  const hasVideo = fresh && state.video;

  $('statusDot').classList.toggle('on', !!hasVideo);
  $('statusLabel').textContent = hasVideo ? t('statusOn') : t('statusOff');
  $('dashboard').style.display = hasVideo ? 'flex' : 'none';
  $('empty').classList.toggle('show', !hasVideo);
  if (!hasVideo) return;

  const { video, page, skipEvents } = state;

  // Títulos + thumbnail
  const series = page?.seriesTitle || 'Crunchyroll';
  const episode = page?.episodeTitle || '—';
  if (page?.thumbnail) {
    $('thumbWrap').classList.add('has-img');
    $('titlesPlain').classList.remove('show');
    if ($('thumbImg').src !== page.thumbnail) $('thumbImg').src = page.thumbnail;
    $('seriesTitle').textContent = series;
    $('episodeTitle').textContent = episode;
    $('thumbBadge').textContent = fmt(video.duration);
  } else {
    $('thumbWrap').classList.remove('has-img');
    $('titlesPlain').classList.add('show');
    $('seriesTitlePlain').textContent = series;
    $('episodeTitlePlain').textContent = episode;
  }

  // Progreso + zonas de skip
  const pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
  $('fill').style.width = pct + '%';
  $('knob').style.left = pct + '%';
  $('curTime').textContent = fmt(video.currentTime);
  $('durTime').textContent = fmt(video.duration);

  const anyZone = [
    renderZone($('zoneIntro'), skipEvents?.intro, video.duration),
    renderZone($('zoneRecap'), skipEvents?.recap, video.duration),
    renderZone($('zoneCredits'), skipEvents?.credits, video.duration),
  ].some(Boolean);
  $('legend').classList.toggle('show', anyZone);

  const label = nextSkipLabel(skipEvents, video.currentTime);
  $('nextSkip').classList.toggle('show', !!label);
  if (label) $('nextSkipLabel').textContent = label;

  // Controles
  $('playPause').textContent = video.paused ? '▶' : '⏸';
  $('prevEp').disabled = !page?.prevUrl;
  $('nextEp').disabled = !page?.nextUrl;
  $('noNextHint').classList.toggle('show', !page?.nextUrl);

  document.querySelectorAll('#speedOpts button').forEach((btn) => {
    btn.classList.toggle(
      'active',
      Math.abs(parseFloat(btn.dataset.rate) - video.playbackRate) < 0.01
    );
  });

  $('pipBtn').classList.toggle('active', !!video.pip);
  $('pipLabel').textContent = video.pip ? t('pipOn') : t('pipOff');

  // Próximo episodio (AniList)
  const next = state.anilist?.nextAiringEpisode;
  if (next) {
    const date = new Date(next.airingAt * 1000);
    const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('airingLabel').textContent =
      t('airing')(next.episode, dateStr, fmtRelative(next.timeUntilAiring));
    $('airingLink').href = state.anilist.siteUrl || '#';
    $('airing').classList.add('show');
  } else {
    $('airing').classList.remove('show');
  }
}

// ============================================================
// EVENTOS DEL DASHBOARD
// ============================================================
$('playPause').addEventListener('click', () => sendCommand({ action: 'playPause' }));
$('back10').addEventListener('click', () => sendCommand({ action: 'seek', delta: -10 }));
$('fwd10').addEventListener('click', () => sendCommand({ action: 'seek', delta: 10 }));
$('fwd90').addEventListener('click', () => sendCommand({ action: 'seek', delta: 90 }));
$('pipBtn').addEventListener('click', () => sendCommand({ action: 'togglePip' }));
$('markWatched').addEventListener('click', () => {
  const dur = lastState?.video?.duration;
  if (dur) sendCommand({ action: 'seekTo', time: Math.max(0, dur - 3) });
});
$('prevEp').addEventListener('click', () => {
  if (lastState?.page?.prevUrl) sendCommand({ action: 'goToUrl', url: lastState.page.prevUrl });
});
$('nextEp').addEventListener('click', () => {
  if (lastState?.page?.nextUrl) sendCommand({ action: 'goToUrl', url: lastState.page.nextUrl });
});
document.querySelectorAll('#speedOpts button').forEach((btn) => {
  btn.addEventListener('click', () =>
    sendCommand({ action: 'setSpeed', rate: parseFloat(btn.dataset.rate) })
  );
});
$('seekHit').addEventListener('click', (e) => {
  const duration = lastState?.video?.duration;
  if (!duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  sendCommand({ action: 'seekTo', time: frac * duration });
});

// ============================================================
// INIT + POLL
// ============================================================
function poll() {
  if (activeTabId == null) return;
  chrome.runtime.sendMessage({ type: 'getState', tabId: activeTabId }, (state) => {
    lastState = state;
    render(state);
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  renderSettings();
  applyStaticI18n();
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (tab && tab.url && tab.url.includes('crunchyroll.com')) {
    activeTabId = tab.id;
    poll();
    setInterval(poll, 1000);
  }
});
