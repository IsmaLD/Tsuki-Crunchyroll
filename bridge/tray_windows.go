//go:build windows

// Ícono en la bandeja del sistema — existe SOLO mientras el bridge vive
// (es decir, mientras ves anime). Da visibilidad y control sin proceso
// residente: al cerrar la pestaña/Chrome, el proceso muere y el ícono
// desaparece solo.
package main

import (
	_ "embed"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

//go:embed tsuki.ico
var trayIco []byte

var (
	tUser32   = syscall.NewLazyDLL("user32.dll")
	tShell32  = syscall.NewLazyDLL("shell32.dll")
	tKernel32 = syscall.NewLazyDLL("kernel32.dll")

	tRegisterClassExW    = tUser32.NewProc("RegisterClassExW")
	tCreateWindowExW     = tUser32.NewProc("CreateWindowExW")
	tDefWindowProcW      = tUser32.NewProc("DefWindowProcW")
	tGetMessageW         = tUser32.NewProc("GetMessageW")
	tTranslateMessage    = tUser32.NewProc("TranslateMessage")
	tDispatchMessageW    = tUser32.NewProc("DispatchMessageW")
	tCreatePopupMenu     = tUser32.NewProc("CreatePopupMenu")
	tAppendMenuW         = tUser32.NewProc("AppendMenuW")
	tTrackPopupMenu      = tUser32.NewProc("TrackPopupMenu")
	tSetForegroundWindow = tUser32.NewProc("SetForegroundWindow")
	tDestroyMenu         = tUser32.NewProc("DestroyMenu")
	tGetCursorPos        = tUser32.NewProc("GetCursorPos")
	tLoadImageW          = tUser32.NewProc("LoadImageW")
	tPostMessageW        = tUser32.NewProc("PostMessageW")
	tShellNotifyIconW    = tShell32.NewProc("Shell_NotifyIconW")
	tGetModuleHandleW    = tKernel32.NewProc("GetModuleHandleW")
)

const (
	nimAdd    = 0
	nimModify = 1
	nimDelete = 2

	nifMessage = 0x01
	nifIcon    = 0x02
	nifTip     = 0x04

	wmTrayCallback = 0x8000 + 100 // WM_APP + 100
	wmCommand      = 0x0111
	wmRButtonUp    = 0x0205
	wmLButtonUpT   = 0x0202

	cmdClear = 1001
	cmdQuit  = 1002

	mfString   = 0x0000
	mfGrayed   = 0x0001
	mfSep      = 0x0800
	tpmRetCmd  = 0x0100
	lrLoadFile = 0x0010
)

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
}

type trayPoint struct{ X, Y int32 }

var (
	trayHwnd   uintptr
	trayData   notifyIconData
	trayState  *bridgeState
	trayStatus = "Tsuki Bridge"
)

func trayUTF16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func setTrayTip(text string) {
	if trayHwnd == 0 {
		return
	}
	if len(text) > 100 {
		text = text[:100] + "…"
	}
	trayStatus = text
	u, _ := syscall.UTF16FromString(text)
	for i := range trayData.SzTip {
		trayData.SzTip[i] = 0
	}
	copy(trayData.SzTip[:], u)
	tShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&trayData)))
}

func trayMenu() {
	menu, _, _ := tCreatePopupMenu.Call()
	defer tDestroyMenu.Call(menu)

	tAppendMenuW.Call(menu, mfString|mfGrayed, 0,
		uintptr(unsafe.Pointer(trayUTF16(trayStatus))))
	tAppendMenuW.Call(menu, mfSep, 0, 0)
	tAppendMenuW.Call(menu, mfString, cmdClear,
		uintptr(unsafe.Pointer(trayUTF16(trMenu("clear")))))
	tAppendMenuW.Call(menu, mfString, cmdQuit,
		uintptr(unsafe.Pointer(trayUTF16(trMenu("quit")))))

	var pt trayPoint
	tGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	tSetForegroundWindow.Call(trayHwnd)
	cmd, _, _ := tTrackPopupMenu.Call(menu, tpmRetCmd,
		uintptr(pt.X), uintptr(pt.Y), 0, trayHwnd, 0)

	switch cmd {
	case cmdClear:
		if trayState != nil {
			trayState.clear()
			setTrayTip("Tsuki Bridge 🌙")
		}
	case cmdQuit:
		if trayState != nil {
			trayState.clear()
		}
		tShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&trayData)))
		os.Exit(0)
	}
}

func trMenu(key string) string {
	// Idioma según el sistema (mismo criterio que el instalador)
	langID, _, _ := tKernel32.NewProc("GetUserDefaultUILanguage").Call()
	es := langID&0x3FF == 0x0A
	switch key {
	case "clear":
		if es {
			return "Limpiar actividad de Discord"
		}
		return "Clear Discord activity"
	case "quit":
		if es {
			return "Salir de Tsuki Bridge"
		}
		return "Quit Tsuki Bridge"
	}
	return key
}

func trayWndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	if msg == wmTrayCallback {
		if lparam == wmRButtonUp || lparam == wmLButtonUpT {
			trayMenu()
		}
		return 0
	}
	r, _, _ := tDefWindowProcW.Call(hwnd, msg, wparam, lparam)
	return r
}

func loadTrayIcon() uintptr {
	// LoadImageW necesita archivo: escribir el ico embebido junto al log
	dir := os.TempDir()
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	path := filepath.Join(dir, "tsuki.ico")
	if _, err := os.Stat(path); err != nil {
		if os.WriteFile(path, trayIco, 0644) != nil {
			path = filepath.Join(os.TempDir(), "tsuki.ico")
			_ = os.WriteFile(path, trayIco, 0644)
		}
	}
	icon, _, _ := tLoadImageW.Call(0, uintptr(unsafe.Pointer(trayUTF16(path))),
		1 /*IMAGE_ICON*/, 16, 16, lrLoadFile)
	return icon
}

// startTray levanta el ícono en su propio hilo de mensajes.
// El proceso sigue siendo efímero: sin bridge activo no hay ícono.
func startTray(s *bridgeState) {
	trayState = s
	go func() {
		runtime.LockOSThread()

		hInst, _, _ := tGetModuleHandleW.Call(0)
		className := trayUTF16("TsukiTrayWnd")
		wc := struct {
			CbSize        uint32
			Style         uint32
			LpfnWndProc   uintptr
			CbClsExtra    int32
			CbWndExtra    int32
			HInstance     uintptr
			HIcon         uintptr
			HCursor       uintptr
			HbrBackground uintptr
			LpszMenuName  *uint16
			LpszClassName *uint16
			HIconSm       uintptr
		}{
			CbSize:        80,
			LpfnWndProc:   syscall.NewCallback(trayWndProc),
			HInstance:     hInst,
			LpszClassName: className,
		}
		wc.CbSize = uint32(unsafe.Sizeof(wc))
		tRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

		// Ventana oculta solo para recibir los callbacks del tray
		hwnd, _, _ := tCreateWindowExW.Call(0,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(trayUTF16("Tsuki Bridge"))),
			0, 0, 0, 0, 0, 0, 0, hInst, 0)
		trayHwnd = hwnd

		trayData = notifyIconData{
			HWnd:             hwnd,
			UID:              1,
			UFlags:           nifMessage | nifIcon | nifTip,
			UCallbackMessage: wmTrayCallback,
			HIcon:            loadTrayIcon(),
		}
		trayData.CbSize = uint32(unsafe.Sizeof(trayData))
		copy(trayData.SzTip[:], syscall.StringToUTF16("Tsuki Bridge 🌙"))
		tShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))

		var m msgW
		for {
			r, _, _ := tGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				break
			}
			tTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			tDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
	}()
}

type msgW struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      trayPoint
}

func removeTray() {
	if trayHwnd != 0 {
		tShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&trayData)))
	}
}
