// Tsuki Bridge — Discord Rich Presence para Crunchyroll Tsuki
//
// Recibe el estado del episodio desde la extensión (HTTP en localhost)
// y lo publica como actividad en Discord vía IPC (named pipe / unix socket).
// Cero dependencias externas: el protocolo IPC de Discord se implementa a mano.
//
// Uso:
//
//	tsuki-bridge -app-id TU_APPLICATION_ID
//	(o crea tsuki-bridge.json junto al ejecutable: {"app_id": "...", "port": 21387})
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ============================================================
// Config
// ============================================================

type Config struct {
	AppID      string `json:"app_id"`
	Port       int    `json:"port"`
	InstallURL string `json:"install_url"`
}

const defaultInstallURL = "https://chromewebstore.google.com/detail/dpojkngmcgoahbckceihellefaimkabd"

// Application ID de la app "Tsuki Crunchyroll" en Discord (compartida por
// todos los usuarios, igual que hace PreMiD). Sobreescribible por config.
const defaultDiscordAppID = "1523354378399125554"

func loadConfig(nativeMode bool) Config {
	cfg := Config{Port: 21387, InstallURL: defaultInstallURL, AppID: defaultDiscordAppID}

	// 1. Archivo junto al ejecutable
	if exe, err := os.Executable(); err == nil {
		path := filepath.Join(filepath.Dir(exe), "tsuki-bridge.json")
		if data, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(data, &cfg)
		}
	}

	// 2. Flags (pisan al archivo). En native mode Chrome pasa el origin como
	// argumento posicional; flag.Parse lo ignora al no ser -flag.
	appID := flag.String("app-id", "", "Discord Application ID")
	port := flag.Int("port", 0, "Puerto HTTP local (default 21387)")
	flag.CommandLine.SetOutput(io.Discard)
	_ = flag.CommandLine.Parse(nil)
	for i, a := range os.Args[1:] {
		if a == "-app-id" && i+2 <= len(os.Args[1:]) {
			*appID = os.Args[i+2]
		}
		if a == "-port" && i+2 <= len(os.Args[1:]) {
			fmt.Sscanf(os.Args[i+2], "%d", port)
		}
	}
	if *appID != "" {
		cfg.AppID = *appID
	}
	if *port != 0 {
		cfg.Port = *port
	}

	if cfg.AppID == "" {
		if nativeMode {
			// stdout es el canal del protocolo con Chrome: jamás imprimir ahí.
			log.Fatal("Falta app_id en tsuki-bridge.json (junto al ejecutable)")
		}
		fmt.Println("Falta el Application ID de Discord.")
		fmt.Println()
		fmt.Println("  1. Ve a https://discord.com/developers/applications")
		fmt.Println("  2. New Application → nombre \"Crunchyroll\" (así se lee tu actividad)")
		fmt.Println("  3. Copia el APPLICATION ID y ejecuta:")
		fmt.Println()
		fmt.Println("     tsuki-bridge -app-id TU_ID")
		fmt.Println()
		fmt.Println("  o crea tsuki-bridge.json junto al ejecutable:")
		fmt.Println("     {\"app_id\": \"TU_ID\"}")
		os.Exit(1)
	}
	return cfg
}

// ============================================================
// Discord IPC (protocolo: frames [opcode int32 LE][len int32 LE][json])
// ============================================================

const (
	opHandshake = 0
	opFrame     = 1
)

type discordIPC struct {
	mu    sync.Mutex
	conn  io.ReadWriteCloser
	appID string
}

func (d *discordIPC) dial() (io.ReadWriteCloser, string, error) {
	if runtime.GOOS == "windows" {
		for i := 0; i < 10; i++ {
			path := fmt.Sprintf(`\\.\pipe\discord-ipc-%d`, i)
			f, err := os.OpenFile(path, os.O_RDWR, 0)
			if err == nil {
				return f, path, nil
			}
		}
		return nil, "", fmt.Errorf("no se encontró el pipe de Discord (¿está abierto Discord?)")
	}

	// Linux / macOS: unix socket en varios directorios posibles
	dirs := []string{os.Getenv("XDG_RUNTIME_DIR"), os.Getenv("TMPDIR"), "/tmp"}
	if x := os.Getenv("XDG_RUNTIME_DIR"); x != "" {
		dirs = append(dirs, x+"/app/com.discordapp.Discord", x+"/snap.discord") // flatpak / snap
	}
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		for i := 0; i < 10; i++ {
			sock := filepath.Join(dir, fmt.Sprintf("discord-ipc-%d", i))
			c, err := net.DialTimeout("unix", sock, time.Second)
			if err == nil {
				return c, sock, nil
			}
		}
	}
	return nil, "", fmt.Errorf("no se encontró el socket de Discord (¿está abierto Discord?)")
}

func (d *discordIPC) send(opcode int32, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	buf := make([]byte, 8+len(data))
	binary.LittleEndian.PutUint32(buf[0:4], uint32(opcode))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(len(data)))
	copy(buf[8:], data)
	_, err = d.conn.Write(buf)
	return err
}

func (d *discordIPC) read() (map[string]any, error) {
	header := make([]byte, 8)
	if _, err := io.ReadFull(d.conn, header); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(header[4:8])
	body := make([]byte, length)
	if _, err := io.ReadFull(d.conn, body); err != nil {
		return nil, err
	}
	var out map[string]any
	_ = json.Unmarshal(body, &out)
	return out, nil
}

func (d *discordIPC) connect() error {
	conn, path, err := d.dial()
	if err != nil {
		return err
	}
	d.conn = conn
	if err := d.send(opHandshake, map[string]any{"v": 1, "client_id": d.appID}); err != nil {
		conn.Close()
		d.conn = nil
		return err
	}
	ready, err := d.read() // respuesta READY
	if err != nil {
		conn.Close()
		d.conn = nil
		return err
	}
	user := "?"
	if data, ok := ready["data"].(map[string]any); ok {
		if u, ok := data["user"].(map[string]any); ok {
			if name, ok := u["username"].(string); ok {
				user = name
			}
		}
	}
	log.Printf("✓ Conectado a Discord — pipe: %s · cuenta: %s", path, user)
	return nil
}

func (d *discordIPC) setActivity(activity map[string]any) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.conn == nil {
		if err := d.connect(); err != nil {
			return err
		}
	}

	payload := map[string]any{
		"cmd": "SET_ACTIVITY",
		"args": map[string]any{
			"pid":      os.Getpid(),
			"activity": activity, // nil limpia la actividad
		},
		"nonce": fmt.Sprintf("%d", time.Now().UnixNano()),
	}
	if err := d.send(opFrame, payload); err != nil {
		// conexión muerta: cerrar y reintentar una vez
		d.conn.Close()
		d.conn = nil
		if err := d.connect(); err != nil {
			return err
		}
		if err := d.send(opFrame, payload); err != nil {
			return err
		}
	}

	// Leer la respuesta: si Discord rechaza la actividad, lo dice aquí
	resp, err := d.read()
	if err != nil {
		return nil // respuesta ilegible: no bloquear
	}
	if evt, _ := resp["evt"].(string); evt == "ERROR" {
		msg := "error desconocido"
		if data, ok := resp["data"].(map[string]any); ok {
			if m, ok := data["message"].(string); ok {
				msg = m
			}
		}
		return fmt.Errorf("Discord rechazó la actividad: %s", msg)
	}
	return nil
}

// ============================================================
// Estado + HTTP
// ============================================================

var i18n = map[string]map[string]string{
	"es": {
		"watchingAnime": "Viendo anime",
		"paused":        "En pausa",
		"btnEp":         "▶ Ver E%d conmigo",
		"btnEpFallback": "▶ Ver capítulo",
		"btnInstall":    "🌙 Consigue Tsuki gratis",
	},
	"en": {
		"watchingAnime": "Watching anime",
		"paused":        "Paused",
		"btnEp":         "▶ Watch E%d with me",
		"btnEpFallback": "▶ Watch episode",
		"btnInstall":    "🌙 Get Tsuki free",
	},
}

func tr(lang, key string) string {
	if m, ok := i18n[lang]; ok {
		return m[key]
	}
	return i18n["en"][key]
}

type Presence struct {
	Style        string  `json:"style"`
	Lang         string  `json:"lang"`
	Episode      int     `json:"episode"`
	PlaybackRate float64 `json:"playbackRate"`
	Series       string  `json:"series"`
	EpisodeTitle string  `json:"episodeTitle"`
	CurrentTime  float64 `json:"currentTime"`
	Duration     float64 `json:"duration"`
	Paused       bool    `json:"paused"`
	Thumbnail    string  `json:"thumbnail"`
	URL          string  `json:"url"`
}

// ============================================================
// Construcción de la actividad (compartida por HTTP y native messaging)
// ============================================================

func buildActivity(p Presence, installURL string) (map[string]any, string) {
	if p.Lang == "" {
		p.Lang = "en"
	}

	if p.Style == "discreto" {
		details := tr(p.Lang, "watchingAnime")
		activity := map[string]any{
			"type":    3,
			"details": details,
			"assets": map[string]any{
				"large_image": "logo",
				"large_text":  "Tsuki",
			},
		}
		if installURL != "" {
			activity["buttons"] = []map[string]string{
				{"label": tr(p.Lang, "btnInstall"), "url": installURL},
			}
		}
		return activity, details
	}

	details := p.Series
	if details == "" {
		details = "Crunchyroll"
	}
	state := p.EpisodeTitle
	if p.Paused && state != "" {
		state = "⏸ " + state
	} else if p.Paused {
		state = "⏸ " + tr(p.Lang, "paused")
	}

	largeImage := p.Thumbnail
	if largeImage == "" {
		largeImage = "logo"
	}
	smallText := "Tsuki"
	if p.PlaybackRate > 0 && p.PlaybackRate != 1 {
		smallText = fmt.Sprintf("Tsuki · %.3gx", p.PlaybackRate)
	}

	activity := map[string]any{
		"type":    3,
		"details": details,
		"state":   state,
		"assets": map[string]any{
			"large_image": largeImage,
			"large_text":  details,
			"small_image": "logo",
			"small_text":  smallText,
		},
	}

	if !p.Paused && p.Duration > 0 && p.CurrentTime >= 0 {
		remaining := p.Duration - p.CurrentTime
		now := time.Now()
		activity["timestamps"] = map[string]any{
			"start": now.Add(-time.Duration(p.CurrentTime) * time.Second).UnixMilli(),
			"end":   now.Add(time.Duration(remaining) * time.Second).UnixMilli(),
		}
	}

	buttons := []map[string]string{}
	if p.URL != "" {
		label := tr(p.Lang, "btnEpFallback")
		if p.Episode > 0 {
			label = fmt.Sprintf(tr(p.Lang, "btnEp"), p.Episode)
		}
		buttons = append(buttons, map[string]string{"label": label, "url": p.URL})
	}
	if installURL != "" {
		buttons = append(buttons, map[string]string{"label": tr(p.Lang, "btnInstall"), "url": installURL})
	}
	if len(buttons) > 0 {
		activity["buttons"] = buttons
	}
	return activity, details
}

// ============================================================
// Estado compartido
// ============================================================

type bridgeState struct {
	mu         sync.Mutex
	lastUpdate time.Time
	lastShown  string
	active     bool
	ipc        *discordIPC
	installURL string
}

func (s *bridgeState) clear() {
	if err := s.ipc.setActivity(nil); err == nil {
		log.Println("Actividad limpiada")
	}
	s.mu.Lock()
	s.active = false
	s.mu.Unlock()
}

func (s *bridgeState) setPresence(p Presence) error {
	activity, details := buildActivity(p, s.installURL)

	err := s.ipc.setActivity(activity)
	if err != nil {
		log.Println("⚠", err, "→ reintentando en modo compatible")
		st, _ := activity["state"].(string)
		fallback := map[string]any{
			"details": details,
			"state":   st,
			"assets": map[string]any{
				"large_image": "logo",
				"large_text":  details,
			},
		}
		if ts, ok := activity["timestamps"]; ok {
			fallback["timestamps"] = ts
		}
		if err = s.ipc.setActivity(fallback); err != nil {
			log.Println("✗ Discord rechazó también el modo compatible:", err)
			return err
		}
	}

	s.mu.Lock()
	changed := p.Series+p.EpisodeTitle != s.lastShown
	s.lastShown = p.Series + p.EpisodeTitle
	s.lastUpdate = time.Now()
	s.active = true
	s.mu.Unlock()
	if changed {
		log.Printf("▶ Presence: %s — %s", details, p.EpisodeTitle)
	}
	setTrayTip("Tsuki 🌙 " + details)
	return nil
}

func (s *bridgeState) startAutoClear() {
	go func() {
		for range time.Tick(5 * time.Second) {
			s.mu.Lock()
			stale := s.active && time.Since(s.lastUpdate) > 25*time.Second
			s.mu.Unlock()
			if stale {
				s.clear()
			}
		}
	}()
}

// ============================================================
// Modo HTTP (ejecución manual, comportamiento clásico)
// ============================================================

func runHTTP(cfg Config, s *bridgeState) {
	withCORS := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			h(w, r)
		}
	}

	http.HandleFunc("/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		s.mu.Lock()
		status := "sin actividad"
		if s.active {
			status = "publicando: " + s.lastShown
		}
		s.mu.Unlock()
		fmt.Fprintf(w, "Tsuki Bridge 🌙\n\nEstado: %s\nEndpoints: GET /ping · POST /presence · POST /clear\n", status)
	}))

	http.HandleFunc("/ping", withCORS(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "app": "tsuki-bridge"})
	}))

	http.HandleFunc("/clear", withCORS(func(w http.ResponseWriter, r *http.Request) {
		s.clear()
		w.WriteHeader(http.StatusNoContent)
	}))

	http.HandleFunc("/presence", withCORS(func(w http.ResponseWriter, r *http.Request) {
		var p Presence
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		if err := s.setPresence(p); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	log.Printf("Tsuki Bridge 🌙 escuchando en http://%s (App ID: %s…)", addr, cfg.AppID[:min(6, len(cfg.AppID))])
	log.Fatal(http.ListenAndServe(addr, nil))
}

// ============================================================
// Modo Native Messaging (Chrome lanza y apaga el proceso solo)
// Protocolo: uint32 LE con la longitud + JSON, por stdin/stdout.
// ============================================================

type nativeMsg struct {
	Type string   `json:"type"`
	Data Presence `json:"data"`
}

func nativeWrite(v any) {
	data, _ := json.Marshal(v)
	head := make([]byte, 4)
	binary.LittleEndian.PutUint32(head, uint32(len(data)))
	os.Stdout.Write(head)
	os.Stdout.Write(data)
}

func runNative(s *bridgeState) {
	log.Println("Tsuki Bridge 🌙 en modo native messaging (lanzado por Chrome)")
	for {
		head := make([]byte, 4)
		if _, err := io.ReadFull(os.Stdin, head); err != nil {
			// Chrome cerró el puerto (extensión descargada / navegador cerrado)
			s.clear()
			log.Println("Puerto cerrado por Chrome — saliendo")
			return
		}
		length := binary.LittleEndian.Uint32(head)
		body := make([]byte, length)
		if _, err := io.ReadFull(os.Stdin, body); err != nil {
			s.clear()
			return
		}

		var msg nativeMsg
		if err := json.Unmarshal(body, &msg); err != nil {
			nativeWrite(map[string]any{"ok": false, "error": "bad json"})
			continue
		}

		switch msg.Type {
		case "ping":
			nativeWrite(map[string]any{"ok": true, "app": "tsuki-bridge", "mode": "native"})
		case "clear":
			s.clear()
			nativeWrite(map[string]any{"ok": true})
		case "presence":
			if err := s.setPresence(msg.Data); err != nil {
				nativeWrite(map[string]any{"ok": false, "error": err.Error()})
			} else {
				nativeWrite(map[string]any{"ok": true})
			}
		default:
			nativeWrite(map[string]any{"ok": false, "error": "unknown type"})
		}
	}
}

// ============================================================

func main() {
	// Chrome invoca los hosts nativos pasando el origin como argumento
	nativeMode := false
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "chrome-extension://") {
			nativeMode = true
			break
		}
	}

	if nativeMode {
		// En native mode no hay consola: log a archivo junto al ejecutable
		if exe, err := os.Executable(); err == nil {
			if f, err := os.OpenFile(filepath.Join(filepath.Dir(exe), "bridge.log"),
				os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
				log.SetOutput(f)
			}
		}
	}

	cfg := loadConfig(nativeMode)
	s := &bridgeState{
		ipc:        &discordIPC{appID: cfg.AppID},
		installURL: cfg.InstallURL,
	}
	s.startAutoClear()
	startTray(s)

	if nativeMode {
		runNative(s)
		removeTray()
		return
	}
	runHTTP(cfg, s)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
