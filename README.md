# FlowCast

Desktop app that automates the production and delivery of radio shows and audio programs.
FlowCast picks up the audio files your playout or production system exports, converts and joins them with FFmpeg, and delivers the result by FTP, to a local folder and to an archive, on a schedule, with email alerts when something goes wrong.

Free and open source, by Graziano Melzi · [OnAir Garage](https://onairgarage.com).
Tool page: https://onairgarage.com/tools/flowcast/

## Features

- **Audio conversion with FFmpeg**: MP3 (CBR), AAC, OGG Vorbis, or direct copy without re-encoding
- **Multi-part shows**: joins several source files (e.g. show + jingles) into one output file
- **Change detection**: a show is produced only when its source files have been updated since the last run
- **FTP upload** with automatic retries and a remote directory browser
- **FTP bookmarks**: edit the credentials once, every show that uses the bookmark is updated
- **Local output folder and archive**, with date variables in paths (`%ANNO%`, `%MESE%`, `%GIORNO%`, `%ORA%`: year, month, day, hour)
- **Scheduler**: daily, weekdays, weekend or specific days, with optional start and end dates; expired shows are disabled automatically
- **Catch-up**: if the computer was off at the scheduled time, missed shows run automatically at the next start
- **Email alerts** (SMTP) on errors and when a source file has not been updated for 3 consecutive runs; server certificates are verified (self-signed certificates can be allowed explicitly)
- **Dry run** to test a show without uploading or copying anything
- Tray icon with quick-run menu, configurable close behaviour, start at login
- Configuration export and import (backup / migration)
- Interface in **English, Italian and Spanish**

## Requirements

- **Windows 10 or 11, 64-bit** (Electron, which FlowCast is built on, no longer supports Windows 7/8/8.1)
- **FFmpeg** (not included, see below)

## Installing FFmpeg

FlowCast calls FFmpeg as an external program and does not ship it. Install it once:

1. Get a Windows build of FFmpeg, for example from https://www.gyan.dev/ffmpeg/builds/ or https://github.com/BtbN/FFmpeg-Builds/releases (the "essentials" or "gpl" build is fine; MP3 output needs `libmp3lame`, which both include).
2. Unzip it, e.g. to `C:\ffmpeg`.
3. Either add `C:\ffmpeg\bin` to the system `PATH`, **or** open FlowCast → Settings → Tools → *FFmpeg path* and select `C:\ffmpeg\bin\ffmpeg.exe`.

With winget: `winget install Gyan.FFmpeg` (then restart FlowCast so it sees the new `PATH`).

Use the **Test** button next to *FFmpeg path* to check it: it shows the FFmpeg version and any output format your build cannot encode. If FFmpeg cannot be started, or cannot encode a format used by one of your shows, FlowCast shows a warning on the dashboard.

**Tested FFmpeg versions** (Windows x64, all four output formats, including joining multiple files): 4.3.1, 4.4.1, 5.1.2, 6.1.1, 7.1.1, 8.1.2 and 9.0.2 (gyan.dev *essentials* builds), plus BtbN 9.0 GPL and LGPL builds. FlowCast only uses long-standing FFmpeg features, so any version from 4.3 on should work.
OGG output needs the `libvorbis` encoder, which some builds leave out (for example the Homebrew build on macOS); MP3 needs `libmp3lame`.

If you only use the *Direct copy* output format with a single source file, FFmpeg is not needed.

## Install

Download the installer (`FlowCast-Setup-<version>.exe`) from the [Releases](../../releases) page.
Check the file against `SHA256SUMS.txt`, published with each release:

```powershell
Get-FileHash .\FlowCast-Setup-<version>.exe -Algorithm SHA256
```

The installer is **not code-signed**, so Windows SmartScreen may show "Windows protected your PC": click *More info* → *Run anyway*.

## Where data is stored

Everything lives in `%APPDATA%\FlowCast\`:

- `data.json`: shows, settings and FTP bookmarks
- `work\<slug>\`: temporary working files
- `logs\`: one log per show
- `history\`: run history per show

**Note:** FTP and SMTP passwords are stored in `data.json` in plain text, and are included in configuration exports. Protect those files accordingly.

## Build from source

Requires Node.js 22 and npm.

```bash
npm ci
npm start              # run in development
npm run build          # Windows NSIS installer (x64) in dist/
npm run build-portable # Windows portable .exe
```

Releases are built by GitHub Actions when a `v*` tag is pushed (`.github/workflows/build-installers.yml`); the workflow attaches the installer and `SHA256SUMS.txt` to the GitHub Release.

## Contact

Graziano Melzi · OnAir Garage, hello@onairgarage.com

## License

[MIT](LICENSE) © 2026 Graziano Melzi

FFmpeg is a separate project, licensed under the LGPL/GPL, and is not distributed with FlowCast.
