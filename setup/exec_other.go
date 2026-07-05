//go:build !windows

package main

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}

func runUI() {
	println("Tsuki Setup solo está disponible en Windows.")
}
