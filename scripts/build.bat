@echo off
cd /d "%~dp0.."
if not exist dist mkdir dist

echo - bridge
cd bridge
set GOOS=windows
set GOARCH=amd64
go build -ldflags="-s -w -H windowsgui" -o ..\setup\assets\tsuki-bridge-host.exe . || exit /b 1
go build -ldflags="-s -w" -o ..\dist\tsuki-bridge.exe . || exit /b 1
cd ..

echo - setup
cd setup
go build -ldflags="-s -w -H windowsgui" -o ..\dist\tsuki-setup.exe . || exit /b 1
cd ..

echo listo - dist\
