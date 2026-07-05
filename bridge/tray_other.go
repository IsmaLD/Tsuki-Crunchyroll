//go:build !windows

package main

func startTray(s *bridgeState) {}
func setTrayTip(text string)   {}
func removeTray()              {}
