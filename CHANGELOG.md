# Changelog

## v1.0.0 — Primera versión pública 🌙

**Extensión (Chrome, Manifest V3, ES/EN):**
- Auto-skip de intros, endings y recaps por seek directo con los marcadores
  reales de cada episodio (skip-events), con click al botón nativo como
  fallback. Inmune al throttling de pestañas en background.
- Auto-siguiente episodio con guard de fin de video.
- Panel de la extensión dentro del player de Crunchyroll (menú nativo-style):
  transporte, velocidad, toggles rápidos, PiP, marcar visto.
- Popup con dashboard: serie, episodio, thumbnail, barra con zonas de skip,
  próximo salto, prev/next, ±10s/+90s, velocidad, Picture-in-Picture
  (desbloqueado), marcar como visto, fecha del próximo episodio.
- Theater mode, tamaños de player, maximizar con doble click, ocultar
  dim/subtítulos/UI/banner/scrollbar, blur anti-spoiler del preview.
- Atajos: S/Alt+S (±90s), +/− (velocidad), N/P (episodios), NumPad off.
- AniList: fecha de emisión y sync automático de progreso (OAuth, client ID
  por defecto embebido — cero configuración).
- Discord Rich Presence vía Tsuki Bridge: modo normal (serie, episodio,
  carátula, tiempo, badge con velocidad, botones "Ver E{n} conmigo" /
  "Consigue Tsuki gratis") y modo discreto ("Viendo anime").
- Export/import/reset de configuración. Idioma AUTO/ES/EN.

**Tsuki Bridge (Go, cero dependencias):**
- Rich Presence por IPC de Discord; native messaging (Chrome lo lanza y
  apaga solo, solo con el toggle activado) + modo HTTP manual.
- Ícono de bandeja efímero con estado y menú (existe solo mientras ves anime).
- Auto-clear, reconexión, diagnóstico en log, i18n ES/EN.

**Tsuki Setup (instalador desktop nativo Win32):**
- Un solo .exe con el bridge embebido. Ventana borderless con barra propia
  (drag nativo, minimizar/cerrar), ES/EN, esquinas redondeadas en Win11.
- Checklist con sprites antialiased y throbber, double buffering (sin
  flicker), hover animado en todos los controles.
- Instalar / Reparar / Desinstalar con confirmación, todo in-window.
- Registro para Chrome y Edge, sin permisos de administrador, sin consolas.
