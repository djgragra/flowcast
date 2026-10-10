# Changelog

Versions use `YY.M.N`. Newest first.

## 26.10.1 — 2026-10-10
- **Alerts rebuilt on the common OnAir Garage rules.** Email goes to several recipients in **one message, all in Bcc** (nobody sees the others' addresses); the recipients are now one field, separated by commas. With an SMTP user name the connection **must be encrypted** (STARTTLS, or SSL/TLS from the start): the password never travels in clear text. Timeouts of 15 s (connection), 15 s (greeting) and 20 s (socket); Telegram 15 s per call.
- **Every alert is tried three times**: right away, again after 10 s and again after 60 s, on both email and Telegram. A channel that fails does not stop the other.
- **Alerts remember what they already said**: the "source not updated" count and the new-version notice survive a restart (new file `alert-state.json`, never part of a backup).
- **Passwords and tokens are encrypted on disk** (SMTP password, Telegram bot token, FTP passwords of shows and bookmarks) with the system keystore (Windows DPAPI, macOS Keychain, Linux Secret Service). Values saved in plain text by earlier versions are encrypted at the first start. Where no keystore exists they are kept as before and Settings → Email says so. They cannot be read on another PC or user account.
- **Backups**: the export has a box **Include passwords and tokens**, off by default. Off, the file has no passwords or tokens; on, a red warning is shown and they are written in plain text. After an import without them FlowCast lists what must be typed again and keeps what the PC already has for the same server and user. Older backups (with passwords) still import.
- **Passwords and tokens are masked** (`***`) in error messages and logs: SMTP password, Telegram token (it is part of the Telegram address) and FTP passwords.
- **New-version notice on desktop, Telegram and email**, once per version (Settings → Info → Updates; it needs Telegram or email switched on). A version is marked as announced only after the message was delivered, so a failed send is tried again at the next check.
- **Categories**: a new button renames a category in all its shows and keeps its colour; another deletes it and asks where to move its shows (another category or *No category*). Renaming into a name that already exists merges the two (Settings → General → Categories and colors).
- The Telegram text always says it comes from FlowCast, for bots shared with other programs.
- The in-app Guide (English, Italian, Spanish), the PDF manuals and the README describe all of the above.
- Unit tests (`npm test`) run before every build.
- Texts in English, Italian and Spanish (same keys in all three, checked by a test).
