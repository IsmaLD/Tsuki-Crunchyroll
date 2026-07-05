#!/usr/bin/env bash
# Compila toda la cadena Tsuki (cross-compile a Windows desde cualquier OS)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist

echo "→ bridge (host embebible + manual + linux)"
( cd bridge
  GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o ../setup/assets/tsuki-bridge-host.exe .
  GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../dist/tsuki-bridge.exe .
  GOOS=linux  GOARCH=amd64 go build -ldflags="-s -w" -o ../dist/tsuki-bridge-linux . )

echo "→ setup (embebe el host)"
( cd setup
  GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o ../dist/tsuki-setup.exe . )

echo "→ paquetes"
( cd dist && zip -qj tsuki-setup.zip tsuki-setup.exe )
( cd extension && zip -qr ../dist/tsuki-extension.zip . )

echo "listo → dist/"
