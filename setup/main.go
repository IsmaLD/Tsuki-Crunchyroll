// Tsuki Setup — instalador desktop nativo para Tsuki Bridge
//
// Un solo .exe con ventana Win32 nativa (sin navegador, sin consola,
// sin flashes de cmd): la UI vive en ui_windows.go, aquí la lógica.
package main

import (
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

//go:embed assets/tsuki-bridge-host.exe
var hostExe []byte

//go:embed assets/logo.png
var logoPng []byte

const hostName = "com.tsuki.bridge"
const extensionOrigin = "chrome-extension://eledeehbohbpjmpclfmkajpcfehbolje/"

func installDir() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Tsuki")
}

// runHidden ejecuta un comando suprimiendo la ventana de consola del hijo
// (reg.exe, etc.) — sin esto, cada llamada flashea un cmd en pantalla.
func runHidden(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	hideWindow(cmd)
	return cmd.Run()
}

func regAdd(root, value string) error {
	return runHidden("reg", "add", root, "/ve", "/t", "REG_SZ", "/d", value, "/f")
}

// doInstall ejecuta los pasos reportando cada uno vía callback.
// IDs de paso: dir, copy, manifest, registry, verify.
func doInstall(report func(id string, ok bool, errMsg string)) bool {
	step := func(id string, err error) bool {
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		report(id, err == nil, msg)
		return err == nil
	}

	if runtime.GOOS != "windows" {
		report("dir", false, "solo Windows")
		return false
	}

	dir := installDir()
	if !step("dir", os.MkdirAll(dir, 0755)) {
		return false
	}

	exePath := filepath.Join(dir, "tsuki-bridge-host.exe")

	// Si el bridge está corriendo (Chrome lo lanzó), Windows no deja
	// sobreescribir el exe. Matarlo primero; Chrome lo relanza cuando toque.
	_ = runHidden("taskkill", "/IM", "tsuki-bridge-host.exe", "/F")

	err := os.WriteFile(exePath, hostExe, 0755)
	if err != nil {
		// Fallback: renombrar el exe en uso (Windows sí lo permite) y escribir
		old := exePath + ".old"
		_ = os.Remove(old)
		if os.Rename(exePath, old) == nil {
			err = os.WriteFile(exePath, hostExe, 0755)
			_ = os.Remove(old) // best effort; si sigue en uso quedará para la próxima
		}
	}
	if !step("copy", err) {
		return false
	}

	manifest := map[string]any{
		"name":            hostName,
		"description":     "Tsuki Bridge - Discord Rich Presence",
		"path":            exePath,
		"type":            "stdio",
		"allowed_origins": []string{extensionOrigin},
	}
	data, _ := json.MarshalIndent(manifest, "", "  ")
	manifestPath := filepath.Join(dir, hostName+".json")
	if !step("manifest", os.WriteFile(manifestPath, data, 0644)) {
		return false
	}

	// Chrome (requerido) + Edge (best effort, mismo mecanismo)
	if !step("registry", regAdd(`HKCU\Software\Google\Chrome\NativeMessagingHosts\`+hostName, manifestPath)) {
		return false
	}
	_ = regAdd(`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\`+hostName, manifestPath)

	return step("verify", runHidden("reg", "query",
		`HKCU\Software\Google\Chrome\NativeMessagingHosts\`+hostName))
}

func doUninstall() bool {
	err := runHidden("reg", "delete",
		`HKCU\Software\Google\Chrome\NativeMessagingHosts\`+hostName, "/f")
	_ = runHidden("reg", "delete",
		`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\`+hostName, "/f")
	_ = os.RemoveAll(installDir())
	return err == nil
}

func isInstalled() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	return runHidden("reg", "query",
		`HKCU\Software\Google\Chrome\NativeMessagingHosts\`+hostName) == nil
}

func main() {
	runUI()
}
