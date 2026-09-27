'use strict';
// Manuale utente FlowCast — italiano. {{shot:nome}} viene sostituito da uno screenshot dell'app.

module.exports = {
  file:     'FlowCast-Manuale',
  title:    'Manuale utente',
  contents: 'Indice',
  version:  'Versione',
  figure:   'Figura',
  page:     'Pagina',
  intro: `FlowCast automatizza la produzione e la distribuzione di trasmissioni radiofoniche e programmi audio.
Prende i file audio esportati dal sistema di messa in onda o di produzione, li converte e li unisce con FFmpeg
e consegna il risultato via FTP, in una cartella locale e in archivio — secondo una pianificazione, con avvisi email quando qualcosa va storto.`,

  shots: {
    'dashboard':        'Dashboard con le statistiche',
    'schedule':         'Palinsesto — gli show',
    'timeline':         'Palinsesto — timeline dei prossimi 7 giorni',
    'show-general':     'Show — scheda Generale',
    'show-sources':     'Show — scheda Sorgenti Audio',
    'show-schedule':    'Show — scheda Schedule',
    'show-output':      'Show — scheda Output & FTP',
    'settings-email':   'Impostazioni — Avvisi email',
    'settings-general': 'Impostazioni — Generale',
    'settings-info':    'Impostazioni — Info e aggiornamenti',
  },

  chapters: [
    { title: 'Requisiti', html: `
<table>
<tr><th>Componente</th><th>Requisito</th></tr>
<tr><td>Sistema operativo</td><td>Windows 10 o 11 (64 bit) · macOS 13 Ventura o successivo (Intel e Apple silicon) · Linux 64 bit (AppImage)</td></tr>
<tr><td>FFmpeg</td><td>Da installare a parte, versione 4.3 o successiva (vedi capitolo 3). Non serve per la <em>Copia diretta</em> di un solo file.</td></tr>
<tr><td>Rete</td><td>Solo per upload FTP, avvisi email e controllo aggiornamenti</td></tr>
</table>
<p>Perché gli show pianificati partano, FlowCast deve essere in esecuzione (anche solo nella tray).</p>` },

    { title: 'Installazione e primo avvio', html: `
<ol>
<li>Scarica il file per il tuo sistema da <code>github.com/djgragra/flowcast/releases</code> (link anche su onairgarage.com): <code>FlowCast-Setup-&lt;versione&gt;.exe</code> per Windows, <code>FlowCast-&lt;versione&gt;-arm64.dmg</code> (Apple silicon) o <code>-x64.dmg</code> (Intel) per macOS, <code>FlowCast-&lt;versione&gt;-x86_64.AppImage</code> per Linux.</li>
<li>Facoltativo: verifica il file con <code>SHA256SUMS.txt</code> pubblicato con la release. In PowerShell:<br><code>Get-FileHash .\\FlowCast-Setup-&lt;versione&gt;.exe -Algorithm SHA256</code></li>
<li>Avvia l'installer. Non è firmato digitalmente, quindi Windows SmartScreen può mostrare <em>PC protetto da Windows</em>: clicca <strong>Ulteriori informazioni → Esegui comunque</strong>.</li>
<li>Scegli la cartella di installazione (predefinita <code>%LOCALAPPDATA%\\Programs\\FlowCast</code>) e segui la procedura guidata.</li>
<li>Avvia FlowCast dal menu Start o dal collegamento sul desktop.</li>
</ol>
<h3>macOS</h3>
<p>Apri il <code>.dmg</code> e trascina FlowCast in <em>Applicazioni</em>. FlowCast non è firmato da Apple, quindi la prima volta macOS lo blocca: apri <em>Impostazioni di Sistema → Privacy e sicurezza</em> e premi <strong>Apri comunque</strong> accanto al messaggio su FlowCast.</p>
<h3>Linux</h3>
<p>Rendi eseguibile l'AppImage (<code>chmod +x FlowCast-*.AppImage</code>) e avviala. Su alcune distribuzioni le AppImage richiedono il pacchetto <code>libfuse2</code>. L'avvio all'accesso non è disponibile su Linux.</p>
<p>Tutti i dati (show, impostazioni, log, registro) restano quando aggiorni o reinstalli; la loro cartella è indicata in <em>Impostazioni → Info</em> (vedi capitolo 17).</p>
<div class="note"><strong>Aggiornamento dalla versione 26.5.0 o precedenti.</strong> Quelle versioni avevano un identificativo diverso, quindi il nuovo installer non le sostituisce. Esporta un backup (capitolo 16), chiudi FlowCast dalla tray, disinstalla la vecchia FlowCast da <em>Impostazioni → App</em>, poi installa la nuova versione. Show e impostazioni restano.</div>` },

    { title: 'Installare FFmpeg', html: `
<p>FlowCast usa FFmpeg come programma esterno per convertire e unire l'audio. FFmpeg è gratuito e open source, ma non è incluso in FlowCast.</p>
<ol>
<li>Scarica una build per Windows, per esempio da <code>gyan.dev/ffmpeg/builds</code> (basta la build <em>essentials</em>) oppure da <code>github.com/BtbN/FFmpeg-Builds</code>.</li>
<li>Decomprimila, per esempio in <code>C:\\ffmpeg</code>.</li>
<li>Aggiungi <code>C:\\ffmpeg\\bin</code> al PATH di sistema, oppure apri <em>Impostazioni → Generale → Strumenti</em> e imposta <strong>Percorso ffmpeg</strong> su <code>C:\\ffmpeg\\bin\\ffmpeg.exe</code>.<br>Con winget: <code>winget install Gyan.FFmpeg</code>, poi riavvia FlowCast.</li>
<li>Premi <strong>Test</strong> accanto al percorso: FlowCast mostra la versione di FFmpeg e gli eventuali formati che la build non sa codificare.</li>
</ol>
<p><strong>macOS</strong>: <code>brew install ffmpeg</code> (Homebrew). FlowCast lo trova da solo in <code>/opt/homebrew/bin</code> o <code>/usr/local/bin</code>. La build di Homebrew non ha <code>libvorbis</code>, quindi con quella l'uscita OGG non è disponibile. <strong>Linux</strong>: installa il pacchetto <code>ffmpeg</code> della tua distribuzione (es. <code>sudo apt install ffmpeg</code>).</p>
<p>Se FFmpeg non si avvia, o non sa codificare un formato usato da uno show, compare un avviso sotto la barra in alto.</p>
<p><strong>Versioni provate</strong> (tutti i formati di uscita, compresa l'unione di più file): 4.3.1, 4.4.1, 5.1.2, 6.1.1, 7.1.1, 8.1.2 e 9.0.2. L'uscita OGG richiede l'encoder <code>libvorbis</code> e l'MP3 richiede <code>libmp3lame</code>: le build gyan.dev e BtbN li includono entrambi.</p>` },

    { title: 'Guida rapida: il primo show', html: `
<ol>
<li>Apri <strong>⚙ Impostazioni</strong> (in fondo alla barra laterale): imposta il percorso di FFmpeg se serve, eventualmente il <em>Percorso BASE sorgenti WAV</em> e il <em>Percorso BASE archivio</em>, poi <strong>💾 Salva</strong>.</li>
<li>Premi <strong>+ Show</strong> nella barra laterale.</li>
<li><em>Generale</em>: nome del programma, slug (nome del file di uscita), formato e bitrate.</li>
<li><em>Sorgenti Audio</em>: aggiungi i file audio che compongono la puntata, nell'ordine giusto.</li>
<li><em>Schedule</em>: orario e frequenza, oppure scegli la modalità <em>Manuale</em> nella scheda Generale.</li>
<li><em>Output &amp; FTP</em>: upload FTP e/o una cartella di uscita locale. Usa <strong>🔌 Testa connessione</strong>.</li>
<li><strong>💾 Salva</strong>, poi fai un <strong>🧪 Dry Run</strong> per controllare tutto senza caricare né copiare nulla.</li>
</ol>
{{shot:schedule}}` },

    { title: 'Impostazioni dello show', html: `
<p>Ogni show ha queste schede:</p>
<table>
<tr><th>Scheda</th><th>Contenuto</th></tr>
<tr><td>Generale</td><td>Nome del programma, categoria, slug, formato di uscita, bitrate, modalità di esecuzione (Schedulato / Manuale)</td></tr>
<tr><td>Sorgenti Audio</td><td>Percorso BASE sorgenti e l'elenco dei file audio, uniti in questo ordine</td></tr>
<tr><td>Schedule</td><td>Orario, frequenza, giorni, data di inizio e di fine</td></tr>
<tr><td>Output &amp; FTP</td><td>Upload FTP, cartella di uscita locale</td></tr>
<tr><td>Archivio</td><td>Copia facoltativa di ogni puntata prodotta</td></tr>
<tr><td>Registro</td><td>Esito delle ultime esecuzioni</td></tr>
<tr><td>Log</td><td>Dettaglio dell'ultima esecuzione</td></tr>
</table>
{{shot:show-general}}
<h3>Slug</h3>
<p>Lo slug è l'inizio del nome del file prodotto: lo slug <code>mattina-news</code> produce <code>mattina-news_27-09-2026_07-10.mp3</code>. Dà il nome anche alla cartella di lavoro. Cambiare il nome dello show non cambia lo slug.</p>
<h3>Sorgenti audio e la casella di controllo</h3>
<p>I percorsi possono essere assoluti o relativi al Percorso BASE sorgenti. La casella <strong>Controlla aggiornamento</strong> indica i file che devono essere cambiati dall'ultima esecuzione: lo show viene prodotto solo se tutti i file spuntati sono più recenti. Togli la spunta agli elementi fissi come jingle o sigle, così vengono sempre inclusi.</p>
{{shot:show-sources}}
<h3>Variabili nei percorsi</h3>
<p>Nella cartella di uscita locale e nella sottocartella archivio puoi usare variabili sostituite con la data di produzione: <code>%ANNO%</code>, <code>%MESE%</code>, <code>%GIORNO%</code>, <code>%ORA%</code>. Esempio: <code>D:\\Archivio\\%ANNO%\\%MESE%\\</code> → <code>D:\\Archivio\\2026\\09\\</code>.</p>` },

    { title: 'Pianificazione', html: `
<table>
<tr><th>Frequenza</th><th>Esegue</th></tr>
<tr><td>Ogni giorno</td><td>tutti i giorni all'orario impostato</td></tr>
<tr><td>Lunedì–Venerdì</td><td>nei giorni feriali</td></tr>
<tr><td>Sabato–Domenica</td><td>nel fine settimana</td></tr>
<tr><td>Giorni specifici</td><td>nei giorni che selezioni</td></tr>
</table>
<p>Gli orari seguono l'orologio del computer. Il <em>Periodo validità</em> limita lo show tra una data di inizio e una di fine — utile per i programmi stagionali. Quando la data di fine è passata, lo show viene disattivato all'avvio successivo e segnato con 📅 nella dashboard; per rieseguirlo, togli o sposta la data di fine e riattivalo.</p>
{{shot:show-schedule}}
<h3>Recupero delle esecuzioni saltate (catch-up)</h3>
<p>Se all'orario previsto il computer era spento o FlowCast era chiuso, all'avvio successivo FlowCast esegue gli show previsti per oggi il cui orario è passato e che non sono ancora stati eseguiti (dopo 8 secondi, a 3 secondi l'uno dall'altro). Vale solo per gli show attivi e nel loro periodo di validità.</p>` },

    { title: 'Eseguire uno show', html: `
<ul>
<li><strong>▶ Esegui ora</strong>: esecuzione normale, con il controllo di aggiornamento delle sorgenti.</li>
<li><strong>⚡ Forza</strong>: ignora il controllo e produce sempre.</li>
<li><strong>🧪 Dry Run</strong>: elabora l'audio ma non carica, non copia e non archivia, e non aggiorna la data di controllo. Ideale per provare uno show nuovo.</li>
</ul>
<p>Gli show in modalità <em>Manuale</em> non partono mai da soli, ma si possono eseguire con tutti e tre i pulsanti. Gli show pianificati attivi si possono avviare anche dal menu della tray.</p>
<h3>Cosa succede durante un'esecuzione</h3>
<ol>
<li>Controllo che i file sorgente spuntati siano più recenti dell'ultima produzione (<code>verifica_data.txt</code>).</li>
<li>Copia delle sorgenti nella cartella di lavoro.</li>
<li>Conversione di ogni parte con FFmpeg (saltata in modalità Copia diretta).</li>
<li>Unione delle parti in un unico file chiamato <code>slug_GG-MM-AAAA_HH-MM.ext</code>.</li>
<li>Copia in archivio e nella cartella di uscita locale, se configurati.</li>
<li>Upload FTP, se attivo (3 tentativi).</li>
<li>Aggiornamento della data di controllo e pulizia dei file temporanei.</li>
</ol>` },

    { title: 'FTP e bookmark', html: `
<p>I server FTP si salvano come <strong>bookmark</strong> in <em>Impostazioni → FTP</em>: <strong>+ Nuovo</strong> ne crea uno, <strong>✏ Modifica</strong> lo cambia.</p>
<p>In uno show apri <em>Output &amp; FTP</em>, scegli un bookmark e premi <strong>▶ Carica</strong>: host, porta, utente e password vengono copiati nello show. La <em>Cartella remota</em> è propria di ogni show; il pulsante <strong>📂</strong> mostra le cartelle del server.</p>
<p><strong>💾 Salva e propaga</strong> aggiorna le credenziali di tutti gli show collegati al bookmark: cambi una password una volta sola e tutti gli show la usano.</p>
{{shot:show-output}}
<p>Usa <strong>🔌 Testa connessione</strong> prima di andare in produzione. Se il server lo supporta, attiva <em>Usa FTPS (SSL/TLS)</em>: con l'FTP semplice la password viaggia in chiaro.</p>` },

    { title: 'Formati di uscita', html: `
<table>
<tr><th>Formato</th><th>Note</th></tr>
<tr><td>MP3 (predefinito)</td><td>bitrate costante (CBR), encoder FFmpeg <code>libmp3lame</code></td></tr>
<tr><td>AAC</td><td>encoder AAC nativo di FFmpeg</td></tr>
<tr><td>OGG Vorbis</td><td>encoder FFmpeg <code>libvorbis</code></td></tr>
<tr><td>Copia diretta</td><td>nessuna conversione: con un solo file sorgente FFmpeg non viene usato; con più file serve solo a unirli</td></tr>
</table>
<p>Bitrate: 128k, 192k (predefinito), 256k o 320k.</p>` },

    { title: 'Avvisi email', html: `
<p>In <em>Impostazioni → Email</em> FlowCast può inviare una email:</p>
<ul>
<li><strong>su errore</strong>: quando uno show fallisce, oppure fallisce un upload, una copia o l'archiviazione;</li>
<li><strong>se il file non è aggiornato</strong>: dopo 3 esecuzioni consecutive senza file sorgente nuovi — segno che il sistema a monte ha smesso di produrli.</li>
</ul>
<p>Imposta server SMTP, porta, utente, password, mittente e fino a tre destinatari, poi premi <strong>📧 Testa SMTP</strong>.</p>
{{shot:settings-email}}
<p><strong>Certificati.</strong> FlowCast verifica il certificato del server di posta, e il nome del server deve corrispondere. Molti provider usano per il server SMTP un nome diverso dal tuo dominio: usa il nome indicato dal tuo provider. <em>Consenti certificati self-signed</em> serve solo per server interni di cui ti fidi.</p>
<h3>Telegram</h3>
<p>Gli stessi avvisi possono arrivare anche su Telegram (stessa pagina, <em>Avvisi Telegram</em>):</p>
<ol>
<li>Su Telegram scrivi a <strong>@BotFather</strong>, crea un bot (<code>/newbot</code>) e copia il <em>token</em>.</li>
<li>Invia un messaggio al tuo bot, oppure aggiungilo a un gruppo. Trova il <em>chat ID</em> con <strong>@userinfobot</strong> o aprendo <code>api.telegram.org/bot&lt;token&gt;/getUpdates</code>.</li>
<li>Incolla token e chat ID, scegli gli avvisi e premi <strong>✈ Testa Telegram</strong>, poi salva.</li>
</ol>` },

    { title: 'Dashboard', html: `
<p>La <strong>barra in alto</strong>, sempre visibile, mostra l'orologio, la <em>prossima produzione</em> con il conto alla rovescia e gli show <em>in produzione</em> in quel momento.</p>
<p>La pagina <strong>Dashboard</strong> mostra le statistiche delle produzioni:</p>
<ul>
<li>show totali e attivi, produzioni in coda nelle prossime 24 ore, prodotti e falliti oggi;</li>
<li>percentuale di successo sugli ultimi 30 giorni, audio prodotto e durata media di una produzione;</li>
<li>il grafico dell'<strong>attività</strong> degli ultimi 7, 14 o 30 giorni (verde = prodotti, rosso = falliti), le produzioni per show e per ora del giorno;</li>
<li>prossime 24 ore, attività recente, show con errori e show per categoria.</li>
</ul>
{{shot:dashboard}}
<p>Clicca una riga per aprire lo show, o una categoria per filtrare la barra laterale. Una produzione con upload, copia o archiviazione fallita conta come fallita. Le statistiche sono salvate giorno per giorno in <code>stats.json</code>; dopo l'aggiornamento da una versione precedente vengono ricostruite dal registro delle esecuzioni.</p>
<p>Le barre sotto la barra in alto avvisano se FFmpeg manca o non sa codificare un formato in uso, e annunciano una nuova versione (capitolo 15).</p>` },

    { title: 'Palinsesto, coda e categorie', html: `
<p>Il <strong>Palinsesto</strong> (barra laterale) ha due viste:</p>
<ul>
<li><strong>Show</strong>: una scheda per ogni show con pianificazione, ultimo esito, prossima esecuzione ed esito di ogni passaggio (📁 locale, 📡 FTP, 🗄 archivio: verde = ok, rosso = errore, grigio = saltato). <strong>Ricerca</strong> per nome, <strong>filtri</strong> (Tutti, Non scaduti, Abilitati, Disabilitati, Con errore, Scaduti) e <strong>ordinamento</strong> per nome, orario o ultima esecuzione.</li>
<li><strong>Timeline</strong>: tutte le produzioni delle prossime 24 ore o 7 giorni, giorno per giorno, con orario, formato, destinazioni e conto alla rovescia.</li>
</ul>
{{shot:timeline}}
<p>Sotto i pulsanti di navigazione la barra laterale elenca le <strong>prossime produzioni in coda</strong>; la prima è evidenziata. Sotto ci sono gli show, ciascuno con il suo stato (OK, Errore, Disattivo…) e la prossima esecuzione.</p>
<p><strong>Categorie.</strong> Nella scheda Generale di uno show puoi indicare una categoria (es. News, Musica, Weekend). La barra laterale raggruppa gli show per categoria, ognuna con il suo colore; la dashboard li conta per categoria, e cliccando una categoria lì filtri la barra laterale (✕ toglie il filtro).</p>` },

    { title: 'Impostazioni', html: `
<table>
<tr><th>Opzione</th><th>Descrizione</th></tr>
<tr><td>Percorso BASE sorgenti WAV</td><td>prefisso comune per i file audio di tutti gli show</td></tr>
<tr><td>Percorso BASE archivio</td><td>prefisso comune per le cartelle di archivio</td></tr>
<tr><td>Percorso ffmpeg e Test</td><td>vedi capitolo 3</td></tr>
<tr><td>Timeout FTP</td><td>secondi prima che un'operazione FTP venga interrotta (predefinito 30)</td></tr>
<tr><td>Avvia all'accesso</td><td>avvia FlowCast all'accesso, anche ridotto a icona (Windows e macOS)</td></tr>
<tr><td>Alla pressione di X</td><td>Automatico (riduce nella tray se esistono show pianificati), riduci sempre nella tray, oppure chiudi sempre</td></tr>
<tr><td>Lingua</td><td>English, Italiano, Español</td></tr>
<tr><td>Tema</td><td>pulsante ☀️/🌙 nella barra del titolo</td></tr>
</table>
{{shot:settings-general}}` },

    { title: 'Tray di sistema', html: `
<p>FlowCast resta attivo nell'area di notifica (la barra dei menu su macOS) quando chiudi la finestra, secondo l'impostazione <em>Alla pressione di X</em>. Doppio clic sull'icona per aprire la finestra. Tasto destro per <em>Esegui ora</em> su ogni show pianificato attivo, e <strong>Esci</strong> per chiudere del tutto FlowCast.</p>` },

    { title: 'Aggiornamenti', html: `
<p>FlowCast controlla se c'è una nuova versione all'avvio e ogni 24 ore. Quando ce n'è una, compare una barra sotto la barra del titolo:</p>
<ol>
<li>Premi <strong>Scarica e installa</strong>: FlowCast scarica l'installer nella cartella <em>Download</em> e lo verifica con il checksum SHA-256 della release.</li>
<li>Premi <strong>Chiudi e installa</strong>: FlowCast si chiude e parte l'installer. Segui la procedura come per la prima installazione.</li>
</ol>
<p><strong>Ignora questa versione</strong> nasconde la barra finché non esce una versione successiva. Niente viene installato finché non premi il pulsante; se il download non riesce, <strong>Apri pagina di download</strong> apre la release su GitHub.</p>
<p>In <em>Impostazioni → Info → Aggiornamenti</em> puoi controllare a mano o disattivare il controllo automatico.</p>
{{shot:settings-info}}
<p>Show e impostazioni restano. Il pulsante <strong>📖 Manuale utente (PDF)</strong> (nella Guida e in <em>Impostazioni → Info</em>) apre questo manuale per la versione installata.</p>` },

    { title: 'Backup e trasferimento su un altro PC', html: `
<p>In <em>Impostazioni → Backup</em>:</p>
<ul>
<li><strong>💾 Esporta tutto</strong> salva show, impostazioni e bookmark FTP in un file JSON;</li>
<li><strong>📥 Importa</strong> carica un backup: <em>OK</em> sostituisce tutto, <em>Annulla</em> aggiunge solo gli show mancanti.</li>
</ul>
<p>Per spostare FlowCast: esporta sul vecchio PC, installa FlowCast sul nuovo, importa. Esporta un backup prima di ogni aggiornamento.</p>
<div class="note"><strong>Il backup contiene le password FTP e SMTP in chiaro.</strong> Conservalo in un posto sicuro e cancella le copie che non servono più.</div>` },

    { title: 'File e log', html: `
<p>La cartella dati è <code>%APPDATA%\\flowcast</code> su Windows, <code>~/Library/Application Support/flowcast</code> su macOS e <code>~/.config/flowcast</code> su Linux; <em>Impostazioni → Info</em> mostra il percorso esatto.</p>
<table>
<tr><th>File o cartella</th><th>Contenuto</th></tr>
<tr><td><code>data.json</code></td><td>show, impostazioni e bookmark</td></tr>
<tr><td><code>stats.json</code></td><td>statistiche giornaliere per la dashboard</td></tr>
<tr><td><code>work/&lt;slug&gt;/</code></td><td>file di lavoro</td></tr>
<tr><td><code>logs/</code></td><td>un log per show, <code>_system.log</code> per gli errori generali</td></tr>
<tr><td><code>history/</code></td><td>registro delle esecuzioni</td></tr>
</table>
<p>La <strong>Console</strong> in fondo alla finestra mostra in tempo reale l'output di ogni produzione; clicca la sua barra per aprirla o chiuderla.</p>
<p>La scheda <em>Log</em> di ogni show ha <strong>📁 Cartella</strong>, <strong>💾 Esporta</strong> e <strong>🗑 Pulisci</strong>.</p>` },

    { title: 'Domande frequenti e problemi', html: `
<h3>Uno show non parte all'orario previsto</h3>
<p>FlowCast deve essere in esecuzione, anche solo nella tray. Controlla che lo show sia abilitato, in modalità Schedulato e nel suo periodo di validità. Se il PC era spento, il catch-up lo esegue all'avvio successivo.</p>
<h3>“Nessun aggiornamento rilevato” ma i file sono nuovi</h3>
<p>Tutte le sorgenti con <em>Controlla aggiornamento</em> devono essere più recenti dell'ultima produzione. Togli la spunta ai file fissi (jingle, sigle), oppure usa una volta <strong>⚡ Forza</strong>.</p>
<h3>Errore FFmpeg</h3>
<p>Premi <strong>Test</strong> accanto al percorso di FFmpeg. <em>Non trovato</em>: imposta il percorso completo di <code>ffmpeg.exe</code>. <em>Unknown encoder</em>: alla tua build manca un encoder (per esempio <code>libvorbis</code> per l'OGG); installa una build gyan.dev o BtbN.</p>
<h3>Upload FTP non riuscito</h3>
<ul><li>Controlla host, porta e credenziali con <strong>🔌 Testa connessione</strong>.</li><li>Controlla che la cartella remota esista (pulsante <strong>📂</strong>).</li><li>Per l'FTPS attiva <em>Usa FTPS (SSL/TLS)</em>; con connessioni lente aumenta il timeout FTP.</li></ul>
<h3>Il test email fallisce con un errore di certificato</h3>
<p>Il nome del server non corrisponde al suo certificato: usa il nome del server SMTP indicato dal tuo provider (capitolo 10).</p>
<h3>macOS dice che FlowCast non può essere aperto</h3>
<p>FlowCast non è firmato da Apple. Apri <em>Impostazioni di Sistema → Privacy e sicurezza</em> e premi <strong>Apri comunque</strong> (capitolo 2).</p>
<h3>Due voci FlowCast in <em>App</em></h3>
<p>Hai installato sopra la versione 26.5.0 o precedente. Esporta un backup, disinstalla entrambe le voci, installa la nuova versione e, se serve, importa il backup.</p>` },

    { title: 'Supporto, privacy e licenza', html: `
<p>FlowCast è gratuito e open source, realizzato da Graziano Melzi · OnAir Garage.</p>
<ul>
<li>Pagina del tool: <code>onairgarage.com/tools/flowcast/</code></li>
<li>Codice sorgente e release: <code>github.com/djgragra/flowcast</code></li>
<li>Contatto: <code>hello@onairgarage.com</code></li>
</ul>
<p><strong>Privacy.</strong> FlowCast non raccoglie dati di utilizzo. Oltre ai server FTP e SMTP che configuri, contatta solo GitHub (<code>api.github.com</code>) per il controllo aggiornamenti, che si può disattivare.</p>
<p><strong>Licenza.</strong> Licenza MIT, © 2026 Graziano Melzi. FFmpeg è un progetto separato, con licenza LGPL/GPL, e non è distribuito con FlowCast.</p>` },
  ]
};
