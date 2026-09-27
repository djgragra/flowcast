'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getSettings:    ()   => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s)  => ipcRenderer.invoke('save-settings', s),

  // Shows
  getShows:       ()   => ipcRenderer.invoke('get-shows'),
  getShow:        (id) => ipcRenderer.invoke('get-show', id),
  saveShow:       (s)  => ipcRenderer.invoke('save-show', s),
  deleteShow:     (id) => ipcRenderer.invoke('delete-show', id),
  newId:          ()   => ipcRenderer.invoke('new-id'),

  // Run (force: skip date check; dryRun: skip upload/copy)
  runShow:        (id, force, dryRun) => ipcRenderer.invoke('run-show', id, force, dryRun),
  getRunStatus:   (id) => ipcRenderer.invoke('get-run-status', id),

  // Logs
  getLog:         (id) => ipcRenderer.invoke('get-log', id),
  clearLog:       (id) => ipcRenderer.invoke('clear-log', id),
  exportLog:      (id) => ipcRenderer.invoke('export-log', id),
  openLogFolder:  ()   => ipcRenderer.invoke('open-log-folder'),

  // FTP test
  testFtp:        (cfg) => ipcRenderer.invoke('test-ftp', cfg),

  // Email test
  testEmail:      (cfg) => ipcRenderer.invoke('test-email', cfg),

  // FFmpeg check (optional path; default: path from settings)
  checkFfmpeg:    (p)   => ipcRenderer.invoke('check-ffmpeg', p),

  // App version
  getAppVersion:  ()    => ipcRenderer.invoke('get-app-version'),

  // Update notice
  checkUpdates:   ()    => ipcRenderer.invoke('check-updates'),
  getUpdateInfo:  ()    => ipcRenderer.invoke('get-update-info'),
  dismissUpdate:  (v)   => ipcRenderer.invoke('dismiss-update', v),
  openUpdate:     ()    => ipcRenderer.invoke('open-update'),
  downloadUpdate: ()    => ipcRenderer.invoke('download-update'),
  installUpdate:  ()    => ipcRenderer.invoke('install-update'),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, d) => cb(d)),
  openManual:     ()    => ipcRenderer.invoke('open-manual'),
  platform:       process.platform,
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, d) => cb(d)),

  // Next run time
  nextRun:        (show) => ipcRenderer.invoke('next-run', show),
  getNextTask:    ()     => ipcRenderer.invoke('get-next-task'),

  // Browse dialogs
  browseFolder:   ()        => ipcRenderer.invoke('browse-folder'),
  browseFile:     (filters) => ipcRenderer.invoke('browse-file', filters),

  // History
  getHistory:     (id) => ipcRenderer.invoke('get-history', id),
  clearHistory:   (id) => ipcRenderer.invoke('clear-history', id),

  // Config export/import
  exportConfig: ()     => ipcRenderer.invoke('export-config'),
  importConfig: ()     => ipcRenderer.invoke('import-config'),

  // FTP bookmarks
  getFtpBookmarks:   ()    => ipcRenderer.invoke('get-ftp-bookmarks'),
  saveFtpBookmark:   (bm)  => ipcRenderer.invoke('save-ftp-bookmark', bm),
  deleteFtpBookmark: (id)  => ipcRenderer.invoke('delete-ftp-bookmark', id),

  // FTP directory browser
  ftpBrowse: (params) => ipcRenderer.invoke('ftp-browse', params),

  // Duplicate show
  duplicateShow: (id) => ipcRenderer.invoke('duplicate-show', id),

  // Events from main
  onLogLine:      (cb)  => ipcRenderer.on('log-line',     (_, d) => cb(d)),
  onShowStatus:   (cb)  => ipcRenderer.on('show-status',  (_, d) => cb(d)),
  onShowTriggered:(cb)  => ipcRenderer.on('show-triggered',(_, d) => cb(d)),
  onShowUpdated:  (cb)  => ipcRenderer.on('show-updated', (_, d) => cb(d)),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
});
