'use strict';
// FlowCast user manual — English. {{shot:name}} is replaced by a screenshot of the app.

module.exports = {
  file:     'FlowCast-Manual',
  title:    'User Manual',
  contents: 'Contents',
  version:  'Version',
  figure:   'Figure',
  page:     'Page',
  intro: `FlowCast automates the production and delivery of radio shows and audio programs.
It picks up the audio files your playout or production system exports, converts and joins them with FFmpeg,
and delivers the result by FTP, to a local folder and to an archive — on a schedule, with email alerts when something goes wrong.`,

  shots: {
    'dashboard':        'Dashboard with the statistics',
    'schedule':         'Schedule — the shows',
    'timeline':         'Schedule — timeline of the next 7 days',
    'show-general':     'Show — General tab',
    'show-sources':     'Show — Audio Sources tab',
    'show-schedule':    'Show — Schedule tab',
    'show-output':      'Show — Output & FTP tab',
    'settings-email':   'Settings — Email alerts',
    'settings-general': 'Settings — General',
    'settings-info':    'Settings — Info and updates',
  },

  chapters: [
    { title: 'Requirements', html: `
<table>
<tr><th>Component</th><th>Requirement</th></tr>
<tr><td>Operating system</td><td>Windows 10 or 11 (64-bit) · macOS 13 Ventura or later (Intel and Apple silicon) · Linux 64-bit (AppImage)</td></tr>
<tr><td>FFmpeg</td><td>Installed separately, version 4.3 or later (see chapter 3). Not needed for <em>Direct copy</em> of a single file.</td></tr>
<tr><td>Network</td><td>Only for FTP upload, email alerts and the update check</td></tr>
</table>
<p>FlowCast must be running (even minimized to the system tray) for scheduled shows to start.</p>` },

    { title: 'Installation and first launch', html: `
<ol>
<li>Download the file for your system from <code>github.com/djgragra/flowcast/releases</code> (link also on onairgarage.com): <code>FlowCast-Setup-&lt;version&gt;.exe</code> for Windows, <code>FlowCast-&lt;version&gt;-arm64.dmg</code> (Apple silicon) or <code>-x64.dmg</code> (Intel) for macOS, <code>FlowCast-&lt;version&gt;-x86_64.AppImage</code> for Linux.</li>
<li>Optional: check the file against <code>SHA256SUMS.txt</code> published with the release. In PowerShell:<br><code>Get-FileHash .\\FlowCast-Setup-&lt;version&gt;.exe -Algorithm SHA256</code></li>
<li>Run the installer. The installer is not code-signed, so Windows SmartScreen may show <em>Windows protected your PC</em>: click <strong>More info → Run anyway</strong>.</li>
<li>Choose the installation folder (default <code>%LOCALAPPDATA%\\Programs\\FlowCast</code>) and follow the wizard.</li>
<li>Start FlowCast from the Start menu or the desktop shortcut.</li>
</ol>
<h3>macOS</h3>
<p>Open the <code>.dmg</code> and drag FlowCast into <em>Applications</em>. FlowCast is not signed by Apple, so the first time macOS blocks it: open <em>System Settings → Privacy &amp; Security</em> and press <strong>Open Anyway</strong> next to the FlowCast message.</p>
<h3>Linux</h3>
<p>Make the AppImage executable (<code>chmod +x FlowCast-*.AppImage</code>) and start it. On some distributions AppImages need the <code>libfuse2</code> package. Start at login is not available on Linux.</p>
<p>All data (shows, settings, logs, history) is kept when you update or reinstall; its folder is shown in <em>Settings → Info</em> (see chapter 17).</p>
<div class="note"><strong>Updating from version 26.5.0 or earlier.</strong> Those versions were installed with a different application ID, so the new installer does not replace them. Export a backup (chapter 16), quit FlowCast from the tray, uninstall the old FlowCast from <em>Settings → Apps</em>, then install the new version. Your shows and settings are kept.</div>` },

    { title: 'Installing FFmpeg', html: `
<p>FlowCast calls FFmpeg as an external program to convert and join audio. FFmpeg is free and open source, but it is not included in FlowCast.</p>
<ol>
<li>Download a Windows build, for example from <code>gyan.dev/ffmpeg/builds</code> (the <em>essentials</em> build is enough) or <code>github.com/BtbN/FFmpeg-Builds</code>.</li>
<li>Unzip it, for example to <code>C:\\ffmpeg</code>.</li>
<li>Either add <code>C:\\ffmpeg\\bin</code> to the system PATH, or open <em>Settings → General → Tools</em> and set <strong>FFmpeg path</strong> to <code>C:\\ffmpeg\\bin\\ffmpeg.exe</code>.<br>With winget: <code>winget install Gyan.FFmpeg</code>, then restart FlowCast.</li>
<li>Press <strong>Test</strong> next to the FFmpeg path: FlowCast shows the FFmpeg version and any output format your build cannot encode.</li>
</ol>
<p><strong>macOS</strong>: <code>brew install ffmpeg</code> (Homebrew). FlowCast finds it by itself in <code>/opt/homebrew/bin</code> or <code>/usr/local/bin</code>. The Homebrew build has no <code>libvorbis</code>, so OGG output is not available with it. <strong>Linux</strong>: install the <code>ffmpeg</code> package of your distribution (e.g. <code>sudo apt install ffmpeg</code>).</p>
<p>If FFmpeg cannot be started, or cannot encode a format used by one of your shows, a warning appears under the top bar.</p>
<p><strong>Tested versions</strong> (all output formats, including joining several files): 4.3.1, 4.4.1, 5.1.2, 6.1.1, 7.1.1, 8.1.2 and 9.0.2. OGG output needs the <code>libvorbis</code> encoder and MP3 needs <code>libmp3lame</code>: the gyan.dev and BtbN builds include both.</p>` },

    { title: 'Quick start: your first show', html: `
<ol>
<li>Open <strong>⚙ Settings</strong> (bottom of the sidebar): set the FFmpeg path if needed, optionally the <em>WAV sources BASE path</em> and <em>Archive BASE path</em>, then <strong>💾 Save</strong>.</li>
<li>Press <strong>+ Show</strong> in the sidebar.</li>
<li><em>General</em>: program name, slug (output file name), format and bitrate.</li>
<li><em>Audio Sources</em>: add the audio files that make up the episode, in order.</li>
<li><em>Schedule</em>: time and frequency, or choose <em>Manual</em> mode on the General tab.</li>
<li><em>Output &amp; FTP</em>: FTP upload and/or a local output folder. Use <strong>🔌 Test connection</strong>.</li>
<li><strong>💾 Save</strong>, then run a <strong>🧪 Dry Run</strong> to check everything without uploading or copying.</li>
</ol>
{{shot:schedule}}` },

    { title: 'Show settings', html: `
<p>Each show has these tabs:</p>
<table>
<tr><th>Tab</th><th>Contents</th></tr>
<tr><td>General</td><td>Program name, category, slug, output format, bitrate, execution mode (Scheduled / Manual)</td></tr>
<tr><td>Audio Sources</td><td>Source BASE path and the list of audio files, joined in this order</td></tr>
<tr><td>Schedule</td><td>Time, frequency, days, start and end date</td></tr>
<tr><td>Output &amp; FTP</td><td>FTP upload, local output folder</td></tr>
<tr><td>Archive</td><td>Optional copy of every produced episode</td></tr>
<tr><td>History</td><td>Result of the latest runs</td></tr>
<tr><td>Log</td><td>Detailed output of the last run</td></tr>
</table>
{{shot:show-general}}
<h3>Slug</h3>
<p>The slug is the start of the output file name: slug <code>morning-news</code> produces <code>morning-news_27-09-2026_07-10.mp3</code>. It also names the working folder. Changing the show name does not change the slug.</p>
<h3>Audio sources and the Check box</h3>
<p>Paths can be absolute or relative to the Source BASE path. The <strong>Check for updates</strong> box marks the files that must have changed since the last run: a show is produced only when all checked files are newer. Uncheck fixed elements such as jingles or intros, so they are always included.</p>
{{shot:show-sources}}
<h3>Path variables</h3>
<p>In the local output folder and archive subfolder you can use variables replaced with the production date: <code>%ANNO%</code> (year), <code>%MESE%</code> (month), <code>%GIORNO%</code> (day), <code>%ORA%</code> (hour). Example: <code>D:\\Archive\\%ANNO%\\%MESE%\\</code> → <code>D:\\Archive\\2026\\09\\</code>.</p>` },

    { title: 'Scheduling', html: `
<table>
<tr><th>Frequency</th><th>Runs</th></tr>
<tr><td>Every day</td><td>every day at the set time</td></tr>
<tr><td>Monday–Friday</td><td>on weekdays</td></tr>
<tr><td>Saturday–Sunday</td><td>at the weekend</td></tr>
<tr><td>Specific days</td><td>on the days you select</td></tr>
</table>
<p>Times follow the clock of the computer. The <em>Validity period</em> limits a show to a start and an end date — useful for seasonal programs. When the end date has passed, the show is disabled at the next start and marked 📅 on the dashboard; to run it again, clear or move the end date and enable it.</p>
{{shot:show-schedule}}
<h3>Catch-up</h3>
<p>If the computer was off or FlowCast was closed at the scheduled time, at the next start FlowCast runs the shows scheduled for today whose time has passed and that have not run yet (after 8 seconds, 3 seconds apart). Catch-up only applies to enabled shows within their validity period.</p>` },

    { title: 'Running a show', html: `
<ul>
<li><strong>▶ Run now</strong>: normal run, with the source update check.</li>
<li><strong>⚡ Force</strong>: ignores the update check and always produces.</li>
<li><strong>🧪 Dry Run</strong>: processes the audio but does not upload, copy or archive, and does not update the check date. Ideal to test a new show.</li>
</ul>
<p>Shows in <em>Manual</em> mode never start on their own, but can be run with all three buttons. Enabled scheduled shows can also be started from the tray menu.</p>
<h3>What happens during a run</h3>
<ol>
<li>Check that the checked source files are newer than the last production (<code>verifica_data.txt</code>).</li>
<li>Copy the sources to the working folder.</li>
<li>Convert each part with FFmpeg (skipped in Direct copy mode).</li>
<li>Join the parts into one file named <code>slug_DD-MM-YYYY_HH-NN.ext</code>.</li>
<li>Copy to the archive and to the local output folder, if configured.</li>
<li>Upload by FTP, if enabled (3 attempts).</li>
<li>Update the check date and remove temporary files.</li>
</ol>` },

    { title: 'FTP and bookmarks', html: `
<p>FTP servers are saved as <strong>bookmarks</strong> in <em>Settings → FTP</em>: <strong>+ New</strong> creates one, <strong>✏ Edit</strong> changes it.</p>
<p>In a show, open <em>Output &amp; FTP</em>, choose a bookmark and press <strong>▶ Load</strong>: host, port, user and password are copied into the show. The <em>Remote folder</em> belongs to each show; the <strong>📂</strong> button lists the folders on the server.</p>
<p><strong>💾 Save &amp; propagate</strong> updates the credentials of every show linked to the bookmark: change a password once and all shows use it.</p>
{{shot:show-output}}
<p>Use <strong>🔌 Test connection</strong> before going live. If the server supports it, enable <em>Use FTPS (SSL/TLS)</em>: with plain FTP the password travels unencrypted.</p>` },

    { title: 'Output formats', html: `
<table>
<tr><th>Format</th><th>Notes</th></tr>
<tr><td>MP3 (default)</td><td>constant bitrate (CBR), FFmpeg encoder <code>libmp3lame</code></td></tr>
<tr><td>AAC</td><td>FFmpeg native AAC encoder</td></tr>
<tr><td>OGG Vorbis</td><td>FFmpeg encoder <code>libvorbis</code></td></tr>
<tr><td>Direct copy</td><td>no conversion: with one source file FFmpeg is not used; with several it only joins them</td></tr>
</table>
<p>Bitrate: 128k, 192k (default), 256k or 320k.</p>` },

    { title: 'Email alerts', html: `
<p>In <em>Settings → Email</em> FlowCast can send an email:</p>
<ul>
<li><strong>on error</strong>: when a show fails, or an upload, copy or archive step fails;</li>
<li><strong>if the file is not updated</strong>: after 3 consecutive runs without new source files — a sign that the upstream system stopped producing them.</li>
</ul>
<p>Set the SMTP server, port, user, password, sender and up to three recipients, then press <strong>📧 Test SMTP</strong>.</p>
{{shot:settings-email}}
<p><strong>Certificates.</strong> FlowCast checks the certificate of the mail server, and the server name must match it. Many providers use a different name for their SMTP server than your own domain: use the name given by your provider. <em>Allow self-signed certificates</em> is meant only for internal servers you trust.</p>
<h3>Telegram</h3>
<p>The same alerts can also be sent to Telegram (same page, <em>Telegram alerts</em>):</p>
<ol>
<li>In Telegram, write to <strong>@BotFather</strong>, create a bot (<code>/newbot</code>) and copy its <em>token</em>.</li>
<li>Send a message to your bot, or add it to a group. Find the <em>chat ID</em> with <strong>@userinfobot</strong> or by opening <code>api.telegram.org/bot&lt;token&gt;/getUpdates</code>.</li>
<li>Paste token and chat ID, choose the alerts and press <strong>✈ Test Telegram</strong>, then save.</li>
</ol>` },

    { title: 'Dashboard', html: `
<p>The <strong>top bar</strong>, always visible, shows the clock, the <em>next production</em> with a countdown and the shows <em>in production</em> right now.</p>
<p>The <strong>Dashboard</strong> page shows the statistics of your productions:</p>
<ul>
<li>shows in total and enabled, productions queued in the next 24 hours, produced and failed today;</li>
<li>success rate over the last 30 days, audio produced and average production time;</li>
<li>the <strong>activity</strong> chart for the last 7, 14 or 30 days (green = produced, red = failed), productions per show and per hour of the day;</li>
<li>next 24 hours, recent activity, shows with errors and shows by category.</li>
</ul>
{{shot:dashboard}}
<p>Click a row to open the show, or a category to filter the sidebar. A production whose upload, copy or archive step failed counts as failed. The statistics are kept day by day in <code>stats.json</code>; after updating from an older version they are rebuilt from the run history.</p>
<p>Bars under the top bar warn if FFmpeg is missing or cannot encode a format in use, and announce a new version (chapter 15).</p>` },

    { title: 'Schedule, queue and categories', html: `
<p><strong>Schedule</strong> (sidebar) has two views:</p>
<ul>
<li><strong>Shows</strong>: a card for each show with schedule, last result, next run and the result of each step (📁 local, 📡 FTP, 🗄 archive: green = ok, red = error, grey = skipped). <strong>Search</strong> by name, <strong>filters</strong> (All, Active, Enabled, Disabled, With error, Expired) and <strong>sorting</strong> by name, schedule or last run.</li>
<li><strong>Timeline</strong>: every production of the next 24 hours or 7 days, day by day, with time, format, destinations and countdown.</li>
</ul>
{{shot:timeline}}
<p>Under the navigation buttons the sidebar lists the <strong>next productions in the queue</strong>; the first one is highlighted. Below it are the shows, each with its status (OK, Error, Off…) and next run.</p>
<p><strong>Categories.</strong> In the General tab of a show you can set a category (e.g. News, Music, Weekend). The sidebar groups shows by category, each with its own colour; the dashboard counts them per category, and clicking a category there filters the sidebar (✕ removes the filter).</p>` },

    { title: 'Settings', html: `
<table>
<tr><th>Option</th><th>Description</th></tr>
<tr><td>WAV sources BASE path</td><td>common prefix for the audio files of all shows</td></tr>
<tr><td>Archive BASE path</td><td>common prefix for the archive folders</td></tr>
<tr><td>FFmpeg path and Test</td><td>see chapter 3</td></tr>
<tr><td>FTP timeout</td><td>seconds before an FTP operation gives up (default 30)</td></tr>
<tr><td>Start at login</td><td>starts FlowCast at login, optionally minimized (Windows and macOS)</td></tr>
<tr><td>When pressing X</td><td>Auto (minimize if scheduled shows exist), always minimize to tray, or always quit</td></tr>
<tr><td>Language</td><td>English, Italiano, Español</td></tr>
<tr><td>Theme</td><td>☀️/🌙 button in the title bar</td></tr>
</table>
{{shot:settings-general}}` },

    { title: 'System tray', html: `
<p>FlowCast keeps running in the notification area (the menu bar on macOS) when the window is closed, depending on the <em>When pressing X</em> setting. Double-click the icon to open the window. Right-click for <em>Run now</em> on each enabled scheduled show, and <strong>Quit</strong> to close FlowCast completely.</p>` },

    { title: 'Updates', html: `
<p>FlowCast checks for a new version at startup and every 24 hours. When one is available, a bar appears under the title bar:</p>
<ol>
<li>Press <strong>Download and install</strong>: FlowCast downloads the installer to your <em>Downloads</em> folder and checks it against the SHA-256 checksum of the release.</li>
<li>Press <strong>Close and install</strong>: FlowCast closes and the installer starts. Follow the wizard as for the first installation.</li>
</ol>
<p><strong>Ignore this version</strong> hides the bar until a newer version is released. Nothing is installed until you press the button; if the download fails, <strong>Open download page</strong> opens the release on GitHub.</p>
<p>In <em>Settings → Info → Updates</em> you can check manually or turn the automatic check off.</p>
{{shot:settings-info}}
<p>Shows and settings are kept. The <strong>📖 User manual (PDF)</strong> button (in the Guide and in <em>Settings → Info</em>) opens this manual for the installed version.</p>` },

    { title: 'Backup and moving to another PC', html: `
<p>In <em>Settings → Backup</em>:</p>
<ul>
<li><strong>💾 Export all</strong> saves shows, settings and FTP bookmarks to a JSON file;</li>
<li><strong>📥 Import</strong> loads a backup: <em>OK</em> replaces everything, <em>Cancel</em> adds only the shows that are missing.</li>
</ul>
<p>To move FlowCast: export on the old PC, install FlowCast on the new one, import. Export a backup before every update.</p>
<div class="note"><strong>The backup contains FTP and SMTP passwords in plain text.</strong> Keep it in a safe place and delete copies you no longer need.</div>` },

    { title: 'Files and logs', html: `
<p>The data folder is <code>%APPDATA%\\flowcast</code> on Windows, <code>~/Library/Application Support/flowcast</code> on macOS and <code>~/.config/flowcast</code> on Linux; <em>Settings → Info</em> shows the exact path.</p>
<table>
<tr><th>File or folder</th><th>Contents</th></tr>
<tr><td><code>data.json</code></td><td>shows, settings and bookmarks</td></tr>
<tr><td><code>stats.json</code></td><td>daily statistics for the dashboard</td></tr>
<tr><td><code>work/&lt;slug&gt;/</code></td><td>working files</td></tr>
<tr><td><code>logs/</code></td><td>one log per show, <code>_system.log</code> for general errors</td></tr>
<tr><td><code>history/</code></td><td>run history</td></tr>
</table>
<p>The <strong>Console</strong> at the bottom of the window shows the live output of every production; click its bar to open or close it.</p>
<p>The <em>Log</em> tab of each show has <strong>📁 Folder</strong>, <strong>💾 Export</strong> and <strong>🗑 Clear</strong>.</p>` },

    { title: 'FAQ and troubleshooting', html: `
<h3>A show does not start at the scheduled time</h3>
<p>FlowCast must be running, even minimized to the tray. Check that the show is enabled, in Scheduled mode and within its validity period. If the PC was off, catch-up runs it at the next start.</p>
<h3>“No update detected” but the files are new</h3>
<p>All sources with <em>Check for updates</em> must be newer than the last production. Uncheck fixed files (jingles, intros), or use <strong>⚡ Force</strong> once.</p>
<h3>FFmpeg error</h3>
<p>Press <strong>Test</strong> next to the FFmpeg path. <em>Not found</em>: set the full path to <code>ffmpeg.exe</code>. <em>Unknown encoder</em>: your build lacks an encoder (for example <code>libvorbis</code> for OGG); install a gyan.dev or BtbN build.</p>
<h3>FTP upload failed</h3>
<ul><li>Check host, port and credentials with <strong>🔌 Test connection</strong>.</li><li>Check that the remote folder exists (<strong>📂</strong> button).</li><li>For FTPS enable <em>Use FTPS (SSL/TLS)</em>; increase the FTP timeout on slow connections.</li></ul>
<h3>Email test fails with a certificate error</h3>
<p>The server name does not match its certificate: use the SMTP server name given by your provider (chapter 10).</p>
<h3>macOS says FlowCast cannot be opened</h3>
<p>FlowCast is not signed by Apple. Open <em>System Settings → Privacy &amp; Security</em> and press <strong>Open Anyway</strong> (chapter 2).</p>
<h3>Two FlowCast entries in <em>Apps</em></h3>
<p>You installed over version 26.5.0 or earlier. Export a backup, uninstall both entries, install the new version and import the backup if needed.</p>` },

    { title: 'Support, privacy and license', html: `
<p>FlowCast is free and open source, made by Graziano Melzi · OnAir Garage.</p>
<ul>
<li>Tool page: <code>onairgarage.com/tools/flowcast/</code></li>
<li>Source code and releases: <code>github.com/djgragra/flowcast</code></li>
<li>Contact: <code>hello@onairgarage.com</code></li>
</ul>
<p><strong>Privacy.</strong> FlowCast has no telemetry. Besides the FTP and SMTP servers you configure, it only contacts GitHub (<code>api.github.com</code>) for the update check, which can be turned off.</p>
<p><strong>License.</strong> MIT License, © 2026 Graziano Melzi. FFmpeg is a separate project, licensed under the LGPL/GPL, and is not distributed with FlowCast.</p>` },
  ]
};
