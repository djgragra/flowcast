# FlowCast

Desktop app that automates the production and delivery of radio shows and audio programs.
FlowCast picks up the audio files your playout or production system exports, converts and joins them with FFmpeg, and delivers the result by FTP, to a local folder and to an archive, on a schedule, with email and Telegram alerts when something goes wrong.
It runs on **Windows, macOS and Linux**.

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
- **Dashboard** with statistics: productions per day (7/14/30 days), per show and per hour, success rate, audio produced, average production time, recent activity and shows with errors
- **Schedule** view with all show cards (search, filters, sorting) and a **timeline** of the next 24 hours or 7 days; the sidebar lists the **next productions in the queue** and a top bar shows the next production with a countdown
- **Categories** with colours: shows grouped in the sidebar and counted in the statistics
- **Console** with the live output of every production
- **Email alerts** (SMTP) on errors and when a source file has not been updated for 3 consecutive runs; server certificates are verified (self-signed certificates can be allowed explicitly)
- **Telegram alerts** through your own bot, with the same text as the emails
- **Dry run** to test a show without uploading or copying anything
- Tray icon with quick-run menu, configurable close behaviour, start at login
- Configuration export and import (backup / migration)
- **Updates**: checks GitHub for a new release at startup and every 24 hours; *Download and install* fetches the installer, verifies its SHA-256 and runs it only when you press *Close and install* (the check can be turned off in Settings → Info)
- **User manual** (PDF, English and Italian) attached to every release and one click away from the in-app Guide
- Interface in **English, Italian and Spanish**

## Requirements

- **Windows 10 or 11** (64-bit), **macOS 13 Ventura or later** (Intel and Apple silicon) or **Linux** 64-bit (AppImage)
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

**macOS**: `brew install ffmpeg`. FlowCast finds it in `/opt/homebrew/bin` or `/usr/local/bin` even when started from the Finder. The Homebrew build has no `libvorbis`, so OGG output is not available with it.
**Linux**: install your distribution's `ffmpeg` package (e.g. `sudo apt install ffmpeg`).

If you only use the *Direct copy* output format with a single source file, FFmpeg is not needed.

## Install

Download the file for your system from the [Releases](../../releases) page. Each release also has the user manual (`FlowCast-Manual-<version>.pdf`, `FlowCast-Manuale-<version>.pdf`), a zip with everything (`FlowCast-<version>.zip`) and `SHA256SUMS.txt`.

| System | File |
|---|---|
| Windows | `FlowCast-Setup-<version>.exe` |
| macOS (Apple silicon) | `FlowCast-<version>-arm64.dmg` |
| macOS (Intel) | `FlowCast-<version>-x64.dmg` |
| Linux | `FlowCast-<version>-x86_64.AppImage` |

Check a file against `SHA256SUMS.txt`:

```powershell
Get-FileHash .\FlowCast-Setup-<version>.exe -Algorithm SHA256
```

```bash
shasum -a 256 FlowCast-<version>-arm64.dmg
```

FlowCast is **not code-signed**:

- **Windows**: SmartScreen may show "Windows protected your PC": click *More info* → *Run anyway*.
- **macOS**: drag FlowCast to *Applications*. The first time, macOS blocks it: open *System Settings → Privacy & Security* and press *Open Anyway*.
- **Linux**: `chmod +x FlowCast-*.AppImage` and run it (some distributions need `libfuse2`). Start at login is not available on Linux.

Once installed, FlowCast updates itself on request: *Download and install* in the update bar, then *Close and install*.

## Where data is stored

| System | Folder |
|---|---|
| Windows | `%APPDATA%\flowcast\` |
| macOS | `~/Library/Application Support/flowcast/` |
| Linux | `~/.config/flowcast/` |

- `data.json`: shows, settings and FTP bookmarks
- `stats.json`: daily statistics for the dashboard
- `work/<slug>/`: temporary working files
- `logs/`: one log per show
- `history/`: run history per show

**Note:** FTP and SMTP passwords and the Telegram bot token are stored in `data.json` in plain text, and are included in configuration exports. Protect those files accordingly.

## Privacy

FlowCast has no telemetry. Besides the FTP and SMTP servers (and Telegram, if you enable it) that you configure, the only connection it makes is the update check to GitHub (which sees your IP address and the FlowCast version). Turn it off in Settings → Info → *Updates*.

## Build from source

Requires Node.js 22 and npm.

```bash
npm ci
npm start              # run in development
npm run build          # Windows NSIS installer (x64) in dist/
npm run build:mac      # macOS dmg (x64 and arm64)
npm run build:linux    # Linux AppImage (x64)
npm run manual         # user manuals (PDF, EN and IT) in dist/
npm run release:local  # download a published release into release/<version>/ and verify it
```

Releases are built by GitHub Actions when a `v*` tag is pushed (`.github/workflows/build-installers.yml`) on Windows, macOS and Linux runners. The workflow checks that the tag matches `package.json` and is newer than the latest release, then attaches the installers, the manuals, a zip with everything and `SHA256SUMS.txt` to the GitHub Release.

## Contact

Graziano Melzi · OnAir Garage, hello@onairgarage.com

## License

[MIT](LICENSE) © 2026 Graziano Melzi

FFmpeg is a separate project, licensed under the LGPL/GPL, and is not distributed with FlowCast.
