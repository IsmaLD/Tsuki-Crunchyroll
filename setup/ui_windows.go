//go:build windows

// UI nativa Win32 del instalador — pintada a mano (fondo oscuro de Tsuki,
// acento naranja) usando solo syscalls: sin navegador, sin dependencias,
// sin cgo, sin consolas.
package main

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	"image/png"
	"math"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

//go:embed assets/steps
var stepsFS embed.FS

type sprite struct {
	pix  []byte
	w, h int32
}

var (
	spritePending *sprite
	spriteDone    *sprite
	spriteFail    *sprite
	spinFrames    [24]*sprite
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	pRegisterClassExW   = user32.NewProc("RegisterClassExW")
	pCreateWindowExW    = user32.NewProc("CreateWindowExW")
	pDefWindowProcW     = user32.NewProc("DefWindowProcW")
	pShowWindow         = user32.NewProc("ShowWindow")
	pGetMessageW        = user32.NewProc("GetMessageW")
	pTranslateMessage   = user32.NewProc("TranslateMessage")
	pDispatchMessageW   = user32.NewProc("DispatchMessageW")
	pPostQuitMessage    = user32.NewProc("PostQuitMessage")
	pPostMessageW       = user32.NewProc("PostMessageW")
	pDestroyWindow      = user32.NewProc("DestroyWindow")
	pInvalidateRect     = user32.NewProc("InvalidateRect")
	pBeginPaint         = user32.NewProc("BeginPaint")
	pEndPaint           = user32.NewProc("EndPaint")
	pFillRect           = user32.NewProc("FillRect")
	pDrawTextW          = user32.NewProc("DrawTextW")
	pLoadCursorW        = user32.NewProc("LoadCursorW")
	pGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	pMessageBoxW        = user32.NewProc("MessageBoxW")
	pSetProcessDPIAware = user32.NewProc("SetProcessDPIAware")
	pGetClientRect      = user32.NewProc("GetClientRect")
	pLoadIconW          = user32.NewProc("LoadIconW")
	pScreenToClient     = user32.NewProc("ScreenToClient")
	pSetTimer           = user32.NewProc("SetTimer")
	pTrackMouseEvent    = user32.NewProc("TrackMouseEvent")
	pSetCursor          = user32.NewProc("SetCursor")
	pKillTimer          = user32.NewProc("KillTimer")

	dwmapi            = syscall.NewLazyDLL("dwmapi.dll")
	pDwmSetWindowAttr = dwmapi.NewProc("DwmSetWindowAttribute")

	pCreateSolidBrush     = gdi32.NewProc("CreateSolidBrush")
	pCreatePen            = gdi32.NewProc("CreatePen")
	pSelectObject         = gdi32.NewProc("SelectObject")
	pDeleteObject         = gdi32.NewProc("DeleteObject")
	pSetTextColor         = gdi32.NewProc("SetTextColor")
	pSetBkMode            = gdi32.NewProc("SetBkMode")
	pCreateFontW          = gdi32.NewProc("CreateFontW")
	pRoundRect            = gdi32.NewProc("RoundRect")
	pStretchDIBits        = gdi32.NewProc("StretchDIBits")
	pTextOutW             = gdi32.NewProc("TextOutW")
	pGetTextExtent        = gdi32.NewProc("GetTextExtentPoint32W")
	pCreateCompatibleDC   = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBmp  = gdi32.NewProc("CreateCompatibleBitmap")
	pBitBlt               = gdi32.NewProc("BitBlt")
	pDeleteDC             = gdi32.NewProc("DeleteDC")
	pGetUserDefaultUILang = kernel32.NewProc("GetUserDefaultUILanguage")
	pGetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmDestroy    = 0x0002
	wmPaint      = 0x000F
	wmEraseBkg   = 0x0014
	wmLButtonUp  = 0x0202
	wmTimer      = 0x0113
	wmMouseMove  = 0x0200
	wmMouseLeave = 0x02A3
	wmSetCursor  = 0x0020
	wmApp        = 0x8000

	wsPopup       = 0x80000000
	wsVisible     = 0x10000000
	wsExAppWindow = 0x00040000

	wmNcHitTest = 0x0084
	htClient    = 1
	htCaption   = 2
	swMinimize  = 6

	dtWordbreak = 0x0010
	dtCalcRect  = 0x0400
	dtCenter    = 0x0001
	transparent = 1
)

// Colores COLORREF (0x00BBGGRR)
const (
	cPage   = 0x000D0D0D
	cBg     = 0x00141414
	cBorder = 0x00262626
	cText   = 0x00E3E6E8
	cMuted  = 0x0082878A
	cOrange = 0x002175F4
	cGreen  = 0x0071CC2E
	cRed    = 0x005656E0
	cBtnTxt = 0x00141414
	cCard   = 0x001D1D1D
)

type rect struct{ Left, Top, Right, Bottom int32 }
type point struct{ X, Y int32 }
type msgT struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}
type paintStruct struct {
	Hdc         uintptr
	FErase      int32
	RcPaint     rect
	FRestore    int32
	FIncUpdate  int32
	RgbReserved [32]byte
}
type wndClassExW struct {
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
}
type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// ============================================================
// Estado de la UI
// ============================================================

const (
	viewWelcome = iota
	viewInstalling
	viewDone
	viewConfirmUn
	viewUninstalled
)

var (
	hwndMain   uintptr
	view       = viewWelcome
	installed  bool
	lang       = "en"
	stepIDs    = []string{"dir", "copy", "manifest", "registry", "verify"}
	stepStatus [5]int // 0 pendiente · 1 corriendo · 2 ok · 3 fallo
	lastErr    string
	spinAngle  float64
	handCursor uintptr

	// Hover: id del control bajo el mouse + progreso de animación 0..1 por control
	hovered      int
	hoverP       = map[int]float64{}
	hoverTicking bool
	leaveTracked bool
	logoImg      *image.RGBA
	logoW        int32
	logoH        int32
	// Fuentes (creadas una vez)
	fontTitle, fontBody, fontSmall, fontBtn, fontEmoji uintptr
)

var uiText = map[string]map[string]string{
	"es": {
		"subtitle":  "Companion opcional de Crunchyroll Tsuki: muestra en tu perfil de Discord el anime que estás viendo.",
		"b1":        "Chrome lo lanza y lo apaga automáticamente — nunca verás una terminal ni procesos de fondo.",
		"b2":        "Instalación de un click, sin permisos de administrador.",
		"b3":        "Todo ocurre en tu PC: nada se envía a servidores externos.",
		"install":   "Instalar Tsuki Bridge",
		"reinstall": "Reinstalar / Reparar",
		"uninstall": "Desinstalar",
		"close":     "Cerrar",
		"st0":       "Crear carpeta de instalación",
		"st1":       "Copiar Tsuki Bridge",
		"st2":       "Configurar native messaging",
		"st3":       "Registrar en Chrome y Edge",
		"st4":       "Verificar instalación",
		"doneTitle": "¡Listo!",
		"n1":        "1.  Reinicia Chrome por completo (ciérralo desde la bandeja del sistema).",
		"n2":        "2.  En Tsuki: Ajustes → Integraciones → activa Discord Rich Presence.",
		"n3":        "3.  Abre Discord (app de escritorio) y dale play a un episodio.",
		"unConfirm": "¿Seguro que quieres desinstalar Tsuki Bridge de esta computadora?",
		"unYes":     "Sí, desinstalar",
		"cancel":    "Cancelar",
		"unDone":    "Tsuki Bridge fue desinstalado de esta computadora.",
		"unBye":     "Puedes cerrar esta ventana, o reinstalarlo cuando quieras.",
		"errTitle":  "Falló un paso de la instalación",
		"foot":      "Tsuki Bridge se instala solo para tu usuario en %LOCALAPPDATA%\\Tsuki. Desinstalable en cualquier momento desde este mismo instalador.",
	},
	"en": {
		"subtitle":  "Optional companion for Crunchyroll Tsuki: shows the anime you're watching on your Discord profile.",
		"b1":        "Chrome launches and stops it automatically — you'll never see a terminal or background processes.",
		"b2":        "One-click install, no admin rights needed.",
		"b3":        "Everything happens on your PC: nothing is sent to external servers.",
		"install":   "Install Tsuki Bridge",
		"reinstall": "Reinstall / Repair",
		"uninstall": "Uninstall",
		"close":     "Close",
		"st0":       "Create install folder",
		"st1":       "Copy Tsuki Bridge",
		"st2":       "Configure native messaging",
		"st3":       "Register with Chrome and Edge",
		"st4":       "Verify installation",
		"doneTitle": "Done!",
		"n1":        "1.  Fully restart Chrome (quit it from the system tray).",
		"n2":        "2.  In Tsuki: Settings → Integrations → enable Discord Rich Presence.",
		"n3":        "3.  Open Discord (desktop app) and play an episode.",
		"unConfirm": "Are you sure you want to uninstall Tsuki Bridge from this computer?",
		"unYes":     "Yes, uninstall",
		"cancel":    "Cancel",
		"unDone":    "Tsuki Bridge was uninstalled from this computer.",
		"unBye":     "You can close this window, or reinstall it anytime.",
		"errTitle":  "An installation step failed",
		"foot":      "Tsuki Bridge installs for your user only at %LOCALAPPDATA%\\Tsuki. Removable anytime from this same installer.",
	},
}

func tt(key string) string { return uiText[lang][key] }

func utf16p(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

// ============================================================
// Layout (coordenadas fijas, ventana no redimensionable)
// ============================================================

const winW, winH = 460, 664
const barH = 40

var (
	btnMain   = rect{}
	btnSecond = rect{}

	// Barra de título propia
	btnClose = rect{winW - 44, 0, winW, barH}
	btnMin   = rect{winW - 88, 0, winW - 44, barH}
	pillES   = rect{winW - 162, 10, winW - 132, 30}
	pillEN   = rect{winW - 128, 10, winW - 98, 30}
)

func inRect(r rect, x, y int32) bool {
	return x >= r.Left && x <= r.Right && y >= r.Top && y <= r.Bottom
}

// ============================================================
// Dibujo
// ============================================================

func withBrush(hdc uintptr, color uint32, fn func(brush uintptr)) {
	b, _, _ := pCreateSolidBrush.Call(uintptr(color))
	old, _, _ := pSelectObject.Call(hdc, b)
	fn(b)
	pSelectObject.Call(hdc, old)
	pDeleteObject.Call(b)
}

func fillRect(hdc uintptr, r rect, color uint32) {
	b, _, _ := pCreateSolidBrush.Call(uintptr(color))
	pFillRect.Call(hdc, uintptr(unsafe.Pointer(&r)), b)
	pDeleteObject.Call(b)
}

func drawText(hdc uintptr, s string, r rect, font uintptr, color uint32, flags uintptr) {
	pSelectObject.Call(hdc, font)
	pSetTextColor.Call(hdc, uintptr(color))
	pSetBkMode.Call(hdc, transparent)
	u, _ := syscall.UTF16FromString(s)
	pDrawTextW.Call(hdc, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1),
		uintptr(unsafe.Pointer(&r)), flags)
}

const (
	btnGhost = iota
	btnPrimary
	btnDanger
)

// IDs de controles interactivos (para hover/hit-test)
const (
	hNone = iota
	hMain
	hSecond
	hES
	hEN
	hMin
	hClose
)

type trackMouseEventT struct {
	CbSize      uint32
	DwFlags     uint32
	HwndTrack   uintptr
	DwHoverTime uint32
}

func hoverVal(id int) float64 { return hoverP[id] }

// Interpolación de COLORREF (0x00BBGGRR) para el fade del hover
func lerpColor(a, b uint32, t float64) uint32 {
	ch := func(x, y uint32) uint32 {
		return uint32(float64(x) + (float64(y)-float64(x))*t)
	}
	return ch(a&0xFF, b&0xFF) | ch((a>>8)&0xFF, (b>>8)&0xFF)<<8 | ch((a>>16)&0xFF, (b>>16)&0xFF)<<16
}

func startHoverAnim() {
	if !hoverTicking {
		hoverTicking = true
		pSetTimer.Call(hwndMain, 2, 25, 0)
	}
}

func drawButton(hdc uintptr, r rect, label string, style int, hp float64) {
	fillColor := uint32(cOrange)
	txtColor := uint32(cBtnTxt)
	switch style {
	case btnGhost:
		fillColor = lerpColor(cCard, 0x002E2E2E, hp)
		txtColor = lerpColor(cMuted, cText, hp)
	case btnPrimary:
		fillColor = lerpColor(cOrange, 0x003D8AFF, hp) // naranja → naranja claro
	case btnDanger:
		fillColor = lerpColor(cRed, 0x007878EC, hp)
		txtColor = 0x00FFFFFF
	}
	pen, _, _ := pCreatePen.Call(0, 1, uintptr(fillColor))
	oldPen, _, _ := pSelectObject.Call(hdc, pen)
	withBrush(hdc, fillColor, func(_ uintptr) {
		pRoundRect.Call(hdc, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right), uintptr(r.Bottom), 12, 12)
	})
	pSelectObject.Call(hdc, oldPen)
	pDeleteObject.Call(pen)
	tr := rect{r.Left, r.Top + (r.Bottom-r.Top)/2 - 10, r.Right, r.Bottom}
	drawText(hdc, label, tr, fontBtn, txtColor, dtCenter)
}

type gdiSize struct{ Cx, Cy int32 }

func textWidth(hdc uintptr, font uintptr, s string) int32 {
	pSelectObject.Call(hdc, font)
	u, _ := syscall.UTF16FromString(s)
	var sz gdiSize
	pGetTextExtent.Call(hdc, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1),
		uintptr(unsafe.Pointer(&sz)))
	return sz.Cx
}

func textOut(hdc uintptr, x, y int32, s string, font uintptr, color uint32) {
	pSelectObject.Call(hdc, font)
	pSetTextColor.Call(hdc, uintptr(color))
	pSetBkMode.Call(hdc, transparent)
	u, _ := syscall.UTF16FromString(s)
	pTextOutW.Call(hdc, uintptr(x), uintptr(y), uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1))
}

// Título bicolor centrado: "Tsuki " claro + "Bridge" naranja (como la web)
func drawTitleTwoTone(hdc uintptr, y int32) {
	w1 := textWidth(hdc, fontTitle, "Tsuki ")
	w2 := textWidth(hdc, fontTitle, "Bridge")
	x := (winW - w1 - w2) / 2
	textOut(hdc, x, y, "Tsuki ", fontTitle, cText)
	textOut(hdc, x+w1, y, "Bridge", fontTitle, cOrange)
}

// Altura real que ocupará un texto con word-wrap a ese ancho
func textHeight(hdc uintptr, s string, font uintptr, width int32) int32 {
	pSelectObject.Call(hdc, font)
	r := rect{0, 0, width, 0}
	u, _ := syscall.UTF16FromString(s)
	pDrawTextW.Call(hdc, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)-1),
		uintptr(unsafe.Pointer(&r)), dtWordbreak|dtCalcRect)
	return r.Bottom
}

// Paso del checklist: sprites PNG pre-renderizados con antialiasing
// (GDI no antialiasa vectores; estampar imágenes 1:1 es pixel-perfect)
func drawStep(hdc uintptr, cx, cy int32, status int) {
	var s *sprite
	switch status {
	case 0:
		s = spritePending
	case 1:
		frame := int(spinAngle/(2*math.Pi)*24) % 24
		if frame < 0 {
			frame = 0
		}
		s = spinFrames[frame]
	case 2:
		s = spriteDone
	case 3:
		s = spriteFail
	}
	if s != nil {
		drawSprite(hdc, cx-s.w/2, cy-s.h/2, s)
	}
}

func drawPill(hdc uintptr, r rect, label string, active bool, hp float64) {
	fill := lerpColor(cCard, 0x002E2E2E, hp)
	txt := lerpColor(cMuted, cText, hp)
	if active {
		fill = lerpColor(cOrange, 0x003D8AFF, hp)
		txt = cBtnTxt
	}
	pen, _, _ := pCreatePen.Call(0, 1, uintptr(fill))
	oldPen, _, _ := pSelectObject.Call(hdc, pen)
	withBrush(hdc, fill, func(_ uintptr) {
		pRoundRect.Call(hdc, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right), uintptr(r.Bottom), 10, 10)
	})
	pSelectObject.Call(hdc, oldPen)
	pDeleteObject.Call(pen)
	tr := rect{r.Left, r.Top + 2, r.Right, r.Bottom}
	drawText(hdc, label, tr, fontSmall, txt, dtCenter)
}

func drawLogo(hdc uintptr, x, y, size int32) {
	if logoImg == nil {
		return
	}
	hdr := bitmapInfoHeader{
		Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: logoW,
		Height: -logoH, Planes: 1, BitCount: 32, Compression: 0,
	}
	pStretchDIBits.Call(hdc, uintptr(x), uintptr(y), uintptr(size), uintptr(size),
		0, 0, uintptr(logoW), uintptr(logoH),
		uintptr(unsafe.Pointer(&logoImg.Pix[0])), uintptr(unsafe.Pointer(&hdr)),
		0, 0x00CC0020) // DIB_RGB_COLORS, SRCCOPY
}

func paint(hdc uintptr) {
	var client rect
	pGetClientRect.Call(hwndMain, uintptr(unsafe.Pointer(&client)))
	fillRect(hdc, client, cBg)

	// Borde de 1px de la ventana
	fillRect(hdc, rect{0, 0, winW, 1}, cBorder)
	fillRect(hdc, rect{0, winH - 1, winW, winH}, cBorder)
	fillRect(hdc, rect{0, 0, 1, winH}, cBorder)
	fillRect(hdc, rect{winW - 1, 0, winW, winH}, cBorder)

	// Barra de título integrada en la misma superficie + divisor sutil
	drawText(hdc, "Tsuki Setup", rect{18, 11, 200, 32}, fontSmall, cMuted, 0)
	drawPill(hdc, pillES, "ES", lang == "es", hoverVal(hES))
	drawPill(hdc, pillEN, "EN", lang == "en", hoverVal(hEN))
	if hp := hoverVal(hMin); hp > 0 {
		fillRect(hdc, btnMin, lerpColor(cBg, 0x002A2A2A, hp))
	}
	if hp := hoverVal(hClose); hp > 0 {
		fillRect(hdc, btnClose, lerpColor(cBg, cRed, hp))
	}
	drawText(hdc, "—", rect{btnMin.Left, 10, btnMin.Right, 32}, fontBody,
		lerpColor(cMuted, cText, hoverVal(hMin)), dtCenter)
	drawText(hdc, "✕", rect{btnClose.Left, 10, btnClose.Right, 32}, fontBody,
		lerpColor(cMuted, 0x00FFFFFF, hoverVal(hClose)), dtCenter)
	fillRect(hdc, rect{0, barH, winW, barH + 1}, 0x001F1F1F)

	// Header: logo 1:1 (asset pre-renderizado a 64px) + título bicolor
	drawLogo(hdc, (winW-64)/2, barH+30, 64)
	drawTitleTwoTone(hdc, barH+112)

	y := int32(barH + 156)
	btnSecond = rect{} // solo existe cuando se dibuja

	switch view {
	case viewWelcome:
		hs := textHeight(hdc, tt("subtitle"), fontBody, winW-128)
		drawText(hdc, tt("subtitle"), rect{64, y, winW - 64, y + hs}, fontBody, cMuted, dtCenter|dtWordbreak)
		y += hs + 30

		bullets := []string{tt("b1"), tt("b2"), tt("b3")}
		icons := []string{"🌙", "⚡", "🔒"}
		for i, b := range bullets {
			hb := textHeight(hdc, b, fontBody, winW-64-96)
			textOut(hdc, 60, y-1, icons[i], fontEmoji, cOrange)
			drawText(hdc, b, rect{96, y, winW - 64, y + hb}, fontBody, cText, dtWordbreak)
			y += hb + 16
		}
		y += 4

		label := tt("install")
		if installed {
			label = tt("reinstall")
		}
		btnMain = rect{56, y, winW - 56, y + 46}
		drawButton(hdc, btnMain, label, btnPrimary, hoverVal(hMain))
		y += 58
		if installed {
			btnSecond = rect{56, y, winW - 56, y + 32}
			drawButton(hdc, btnSecond, tt("uninstall"), btnGhost, hoverVal(hSecond))
			y += 44
		}

		hf := textHeight(hdc, tt("foot"), fontSmall, winW-128)
		drawText(hdc, tt("foot"), rect{64, winH - 16 - hf, winW - 64, winH - 16}, fontSmall, cMuted, dtCenter|dtWordbreak)

	case viewInstalling:
		y += 8
		for i := range stepIDs {
			drawStep(hdc, 76, y+11, stepStatus[i])
			color := uint32(cMuted)
			switch stepStatus[i] {
			case 1, 2:
				color = cText
			case 3:
				color = cRed
			}
			drawText(hdc, tt("st"+string(rune('0'+i))), rect{102, y, winW - 60, y + 24}, fontBody, color, 0)
			y += 46
		}
		if lastErr != "" {
			he := textHeight(hdc, tt("errTitle")+": "+lastErr, fontSmall, winW-120)
			drawText(hdc, tt("errTitle")+": "+lastErr, rect{60, y + 6, winW - 60, y + 6 + he},
				fontSmall, cRed, dtWordbreak)
			btnMain = rect{56, winH - 88, winW - 56, winH - 42}
			drawButton(hdc, btnMain, tt("reinstall"), btnPrimary, hoverVal(hMain))
		}

	case viewDone:
		drawText(hdc, tt("doneTitle"), rect{0, y, winW, y + 38}, fontTitle, cOrange, dtCenter)
		y += 54
		notes := []string{tt("n1"), tt("n2"), tt("n3")}
		for _, n := range notes {
			hn := textHeight(hdc, n, fontBody, winW-64-64)
			drawText(hdc, n, rect{64, y, winW - 64, y + hn}, fontBody, cText, dtWordbreak)
			y += hn + 16
		}
		y += 10
		btnMain = rect{56, y, winW - 56, y + 46}
		drawButton(hdc, btnMain, tt("close"), btnPrimary, hoverVal(hMain))
		hf := textHeight(hdc, tt("foot"), fontSmall, winW-128)
		drawText(hdc, tt("foot"), rect{64, winH - 16 - hf, winW - 64, winH - 16}, fontSmall, cMuted, dtCenter|dtWordbreak)

	case viewConfirmUn:
		y += 16
		textOut(hdc, winW/2-11, y, "⚠", fontEmoji, cOrange)
		y += 40
		hq := textHeight(hdc, tt("unConfirm"), fontBody, winW-128)
		drawText(hdc, tt("unConfirm"), rect{64, y, winW - 64, y + hq}, fontBody, cText, dtCenter|dtWordbreak)
		y += hq + 34
		btnMain = rect{56, y, winW - 56, y + 46}
		drawButton(hdc, btnMain, tt("unYes"), btnDanger, hoverVal(hMain))
		y += 58
		btnSecond = rect{56, y, winW - 56, y + 38}
		drawButton(hdc, btnSecond, tt("cancel"), btnGhost, hoverVal(hSecond))

	case viewUninstalled:
		y += 16
		if spriteDone != nil {
			drawSprite(hdc, (winW-spriteDone.w)/2, y, spriteDone)
		}
		y += 42
		hd := textHeight(hdc, tt("unDone"), fontBody, winW-128)
		drawText(hdc, tt("unDone"), rect{64, y, winW - 64, y + hd}, fontBody, cText, dtCenter|dtWordbreak)
		y += hd + 12
		hb := textHeight(hdc, tt("unBye"), fontSmall, winW-128)
		drawText(hdc, tt("unBye"), rect{64, y, winW - 64, y + hb}, fontSmall, cMuted, dtCenter|dtWordbreak)
		y += hb + 34
		btnMain = rect{56, y, winW - 56, y + 46}
		drawButton(hdc, btnMain, tt("close"), btnPrimary, hoverVal(hMain))
		y += 58
		btnSecond = rect{56, y, winW - 56, y + 38}
		drawButton(hdc, btnSecond, tt("install"), btnGhost, hoverVal(hSecond))
	}
}

// ============================================================
// Acciones
// ============================================================

func startInstall() {
	view = viewInstalling
	lastErr = ""
	for i := range stepStatus {
		stepStatus[i] = 0
	}
	stepStatus[0] = 1
	pSetTimer.Call(hwndMain, 1, 40, 0) // ~25fps para el throbber
	pInvalidateRect.Call(hwndMain, 0, 1)

	go func() {
		idx := map[string]int{"dir": 0, "copy": 1, "manifest": 2, "registry": 3, "verify": 4}
		okAll := doInstall(func(id string, ok bool, errMsg string) {
			i := idx[id]
			code := uintptr(2)
			if !ok {
				code = 3
				lastErr = errMsg
			}
			time.Sleep(320 * time.Millisecond) // ritmo visual del checklist
			pPostMessageW.Call(hwndMain, wmApp+1, uintptr(i), code)
		})
		if okAll {
			time.Sleep(500 * time.Millisecond)
			pPostMessageW.Call(hwndMain, wmApp+2, 0, 0)
		}
	}()
}

// ============================================================
// WndProc + main loop
// ============================================================

func hitTest(x, y int32) int {
	valid := func(r rect) bool { return r.Right > r.Left }
	switch {
	case inRect(btnClose, x, y):
		return hClose
	case inRect(btnMin, x, y):
		return hMin
	case inRect(pillES, x, y):
		return hES
	case inRect(pillEN, x, y):
		return hEN
	case valid(btnMain) && inRect(btnMain, x, y):
		return hMain
	case valid(btnSecond) && inRect(btnSecond, x, y):
		return hSecond
	}
	return hNone
}

func wndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	switch msg {
	case wmPaint:
		// Double buffering: pintar todo en memoria y volcar en un BitBlt
		// (elimina el pestañeo del redibujado del throbber)
		var ps paintStruct
		hdc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		memDC, _, _ := pCreateCompatibleDC.Call(hdc)
		memBmp, _, _ := pCreateCompatibleBmp.Call(hdc, winW, winH)
		oldBmp, _, _ := pSelectObject.Call(memDC, memBmp)
		paint(memDC)
		pBitBlt.Call(hdc, 0, 0, winW, winH, memDC, 0, 0, 0x00CC0020) // SRCCOPY
		pSelectObject.Call(memDC, oldBmp)
		pDeleteObject.Call(memBmp)
		pDeleteDC.Call(memDC)
		pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0

	case wmEraseBkg:
		return 1 // todo el fondo se pinta en WM_PAINT (evita parpadeo)

	case wmMouseMove:
		x := int32(int16(lparam & 0xFFFF))
		y := int32(int16((lparam >> 16) & 0xFFFF))
		h := hitTest(x, y)
		if h != hovered {
			hovered = h
			startHoverAnim()
		}
		if !leaveTracked {
			leaveTracked = true
			tme := trackMouseEventT{DwFlags: 2 /*TME_LEAVE*/, HwndTrack: hwnd}
			tme.CbSize = uint32(unsafe.Sizeof(tme))
			pTrackMouseEvent.Call(uintptr(unsafe.Pointer(&tme)))
		}
		return 0

	case wmMouseLeave:
		leaveTracked = false
		if hovered != hNone {
			hovered = hNone
			startHoverAnim()
		}
		return 0

	case wmSetCursor:
		if hovered != hNone {
			pSetCursor.Call(handCursor)
			return 1
		}
		r, _, _ := pDefWindowProcW.Call(hwnd, msg, wparam, lparam)
		return r

	case wmNcHitTest:
		// Arrastre nativo: el área superior actúa como barra de título,
		// excepto sobre los botones/pills
		x := int32(int16(lparam & 0xFFFF))
		y := int32(int16((lparam >> 16) & 0xFFFF))
		pt := point{x, y}
		pScreenToClient.Call(hwnd, uintptr(unsafe.Pointer(&pt)))
		if pt.Y >= 0 && pt.Y < barH {
			if inRect(btnClose, pt.X, pt.Y) || inRect(btnMin, pt.X, pt.Y) ||
				inRect(pillES, pt.X, pt.Y) || inRect(pillEN, pt.X, pt.Y) {
				return htClient
			}
			return htCaption
		}
		return htClient

	case wmLButtonUp:
		x := int32(lparam & 0xFFFF)
		y := int32((lparam >> 16) & 0xFFFF)
		if inRect(btnClose, x, y) {
			pDestroyWindow.Call(hwnd)
			return 0
		}
		if inRect(btnMin, x, y) {
			pShowWindow.Call(hwnd, swMinimize)
			return 0
		}
		if inRect(pillES, x, y) {
			lang = "es"
			pInvalidateRect.Call(hwnd, 0, 1)
			return 0
		}
		if inRect(pillEN, x, y) {
			lang = "en"
			pInvalidateRect.Call(hwnd, 0, 1)
			return 0
		}
		if inRect(btnMain, x, y) {
			switch view {
			case viewWelcome:
				startInstall()
			case viewInstalling:
				if lastErr != "" {
					startInstall() // reintentar
				}
			case viewDone, viewUninstalled:
				pDestroyWindow.Call(hwnd)
			case viewConfirmUn:
				doUninstall()
				installed = false
				view = viewUninstalled
				pInvalidateRect.Call(hwnd, 0, 1)
			}
		} else if inRect(btnSecond, x, y) {
			switch view {
			case viewWelcome:
				if installed {
					view = viewConfirmUn
					pInvalidateRect.Call(hwnd, 0, 1)
				}
			case viewConfirmUn:
				view = viewWelcome
				pInvalidateRect.Call(hwnd, 0, 1)
			case viewUninstalled:
				view = viewWelcome
				pInvalidateRect.Call(hwnd, 0, 1)
			}
		}
		return 0

	case wmTimer:
		switch wparam {
		case 1: // throbber de instalación
			spinAngle += 0.28
			if spinAngle > math.Pi*2 {
				spinAngle -= math.Pi * 2
			}
			pInvalidateRect.Call(hwnd, 0, 0)
		case 2: // fade de hover
			settled := true
			for _, id := range []int{hMain, hSecond, hES, hEN, hMin, hClose} {
				target := 0.0
				if id == hovered {
					target = 1.0
				}
				p := hoverP[id]
				if p < target {
					p += 0.18
					if p > target {
						p = target
					}
				} else if p > target {
					p -= 0.18
					if p < target {
						p = target
					}
				}
				hoverP[id] = p
				if p != target {
					settled = false
				}
			}
			if settled {
				hoverTicking = false
				pKillTimer.Call(hwnd, 2)
			}
			pInvalidateRect.Call(hwnd, 0, 0)
		}
		return 0

	case wmApp + 1: // progreso de un paso
		i := int(wparam)
		stepStatus[i] = int(lparam)
		if int(lparam) == 2 && i+1 < len(stepStatus) {
			stepStatus[i+1] = 1
		} else if int(lparam) == 3 {
			pKillTimer.Call(hwnd, 1) // fallo: detener el throbber
		}
		pInvalidateRect.Call(hwnd, 0, 1)
		return 0

	case wmApp + 2: // instalación completa
		pKillTimer.Call(hwnd, 1)
		view = viewDone
		installed = true
		pInvalidateRect.Call(hwnd, 0, 1)
		return 0

	case wmDestroy:
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, msg, wparam, lparam)
	return r
}

// Decodifica un PNG componiendo el alpha sobre #141414 y convirtiendo a BGRA
func decodeSprite(data []byte) *sprite {
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	b := img.Bounds()
	s := &sprite{w: int32(b.Dx()), h: int32(b.Dy())}
	s.pix = make([]byte, b.Dx()*b.Dy()*4)
	const bgR, bgG, bgB = 0x14, 0x14, 0x14
	i := 0
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			af := float64(a) / 65535
			s.pix[i] = byte(float64(bl>>8)*af + bgB*(1-af))
			s.pix[i+1] = byte(float64(g>>8)*af + bgG*(1-af))
			s.pix[i+2] = byte(float64(r>>8)*af + bgR*(1-af))
			s.pix[i+3] = 255
			i += 4
		}
	}
	return s
}

func drawSprite(hdc uintptr, x, y int32, s *sprite) {
	if s == nil {
		return
	}
	hdr := bitmapInfoHeader{
		Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: s.w,
		Height: -s.h, Planes: 1, BitCount: 32, Compression: 0,
	}
	pStretchDIBits.Call(hdc, uintptr(x), uintptr(y), uintptr(s.w), uintptr(s.h),
		0, 0, uintptr(s.w), uintptr(s.h),
		uintptr(unsafe.Pointer(&s.pix[0])), uintptr(unsafe.Pointer(&hdr)),
		0, 0x00CC0020)
}

func loadStepSprites() {
	read := func(name string) *sprite {
		data, err := stepsFS.ReadFile("assets/steps/" + name + ".png")
		if err != nil {
			return nil
		}
		return decodeSprite(data)
	}
	spritePending = read("pending")
	spriteDone = read("done")
	spriteFail = read("fail")
	for i := 0; i < 24; i++ {
		spinFrames[i] = read(fmt.Sprintf("spin%02d", i))
	}
}

func loadLogo() {
	img, err := png.Decode(bytes.NewReader(logoPng))
	if err != nil {
		return
	}
	b := img.Bounds()
	logoW, logoH = int32(b.Dx()), int32(b.Dy())
	out := image.NewRGBA(b)
	// Componer alpha sobre el fondo #141414 y convertir RGBA→BGRA
	const bgR, bgG, bgB = 0x14, 0x14, 0x14
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			af := float64(a) / 65535
			rr := byte(float64(r>>8)*af + bgR*(1-af))
			gg := byte(float64(g>>8)*af + bgG*(1-af))
			bb := byte(float64(bl>>8)*af + bgB*(1-af))
			i := out.PixOffset(x, y)
			out.Pix[i], out.Pix[i+1], out.Pix[i+2], out.Pix[i+3] = bb, gg, rr, 255
		}
	}
	logoImg = out
}

func makeFont(height int32, weight int32) uintptr {
	f, _, _ := pCreateFontW.Call(uintptr(height), 0, 0, 0, uintptr(weight),
		0, 0, 0, 0, 0, 0, 4 /*CLEARTYPE*/, 0,
		uintptr(unsafe.Pointer(utf16p("Segoe UI"))))
	return f
}

func runUI() {
	runtime.LockOSThread()
	pSetProcessDPIAware.Call()

	// Idioma por defecto del sistema
	langID, _, _ := pGetUserDefaultUILang.Call()
	if langID&0x3FF == 0x0A { // español
		lang = "es"
	}

	installed = isInstalled()
	loadLogo()
	loadStepSprites()

	fontTitle = makeFont(-26, 700)
	fontBody = makeFont(-15, 400)
	fontSmall = makeFont(-12, 400)
	fontBtn = makeFont(-15, 700)
	var emojiH int32 = -17
	fe, _, _ := pCreateFontW.Call(uintptr(emojiH), 0, 0, 0, 400,
		0, 0, 0, 0, 0, 0, 4, 0,
		uintptr(unsafe.Pointer(utf16p("Segoe UI Emoji"))))
	fontEmoji = fe

	hInst, _, _ := pGetModuleHandleW.Call(0)
	cursor, _, _ := pLoadCursorW.Call(0, 32512) // IDC_ARROW
	hc, _, _ := pLoadCursorW.Call(0, 32649)     // IDC_HAND
	handCursor = hc
	className := utf16p("TsukiSetupWnd")

	// Ícono embebido como recurso (rsrc): título de ventana + taskbar
	appIcon, _, _ := pLoadIconW.Call(hInst, 1)

	wc := wndClassExW{
		CbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		LpfnWndProc:   syscall.NewCallback(wndProc),
		HInstance:     hInst,
		HCursor:       cursor,
		HIcon:         appIcon,
		LpszClassName: className,
	}
	wc.HIconSm = appIcon
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	sw, _, _ := pGetSystemMetrics.Call(0)
	sh, _, _ := pGetSystemMetrics.Call(1)
	x := (int32(sw) - winW) / 2
	y := (int32(sh) - winH - 40) / 2

	hwnd, _, _ := pCreateWindowExW.Call(wsExAppWindow,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16p("Tsuki Setup"))),
		wsPopup|wsVisible,
		uintptr(x), uintptr(y), winW, winH,
		0, 0, hInst, 0)
	hwndMain = hwnd

	// Esquinas redondeadas de Windows 11 (no-op silencioso en Win10)
	pref := int32(2) // DWMWCP_ROUND
	pDwmSetWindowAttr.Call(hwnd, 33, uintptr(unsafe.Pointer(&pref)), 4)

	pShowWindow.Call(hwnd, 1)

	var m msgT
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}
