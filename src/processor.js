'use strict';
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { spawn }    = require('child_process');
const store        = require('./store');
const { t, dateLocale } = require('./i18n');

// ── helpers ──────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function nowTimestamp() {
  const d  = new Date();
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yy = d.getFullYear();
  const hh = pad2(d.getHours());
  const nn = pad2(d.getMinutes());
  return `${dd}-${mm}-${yy}_${hh}-${nn}`;
}

// YYYYMMDDHHmm — compatible with legacy CMD verifica_data.txt
function dateToKey(d) {
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

// Expand path variables: %ANNO%, %MESE%, %GIORNO%, %ORA%
function expandPath(p, date) {
  if (!p) return p;
  const d = date || new Date();
  return p
    .replace(/%ANNO%/gi,   d.getFullYear().toString())
    .replace(/%MESE%/gi,   pad2(d.getMonth() + 1))
    .replace(/%GIORNO%/gi, pad2(d.getDate()))
    .replace(/%ORA%/gi,    pad2(d.getHours()));
}

function readVerifica(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const s = fs.readFileSync(filePath, 'utf-8').trim();
  return s || null;
}

function parseVerificaKey(key) {
  if (!key || key.length < 12) return new Date(0);
  return new Date(
    parseInt(key.substring(0, 4)),
    parseInt(key.substring(4, 6)) - 1,
    parseInt(key.substring(6, 8)),
    parseInt(key.substring(8, 10)),
    parseInt(key.substring(10, 12))
  );
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function copyFile(src, dst) {
  fs.copyFileSync(src, dst);
}

function runFfmpeg(ffmpegPath, args, logFn) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.stderr.on('data', d => logFn(d.toString().trim()));
    proc.stdout.on('data', d => logFn(d.toString().trim()));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit code ${code}`));
    });
    proc.on('error', err => reject(err));
  });
}

const FORMAT_EXT = { mp3: 'mp3', aac: 'aac', ogg: 'ogg' };

function getOutputExt(outputFormat, firstSourcePath) {
  if (outputFormat === 'copy') {
    return path.extname(firstSourcePath || '').slice(1).toLowerCase() || 'mp3';
  }
  return FORMAT_EXT[outputFormat] || 'mp3';
}

function buildConvertArgs(outputFormat, bitrate) {
  switch (outputFormat) {
    case 'aac':  return ['-c:a', 'aac',       '-b:a', bitrate];
    case 'ogg':  return ['-c:a', 'libvorbis', '-b:a', bitrate];
    case 'copy': return ['-c', 'copy'];
    default:     return ['-c:a', 'libmp3lame', '-b:a', bitrate, '-minrate', bitrate, '-maxrate', bitrate, '-bufsize', bitrate];
  }
}

// Resolve WAV path: absolute → use as-is; relative → prepend wavBase
function resolveWavPath(base, wavPath) {
  if (!wavPath) return wavPath;
  if (/^[A-Za-z]:[\\/]/.test(wavPath) || /^\\\\/.test(wavPath)) return wavPath;
  return base ? path.join(base, wavPath) : wavPath;
}

// Resolve archive path: absolute → use as-is; relative → prepend settings.baseArchive
function resolveArchivePath(settings, archivePath) {
  if (!archivePath) return archivePath;
  if (/^[A-Za-z]:[\\/]/.test(archivePath) || /^\\\\/.test(archivePath)) return archivePath;
  return settings.baseArchive ? path.join(settings.baseArchive, archivePath) : archivePath;
}

// Normalize wavFiles entry: string → {path, check:true}; object → keep check (default true)
function normalizeWavEntry(entry) {
  if (typeof entry === 'string') return { path: entry, check: true };
  return { path: entry.path || '', check: entry.check !== false };
}

// ── main pipeline ─────────────────────────────────────────────────────────────

/**
 * @param {boolean} force   - skip date check
 * @param {boolean} dryRun  - skip archive/local/FTP copy (produce MP3 only)
 */
async function processShow(show, logFn, progressFn, force = false, dryRun = false) {
  const settings     = store.getSettings();
  const ffmpeg       = settings.ffmpegPath || 'ffmpeg';
  const slug         = show.slug;
  const bitrate      = show.bitrate || '192k';
  const wavBase      = show.wavBase || '';
  const outputFormat = show.outputFormat || 'mp3';
  const isCopy       = outputFormat === 'copy';
  const now          = new Date();

  // Normalize wavFiles: support both string[] and {path,check}[] formats
  const wavEntries = (show.wavFiles || []).map(normalizeWavEntry).filter(e => e.path);
  const wavs = wavEntries.map(e => resolveWavPath(wavBase, e.path));

  if (wavs.length === 0) throw new Error(t('proc.no_audio'));
  if (!slug)             throw new Error(t('proc.no_slug'));

  const outExt = getOutputExt(outputFormat, wavs[0]);

  progressFn('start');
  logFn('─'.repeat(50));
  logFn(t('proc.start', { name: show.name }) + (dryRun ? t('proc.dry_suffix') : ''));
  logFn('─'.repeat(50));

  // ── 1. Cartelle di lavoro (interne all'app) ──────────────────────────────
  const workDir = store.getShowWorkDir(show);
  const podDir  = path.join(workDir, 'podcast');
  ensureDir(workDir);
  ensureDir(podDir);
  logFn(t('proc.workdir', { dir: workDir }));

  // ── 2. Archivio (opzionale, solo se abilitato) ───────────────────────────
  // Expand path variables in archivePath before resolving
  const expandedArchivePath = expandPath(show.archivePath, now);
  const resolvedArchive = resolveArchivePath(settings, expandedArchivePath);
  let archiveOk = false;
  if (show.archiveEnabled && resolvedArchive && !dryRun) {
    try {
      ensureDir(resolvedArchive);
      archiveOk = true;
      logFn(t('proc.archive_ready', { dir: resolvedArchive }));
    } catch(e) {
      logFn(t('proc.archive_unreachable', { error: e.message }));
    }
  }

  // ── 3. Controllo file sorgenti ───────────────────────────────────────────
  logFn(t('proc.checking'));
  for (const wav of wavs) {
    if (!fs.existsSync(wav)) throw new Error(t('proc.src_missing', { file: wav }));
  }

  // Only checked wavs participate in date comparison; unchecked (jingles) always included
  const checkedWavs = wavs.filter((_, i) => wavEntries[i].check);
  const checkedDates = checkedWavs.map(w => fs.statSync(w).mtime);

  const verificaFile = show.verificaFile || path.join(workDir, 'verifica_data.txt');
  const lastKey  = readVerifica(verificaFile);
  const lastDate = parseVerificaKey(lastKey);

  let shouldProcess = force;
  if (!shouldProcess) {
    if (checkedWavs.length === 0) {
      shouldProcess = true; // no checked wavs → always process
    } else {
      shouldProcess = checkedDates.every(d => d > lastDate);
    }
  }

  if (!shouldProcess) {
    logFn(t('proc.no_update'));
    logFn('─'.repeat(50));
    return { action: 'no-update' };
  }

  if (force) logFn(t('proc.forced'));
  wavs.forEach((w, i) => {
    const mtime = fs.statSync(w).mtime;
    const checkNote = wavEntries[i].check ? '' : ' [no-check]';
    logFn(t('proc.source', { i: i+1, n: wavs.length, date: mtime.toLocaleString(dateLocale()), note: checkNote }));
  });

  const maxDate = checkedDates.length > 0
    ? new Date(Math.max(...checkedDates.map(d => d.getTime())))
    : new Date();
  const maxKey  = dateToKey(maxDate);

  // ── 4. Copia WAV in cartella di lavoro ───────────────────────────────────
  logFn(t('proc.acquire', { n: wavs.length }));
  const localWavs = [];
  for (let i = 0; i < wavs.length; i++) {
    const n    = pad2(i + 1);
    const dest = path.join(workDir, `${slug}_${n}.wav`);
    copyFile(wavs[i], dest);
    localWavs.push(dest);
    logFn(t('proc.wav_copied', { n }));
  }

  // ── 5. Conversione (saltata in modalità copy) ────────────────────────────
  const intermediates = [];
  if (isCopy) {
    logFn(t('proc.copy_mode'));
    intermediates.push(...localWavs);
  } else {
    logFn(t('proc.converting', { fmt: outputFormat.toUpperCase(), bitrate }));
    const codecArgs = buildConvertArgs(outputFormat, bitrate);
    for (let i = 0; i < localWavs.length; i++) {
      const n   = pad2(i + 1);
      const out = path.join(workDir, `${slug}_${n}.${outExt}`);
      logFn(t('proc.part', { i: i+1, n: wavs.length }));
      await runFfmpeg(ffmpeg, ['-y', '-i', localWavs[i], ...codecArgs, out], logFn);
      intermediates.push(out);
      logFn(t('proc.part_ok', { i: i+1, n: wavs.length }));
    }
  }

  // ── 6. Concatenazione ─────────────────────────────────────────────────────
  let allFile;
  if (isCopy && intermediates.length === 1) {
    // Single file copy: skip FFmpeg entirely
    allFile = intermediates[0];
    logFn(t('proc.single'));
  } else {
    const concatFile  = path.join(os.tmpdir(), `concat_${slug}.txt`);
    const listContent = intermediates.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatFile, listContent, 'utf-8');
    logFn(wavs.length > 1 ? t('proc.joining') : t('proc.preparing'));
    allFile = path.join(workDir, `${slug}_all.${outExt}`);
    await runFfmpeg(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', allFile], logFn);
    if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
    logFn(t('proc.join_ok'));
  }

  // ── 7. File finale con timestamp ─────────────────────────────────────────
  const ts       = nowTimestamp();
  const outFname = `${slug}_${ts}.${outExt}`;

  // Svuota cartella podcast (un solo file per FTP sync)
  fs.readdirSync(podDir).forEach(f => {
    try { fs.unlinkSync(path.join(podDir, f)); } catch(e) {}
  });

  const outDest = path.join(podDir, outFname);
  copyFile(allFile, outDest);
  logFn(t('proc.ready', { file: outFname }));

  // ── 8. Archivio (opzionale) ──────────────────────────────────────────────
  let archiveResult = 'skipped';
  if (show.archiveEnabled && resolvedArchive) {
    if (dryRun) {
      logFn(t('proc.dry_archive', { dir: resolvedArchive }));
      archiveResult = 'skipped';
    } else if (archiveOk) {
      try {
        copyFile(outDest, path.join(resolvedArchive, outFname));
        logFn(t('proc.archive_ok'));
        archiveResult = 'ok';
      } catch(e) {
        logFn(t('proc.archive_failed', { error: e.message }));
        archiveResult = 'error';
      }
    } else {
      archiveResult = 'error';
    }
  }

  // ── 8b. Cartella output custom ───────────────────────────────────────────
  let localResult = 'skipped';
  if (show.outputFolder) {
    // Expand path variables in output folder
    const expandedOutput = expandPath(show.outputFolder, now);
    if (dryRun) {
      logFn(t('proc.dry_output', { dir: expandedOutput }));
    } else {
      try {
        ensureDir(expandedOutput);
        if (show.clearOutput) {
          const existing = fs.readdirSync(expandedOutput);
          for (const f of existing) {
            try { fs.unlinkSync(path.join(expandedOutput, f)); } catch(e) {}
          }
          logFn(t('proc.output_cleared', { n: existing.length }));
        }
        copyFile(outDest, path.join(expandedOutput, outFname));
        logFn(t('proc.output_ok', { dir: expandedOutput }));
        localResult = 'ok';
      } catch(e) {
        logFn(t('proc.output_failed', { error: e.message }));
        localResult = 'error';
      }
    }
  }

  // ── 9. Aggiorna verifica_data.txt ─────────────────────────────────────────
  if (!dryRun) {
    fs.writeFileSync(verificaFile, maxKey, 'utf-8');
    logFn(t('proc.verifica', { key: maxKey }));
  } else {
    logFn(t('proc.dry_verifica', { key: maxKey }));
  }

  // ── 10. Pulizia file temporanei ───────────────────────────────────────────
  const tmpSet = new Set([...localWavs, ...intermediates]);
  if (allFile !== localWavs[0]) tmpSet.add(allFile);
  const tmpFiles = [...tmpSet];
  let cleaned = 0;
  for (const f of tmpFiles) {
    try { if (fs.existsSync(f)) { fs.unlinkSync(f); cleaned++; } } catch(e) {}
  }
  logFn(t('proc.cleanup', { n: cleaned }));

  logFn('─'.repeat(50));
  logFn(dryRun ? t('proc.dry_done') : t('proc.done'));

  return { action: 'produced', file: outDest, filename: outFname, archiveResult, localResult, dryRun };
}

module.exports = { processShow, resolveArchivePath, expandPath };
