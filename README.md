<p align="center"><img src="extension/icons/icon128.png" width="96" alt="Tsuki" /></p>

# Tsuki 🌙 — Auto Skip & Player Tools for Crunchyroll

Extensión no oficial que mejora Crunchyroll: salta intros, endings y recaps
automáticamente (usando los marcadores reales de cada episodio), auto-siguiente
episodio, panel de control dentro del player, theater mode, Picture-in-Picture,
control de velocidad, atajos, modo anti-spoiler, sincronización con **AniList**
y **Discord Rich Presence**.

> Unofficial extension. Not affiliated with Crunchyroll LLC.

## Componentes

| Carpeta      | Qué es                                                          |
|--------------|-----------------------------------------------------------------|
| `extension/` | Extensión de Chrome (Manifest V3, ES/EN)                        |
| `bridge/`    | Tsuki Bridge: companion en Go para Discord Rich Presence        |
| `setup/`     | Tsuki Setup: instalador desktop nativo (Win32, un solo .exe)    |

## Instalación (usuarios)

- **Extensión**: Chrome Web Store *(link pendiente de publicación)*.
- **Discord Rich Presence (opcional)**: descarga `tsuki-setup.zip` desde
  [Releases](../../releases/latest), extrae y ejecuta `tsuki-setup.exe`.
  Instalación de un click; Chrome gestiona el bridge automáticamente.

## Compilar desde fuente

Requiere Go 1.22+. El setup embebe el bridge, así que el orden importa:

```bash
./scripts/build.sh        # linux/mac (cross-compila para Windows)
scripts\build.bat         # windows
```

Artefactos: `dist/tsuki-setup.exe`, `dist/tsuki-bridge.exe`,
`dist/tsuki-extension.zip`.

## Versionado

Tags `vX.Y.Z` a nivel de producto (la extensión marca la versión). Cada tag
dispara el workflow de release que compila y publica los artefactos.
Ver [CHANGELOG.md](CHANGELOG.md).

## Licencia

[MIT](LICENSE)
