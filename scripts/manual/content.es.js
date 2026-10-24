'use strict';
// Manual de usuario de FlowCast — español. {{shot:nombre}} se sustituye por una captura de la app.

module.exports = {
  file:     'FlowCast-Manual-ES',
  title:    'Manual de usuario',
  contents: 'Contenido',
  version:  'Versión',
  figure:   'Figura',
  page:     'Página',
  intro: `FlowCast automatiza la producción y la entrega de programas de radio y de audio.
Recoge los archivos de audio que exporta tu sistema de emisión o de producción, los convierte y los une con FFmpeg,
y entrega el resultado por FTP, en una carpeta local y en un archivo — con horario y con alertas por correo cuando algo falla.`,

  shots: {
    'dashboard':        'Panel con las estadísticas',
    'schedule':         'Programación — los programas',
    'timeline':         'Programación — cronología de los próximos 7 días',
    'show-general':     'Programa — pestaña General',
    'show-sources':     'Programa — pestaña Fuentes de Audio',
    'show-schedule':    'Programa — pestaña Programación',
    'show-output':      'Programa — pestaña Salida & FTP',
    'settings-email':   'Configuración — Alertas',
    'settings-general': 'Configuración — General',
    'settings-updates': 'Configuración — Actualizaciones',
    'settings-info':    'Configuración — Ayuda e info',
  },

  chapters: [
    { title: 'Requisitos', html: `
<table>
<tr><th>Componente</th><th>Requisito</th></tr>
<tr><td>Sistema operativo</td><td>Windows 10 u 11 (64 bits) · macOS 13 Ventura o posterior (Intel y Apple silicon) · Linux de 64 bits (AppImage)</td></tr>
<tr><td>FFmpeg</td><td>Se instala aparte, versión 4.3 o posterior (véase el capítulo 3). No hace falta para la <em>copia directa</em> de un solo archivo.</td></tr>
<tr><td>Red</td><td>Solo para la subida por FTP, las alertas por correo y la búsqueda de actualizaciones</td></tr>
</table>
<p>FlowCast debe estar en marcha (aunque sea minimizado en la bandeja del sistema) para que se inicien los programas con horario.</p>` },

    { title: 'Instalación y primer inicio', html: `
<ol>
<li>Descarga el archivo para tu sistema desde <code>github.com/djgragra/flowcast/releases</code> (el enlace también está en onairgarage.com): <code>FlowCast-Setup-&lt;versión&gt;.exe</code> para Windows, <code>FlowCast-&lt;versión&gt;-arm64.dmg</code> (Apple silicon) o <code>-x64.dmg</code> (Intel) para macOS, <code>FlowCast-&lt;versión&gt;-x86_64.AppImage</code> para Linux.</li>
<li>Opcional: comprueba el archivo con <code>SHA256SUMS.txt</code>, publicado con la versión. En PowerShell:<br><code>Get-FileHash .\\FlowCast-Setup-&lt;versión&gt;.exe -Algorithm SHA256</code></li>
<li>Ejecuta el instalador. No está firmado con un certificado de código, así que Windows SmartScreen puede mostrar <em>Windows protegió su PC</em>: pulsa <strong>Más información → Ejecutar de todos modos</strong>.</li>
<li>Elige la carpeta de instalación (por defecto <code>%LOCALAPPDATA%\\Programs\\FlowCast</code>) y sigue el asistente.</li>
<li>Inicia FlowCast desde el menú Inicio o el acceso directo del escritorio.</li>
</ol>
<h3>macOS</h3>
<p>Abre el <code>.dmg</code> y arrastra FlowCast a <em>Aplicaciones</em>. FlowCast no tiene certificado de Apple (lleva una firma ad-hoc), así que la primera vez macOS muestra un aviso de «desarrollador no identificado»: abre <em>Ajustes del Sistema → Privacidad y seguridad</em> y pulsa <strong>Abrir de todos modos</strong> junto al mensaje de FlowCast.</p>
<h3>Linux</h3>
<p>Haz ejecutable el AppImage (<code>chmod +x FlowCast-*.AppImage</code>) e inícialo. En algunas distribuciones los AppImage necesitan el paquete <code>libfuse2</code>. El inicio al iniciar sesión no está disponible en Linux.</p>
<p>Todos los datos (programas, configuración, registros, historial) se conservan al actualizar o reinstalar; su carpeta aparece en <em>Configuración → Ayuda e info</em> (véase el capítulo 17).</p>
<div class="note"><strong>Actualización desde la versión 26.5.0 o anterior.</strong> Esas versiones se instalaron con otro identificador de aplicación, así que el instalador nuevo no las sustituye. Exporta una copia de seguridad (capítulo 16), cierra FlowCast desde la bandeja, desinstala el FlowCast antiguo desde <em>Configuración → Aplicaciones</em> e instala la versión nueva. Tus programas y ajustes se conservan.</div>` },

    { title: 'Instalar FFmpeg', html: `
<p>FlowCast llama a FFmpeg como programa externo para convertir y unir el audio. FFmpeg es gratuito y de código abierto, pero no va incluido en FlowCast.</p>
<ol>
<li>Descarga una compilación para Windows, por ejemplo de <code>gyan.dev/ffmpeg/builds</code> (basta la compilación <em>essentials</em>) o de <code>github.com/BtbN/FFmpeg-Builds</code>.</li>
<li>Descomprímela, por ejemplo en <code>C:\\ffmpeg</code>.</li>
<li>Añade <code>C:\\ffmpeg\\bin</code> al PATH del sistema, o abre <em>Configuración → General → Herramientas</em> y pon <strong>Ruta de FFmpeg</strong> en <code>C:\\ffmpeg\\bin\\ffmpeg.exe</code>.<br>Con winget: <code>winget install Gyan.FFmpeg</code>, y reinicia FlowCast.</li>
<li>Pulsa <strong>Probar</strong> junto a la ruta de FFmpeg: FlowCast muestra la versión de FFmpeg y cualquier formato de salida que tu compilación no pueda codificar.</li>
</ol>
<p><strong>macOS</strong>: <code>brew install ffmpeg</code> (Homebrew). FlowCast lo encuentra solo en <code>/opt/homebrew/bin</code> o <code>/usr/local/bin</code>. La compilación de Homebrew no incluye <code>libvorbis</code>, así que con ella no hay salida OGG. <strong>Linux</strong>: instala el paquete <code>ffmpeg</code> de tu distribución (p. ej. <code>sudo apt install ffmpeg</code>).</p>
<p>Si no se puede iniciar FFmpeg, o no puede codificar un formato que usa uno de tus programas, aparece un aviso bajo la barra superior.</p>
<p><strong>Versiones probadas</strong> (todos los formatos de salida, incluida la unión de varios archivos): 4.3.1, 4.4.1, 5.1.2, 6.1.1, 7.1.1, 8.1.2 y 9.0.2. La salida OGG necesita el codificador <code>libvorbis</code> y MP3 necesita <code>libmp3lame</code>: las compilaciones de gyan.dev y BtbN incluyen ambos.</p>` },

    { title: 'Inicio rápido: tu primer programa', html: `
<ol>
<li>Abre <strong>⚙ Configuración</strong> (abajo en la barra lateral): indica la ruta de FFmpeg si hace falta y, si quieres, la <em>Ruta BASE de fuentes WAV</em> y la <em>Ruta BASE de archivo</em>, y pulsa <strong>💾 Guardar</strong>.</li>
<li>Pulsa <strong>+ Programa</strong> en la barra lateral.</li>
<li><em>General</em>: nombre del programa, slug (nombre del archivo de salida), formato y bitrate.</li>
<li><em>Fuentes de Audio</em>: añade, en orden, los archivos de audio que forman el episodio.</li>
<li><em>Programación</em>: hora y frecuencia, o elige el modo <em>Manual</em> en la pestaña General.</li>
<li><em>Salida &amp; FTP</em>: subida por FTP y/o carpeta de salida local. Usa <strong>🔌 Probar conexión</strong>.</li>
<li><strong>💾 Guardar</strong> y después una <strong>🧪 Prueba</strong> para comprobarlo todo sin subir ni copiar nada.</li>
</ol>
{{shot:schedule}}` },

    { title: 'Ajustes de un programa', html: `
<p>Cada programa tiene estas pestañas:</p>
<table>
<tr><th>Pestaña</th><th>Contenido</th></tr>
<tr><td>General</td><td>Nombre del programa, categoría, slug, formato de salida, bitrate, modo de ejecución (Programado / Manual)</td></tr>
<tr><td>Fuentes de Audio</td><td>Ruta BASE de las fuentes y lista de archivos de audio, unidos en este orden</td></tr>
<tr><td>Programación</td><td>Hora, frecuencia, días, fecha de inicio y de fin</td></tr>
<tr><td>Salida &amp; FTP</td><td>Subida por FTP, carpeta de salida local</td></tr>
<tr><td>Archivo</td><td>Copia opcional de cada episodio producido</td></tr>
<tr><td>Historial</td><td>Resultado de las últimas ejecuciones</td></tr>
<tr><td>Registro</td><td>Salida detallada de la última ejecución</td></tr>
</table>
{{shot:show-general}}
<h3>Slug</h3>
<p>El slug es el comienzo del nombre del archivo de salida: el slug <code>morning-news</code> produce <code>morning-news_27-09-2026_07-10.mp3</code>. También da nombre a la carpeta de trabajo. Cambiar el nombre del programa no cambia el slug.</p>
<h3>Fuentes de audio y la casilla de comprobación</h3>
<p>Las rutas pueden ser absolutas o relativas a la ruta BASE de las fuentes. La casilla <strong>Comprobar actualización</strong> marca los archivos que deben haber cambiado desde la última ejecución: un programa solo se produce cuando todos los archivos marcados son más recientes. Desmarca los elementos fijos, como cortinillas o intros, para que se incluyan siempre.</p>
{{shot:show-sources}}
<h3>Variables de ruta</h3>
<p>En la carpeta de salida local y en la subcarpeta de archivo puedes usar variables que se sustituyen por la fecha de producción: <code>%ANNO%</code> (año), <code>%MESE%</code> (mes), <code>%GIORNO%</code> (día), <code>%ORA%</code> (hora). Ejemplo: <code>D:\\Archivo\\%ANNO%\\%MESE%\\</code> → <code>D:\\Archivo\\2026\\09\\</code>.</p>` },

    { title: 'Programación horaria', html: `
<table>
<tr><th>Frecuencia</th><th>Se ejecuta</th></tr>
<tr><td>Cada día</td><td>todos los días a la hora indicada</td></tr>
<tr><td>Lunes–Viernes</td><td>los días laborables</td></tr>
<tr><td>Sábado–Domingo</td><td>el fin de semana</td></tr>
<tr><td>Días concretos</td><td>los días que selecciones</td></tr>
</table>
<p>Las horas siguen el reloj del equipo. El <em>Periodo de validez</em> limita un programa a una fecha de inicio y una de fin — útil para programas de temporada. Cuando pasa la fecha de fin, el programa se desactiva en el siguiente inicio y se marca con 📅 en el panel; para volver a ejecutarlo, borra o cambia la fecha de fin y actívalo.</p>
{{shot:show-schedule}}
<h3>Recuperación de ejecuciones perdidas</h3>
<p>Si el equipo estaba apagado o FlowCast cerrado a la hora programada, en el siguiente inicio FlowCast ejecuta los programas previstos para hoy cuya hora ya ha pasado y que aún no se han ejecutado (tras 8 segundos, con 3 segundos entre uno y otro). Esta recuperación solo vale para programas activados y dentro de su periodo de validez.</p>` },

    { title: 'Ejecutar un programa', html: `
<ul>
<li><strong>▶ Ejecutar ahora</strong>: ejecución normal, con la comprobación de actualización de las fuentes.</li>
<li><strong>⚡ Forzar</strong>: ignora la comprobación de actualización y produce siempre.</li>
<li><strong>🧪 Prueba</strong>: procesa el audio pero no sube, no copia ni archiva, y no actualiza la fecha de comprobación. Ideal para probar un programa nuevo.</li>
</ul>
<p>Los programas en modo <em>Manual</em> nunca se inician solos, pero se pueden ejecutar con los tres botones. Los programas activados y con horario también se pueden iniciar desde el menú de la bandeja.</p>
<h3>Qué ocurre durante una ejecución</h3>
<ol>
<li>Se comprueba que los archivos fuente marcados son más recientes que la última producción (<code>verifica_data.txt</code>).</li>
<li>Se copian las fuentes a la carpeta de trabajo.</li>
<li>Se convierte cada parte con FFmpeg (se omite en el modo de copia directa).</li>
<li>Se unen las partes en un archivo llamado <code>slug_DD-MM-AAAA_HH-NN.ext</code>.</li>
<li>Se copia al archivo y a la carpeta de salida local, si están configurados.</li>
<li>Se sube por FTP, si está activado (3 intentos).</li>
<li>Se actualiza la fecha de comprobación y se eliminan los archivos temporales.</li>
</ol>` },

    { title: 'FTP y marcadores', html: `
<p>Los servidores FTP se guardan como <strong>marcadores</strong> en <em>Configuración → FTP</em>: <strong>+ Nuevo</strong> crea uno, <strong>✏ Editar</strong> lo cambia.</p>
<p>En un programa, abre <em>Salida &amp; FTP</em>, elige un marcador y pulsa <strong>▶ Cargar</strong>: el servidor, el puerto, el usuario y la contraseña se copian al programa. La <em>Carpeta remota</em> es propia de cada programa; el botón <strong>📂</strong> lista las carpetas del servidor.</p>
<p><strong>💾 Guardar y propagar</strong> actualiza las credenciales de todos los programas vinculados al marcador: cambias una contraseña una vez y todos los programas la usan.</p>
{{shot:show-output}}
<p>Usa <strong>🔌 Probar conexión</strong> antes de ponerlo en marcha. Si el servidor lo admite, activa <em>Usar FTPS (SSL/TLS)</em>: con FTP simple la contraseña viaja sin cifrar.</p>` },

    { title: 'Formatos de salida', html: `
<table>
<tr><th>Formato</th><th>Notas</th></tr>
<tr><td>MP3 (por defecto)</td><td>bitrate constante (CBR), codificador de FFmpeg <code>libmp3lame</code></td></tr>
<tr><td>AAC</td><td>codificador AAC nativo de FFmpeg</td></tr>
<tr><td>OGG Vorbis</td><td>codificador de FFmpeg <code>libvorbis</code></td></tr>
<tr><td>Copia directa</td><td>sin conversión: con un solo archivo fuente no se usa FFmpeg; con varios, solo los une</td></tr>
</table>
<p>Bitrate: 128k, 192k (por defecto), 256k o 320k.</p>` },

    { title: 'Alertas por correo', html: `
<p>En <em>Configuración → Alertas</em> FlowCast puede enviar un correo:</p>
<ul>
<li><strong>en caso de error</strong>: cuando un programa falla, o falla un paso de subida, copia o archivo;</li>
<li><strong>si el archivo no se actualiza</strong>: tras 3 ejecuciones seguidas sin archivos fuente nuevos — señal de que el sistema de origen ha dejado de producirlos;</li>
<li><strong>cuando vuelve a funcionar</strong>: una vez, cuando un programa produce correctamente después de haberse enviado una de las alertas anteriores (véase <em>Recuperación y resumen</em> más abajo).</li>
</ul>
<p>Indica el servidor SMTP, el puerto, el usuario, la contraseña, el remitente y los destinatarios (varias direcciones separadas por comas) y pulsa <strong>📧 Probar SMTP</strong>. Todos los destinatarios reciben <strong>un</strong> solo mensaje, con todas las direcciones en Cco: no se ven entre sí. La dirección del remitente no recibe copia, salvo que la incluyas entre los destinatarios. Con un usuario SMTP la conexión debe ir cifrada (STARTTLS, o SSL/TLS desde el principio en el puerto 465): FlowCast nunca envía la contraseña en claro. Cada alerta se intenta enseguida, otra vez a los 10 segundos y otra a los 60 segundos; tras un reinicio FlowCast recuerda qué alertas ya envió. Las contraseñas y los tokens nunca aparecen en los mensajes de error ni en los registros. El botón 👁 junto a una contraseña la muestra mientras la compruebas; se vuelve a ocultar cada vez que se abre la página. Toda alerta empieza por <code>[FlowCast · nombre]</code>, donde el nombre es el que das a esta instalación en <em>Configuración → General</em> (el nombre del equipo si está vacío): con varios PC sabes cuál escribe.</p>
{{shot:settings-email}}
<p><strong>Certificados.</strong> FlowCast comprueba el certificado del servidor de correo y el nombre del servidor debe coincidir con él. Muchos proveedores usan para su servidor SMTP un nombre distinto del de tu propio dominio: usa el nombre que te da tu proveedor. <em>Permitir certificados autofirmados</em> es solo para servidores internos de confianza.</p>
<h3>Telegram</h3>
<p>Las mismas alertas también se pueden enviar a Telegram (misma página, <em>Alertas de Telegram</em>), a uno o varios destinatarios:</p>
<ol>
<li>En Telegram, escribe a <strong>@BotFather</strong>, crea un bot (<code>/newbot</code>) y copia su <em>token</em>.</li>
<li>Para cada destinatario (una persona, un grupo o un canal), busca su <em>chat ID</em> con <strong>@userinfobot</strong> o abriendo <code>api.telegram.org/bot&lt;token&gt;/getUpdates</code>; el ID de un grupo o canal empieza por <code>-</code>.</li>
<li>Pega el token, pulsa <strong>+ Añadir destinatario</strong> por cada chat ID y usa el campo de <em>nota</em> para recordar quién es (p. ej. «Ana», «Control») — solo lo ves tú, no se envía a Telegram.</li>
<li>Elige las alertas y pulsa <strong>✈ Probar Telegram</strong>: informa de qué destinatarios no se pudieron alcanzar, sin detener a los demás.</li>
</ol>
<p>Cada destinatario recibe todas las alertas, con el mismo texto que los correos.</p>
<h3>Recuperación y resumen</h3>
<p><strong>Recuperación.</strong> Tras una alerta (un error, o una fuente sin actualizar), la primera producción que termina correctamente envía <strong>un</strong> mensaje de «Vuelta a la normalidad» por los mismos canales. Si no se había enviado ninguna alerta, no se envía nada. Funciona también tras un reinicio, porque lo anunciado se guarda en <code>alert-state.json</code>. Cada canal tiene su propio interruptor, <em>Avisar cuando vuelve a funcionar</em>.</p>
<p><strong>Resumen</strong> (<em>Configuración → Alertas → Resumen</em>, desactivado por defecto). Un texto con lo que hizo cada programa en las últimas 24 horas (<em>cada día</em>) o en los últimos 7 días (<em>cada lunes</em>): producciones, fallos, fuente sin actualizar y última producción. Elige una o más horas (la hora de este PC) y si se envía <em>siempre</em> o <em>solo si algo requiere atención</em>; si no hay nada que contar, el texto dice «Todo funciona». Sale por los canales ya activados (correo, Telegram), una vez por hora y día, también tras un reinicio; si el PC está apagado a esa hora, se envía en el primer inicio posterior. <strong>Enviar ahora</strong> lo envía al instante, para probarlo.</p>` },

    { title: 'Panel', html: `
<p>La <strong>barra superior</strong>, siempre visible, muestra el reloj, la <em>próxima producción</em> con una cuenta atrás y los programas <em>en producción</em> en este momento.</p>
<p>La página del <strong>Panel</strong> muestra las estadísticas de tus producciones:</p>
<ul>
<li>programas en total y activados, producciones en cola en las próximas 24 horas, producidas y fallidas hoy;</li>
<li>porcentaje de éxito en los últimos 30 días, audio producido y tiempo medio de producción;</li>
<li>el gráfico de <strong>actividad</strong> de los últimos 7, 14 o 30 días (verde = producido, rojo = fallido), producciones por programa y por hora del día;</li>
<li>próximas 24 horas, actividad reciente, programas con errores y programas por categoría.</li>
</ul>
{{shot:dashboard}}
<p>Haz clic en una fila para abrir el programa, o en una categoría para filtrar la barra lateral. Una producción cuyo paso de subida, copia o archivo ha fallado cuenta como fallida. Las estadísticas se guardan día a día en <code>stats.json</code>; tras actualizar desde una versión anterior se reconstruyen a partir del historial de ejecuciones.</p>
<p>Unas barras bajo la barra superior avisan si falta FFmpeg o no puede codificar un formato en uso, y anuncian una versión nueva (capítulo 15).</p>` },

    { title: 'Programación, cola y categorías', html: `
<p><strong>Programación</strong> (barra lateral) tiene dos vistas:</p>
<ul>
<li><strong>Programas</strong>: una tarjeta por programa con el horario, el último resultado, la próxima ejecución y el resultado de cada paso (📁 local, 📡 FTP, 🗄 archivo: verde = bien, rojo = error, gris = omitido). <strong>Búsqueda</strong> por nombre, <strong>filtros</strong> (Todos, Activos, Activados, Desactivados, Con error, Caducados) y <strong>orden</strong> por nombre, horario o última ejecución.</li>
<li><strong>Cronología</strong>: todas las producciones de las próximas 24 horas o 7 días, día a día, con hora, formato, destinos y cuenta atrás.</li>
</ul>
{{shot:timeline}}
<p>Bajo los botones de navegación, la barra lateral lista las <strong>próximas producciones en cola</strong>; la primera aparece resaltada. Más abajo están los programas, cada uno con su estado (OK, Error, Desactivado…) y su próxima ejecución.</p>
<p><strong>Categorías.</strong> En la pestaña General de un programa puedes asignar una categoría (p. ej. Noticias, Música, Fin de semana). La barra lateral agrupa los programas por categoría, cada una con su color; el panel las cuenta por categoría, y al hacer clic en una categoría se filtra la barra lateral (✕ quita el filtro). Cada color se elige automáticamente; para cambiar uno, abre <em>Configuración → Categorías</em> y haz clic en su muestra de color. Los botones a la derecha de cada fila restablecen el color automático, cambian el nombre de la categoría en todos sus programas (si el nombre nuevo ya existe, se fusionan) o la eliminan: tú eliges adónde pasan sus programas (otra categoría o <em>Sin categoría</em>).</p>` },

    { title: 'Configuración', html: `
<table>
<tr><th>Opción</th><th>Descripción</th></tr>
<tr><td>Ruta BASE de fuentes WAV</td><td>prefijo común de los archivos de audio de todos los programas</td></tr>
<tr><td>Ruta BASE de archivo</td><td>prefijo común de las carpetas de archivo</td></tr>
<tr><td>Ruta de FFmpeg y Probar</td><td>véase el capítulo 3</td></tr>
<tr><td>Tiempo de espera FTP</td><td>segundos que espera una operación FTP antes de rendirse (por defecto 30)</td></tr>
<tr><td>Iniciar al iniciar sesión</td><td>inicia FlowCast al entrar en el sistema, si quieres minimizado (Windows y macOS)</td></tr>
<tr><td>Mantener este PC despierto</td><td>impide que el sistema se suspenda mientras FlowCast está en marcha</td></tr>
<tr><td>Nombre de esta instalación</td><td>se muestra en cada alerta como <code>[FlowCast · nombre]</code>; vacío = el nombre del equipo</td></tr>
<tr><td>Al presionar X</td><td>Automático (minimizar si hay programas con horario), minimizar siempre a la bandeja, o cerrar siempre</td></tr>
<tr><td>Idioma</td><td>English, Italiano, Español</td></tr>
<tr><td>Tema</td><td>botón ☀️/🌙 de la barra de título</td></tr>
</table>
<p>Las páginas de Configuración siguen siempre este orden: General, FTP, Alertas, Categorías, Actualizaciones, Backup, Ayuda e info. FlowCast recuerda el tamaño y la posición de su ventana.</p>
{{shot:settings-general}}` },

    { title: 'Bandeja del sistema', html: `
<p>FlowCast sigue funcionando en el área de notificación (la barra de menús en macOS) cuando se cierra la ventana, según el ajuste <em>Al presionar X</em>. Haz doble clic en el icono para abrir la ventana. Con el botón derecho tienes <em>Ejecutar ahora</em> para cada programa activado con horario, y <strong>Salir</strong> para cerrar FlowCast por completo.</p>` },

    { title: 'Actualizaciones', html: `
<p>FlowCast busca una versión nueva 20 segundos después de iniciarse y cada 24 horas. <em>Configuración → Actualizaciones</em> muestra cuándo fue la última comprobación y tiene <strong>Comprobar ahora</strong>. Cuando hay una versión disponible, aparece una barra bajo la barra de título con las primeras líneas de las notas de la versión:</p>
<ol>
<li>Pulsa <strong>Descargar e instalar</strong>: FlowCast descarga el instalador a tu carpeta de <em>Descargas</em>, con una barra de progreso, y lo comprueba con la suma SHA-256 de la versión. <strong>Cancelar</strong> detiene la descarga y borra el archivo parcial; un archivo que no coincide se elimina y puedes pulsar <strong>Reintentar</strong>.</li>
<li>Pulsa <strong>Cerrar e instalar</strong>: FlowCast guarda primero una copia de seguridad de tus ajustes (<code>backups/pre-update-&lt;versión&gt;.json</code>, se conservan las últimas 3), después se cierra y arranca el instalador. Sigue el asistente como en la primera instalación. En macOS se abre la imagen de disco: arrastra FlowCast a <em>Aplicaciones</em> y ábrelo de nuevo. En Linux se muestra el AppImage en su carpeta.</li>
</ol>
<p>FlowCast <strong>se niega a instalar mientras se produce un programa</strong> y dice cuál: pulsa el botón de nuevo cuando termine la producción. <strong>Recordármelo después</strong> oculta la barra durante 24 horas; <strong>Omitir esta versión</strong> la oculta hasta que salga una versión más nueva; <strong>Notas de la versión</strong> las muestra. No se instala nada hasta que pulses el botón.</p>
<p>El primer inicio tras una actualización muestra <strong>FlowCast se ha actualizado a…</strong> y una ventana de <strong>Novedades</strong> con los cambios de esa versión.</p>
{{shot:settings-updates}}
<p>Puedes desactivar la comprobación automática en la misma página. Si el correo o Telegram están activados, FlowCast también te avisa de una versión nueva por ahí (y con una notificación de escritorio), <strong>una vez por versión</strong>; puedes desactivarlo con <em>Avisarme de una nueva versión…</em>. Si el mensaje no se puede entregar, se reintenta en la siguiente comprobación.</p>
<p>Los programas y los ajustes se conservan. El botón <strong>📖 Manual de usuario (PDF)</strong> (en la Guía y en <em>Configuración → Ayuda e info</em>) abre este manual para la versión instalada.</p>` },

    { title: 'Copia de seguridad y cambio de PC', html: `
<p>En <em>Configuración → Backup</em>:</p>
<ul>
<li><strong>💾 Exportar todo</strong> guarda programas, ajustes, categorías y marcadores FTP en un archivo JSON (<code>flowcast-backup-AAAA-MM-DD.json</code>), con el mismo formato en todas las apps de OnAir Garage; se rechaza la copia de otro programa. La casilla <strong>Incluir contraseñas y tokens</strong> está desactivada por defecto: así el archivo no lleva contraseñas ni tokens. Si la marcas, aparece un aviso rojo y los secretos se escriben en texto plano;</li>
<li><strong>📥 Importar</strong> carga una copia: <em>Aceptar</em> lo sustituye todo, <em>Cancelar</em> añade solo los programas que faltan.</li>
</ul>
<p>Para cambiar FlowCast de PC: exporta en el PC antiguo, instala FlowCast en el nuevo e importa. Exporta una copia antes de cada actualización.</p>
<div class="note"><strong>Una copia hecha sin la casilla no tiene contraseñas ni tokens:</strong> tras importarla, FlowCast lista lo que debes escribir de nuevo (contraseña SMTP, token de Telegram, contraseñas FTP), también lo que el archivo omitió; los secretos que ya hay en este PC para el mismo servidor y usuario se conservan. Si marcas la casilla, el archivo los contiene en texto plano: guárdalo en un lugar seguro y borra las copias que ya no necesites. En este PC, las contraseñas y los tokens se guardan cifrados con el almacén de claves del sistema.</div>` },

    { title: 'Archivos y registros', html: `
<p>La carpeta de datos es <code>%APPDATA%\\flowcast</code> en Windows, <code>~/Library/Application Support/flowcast</code> en macOS y <code>~/.config/flowcast</code> en Linux; <em>Configuración → Ayuda e info</em> muestra la ruta exacta.</p>
<table>
<tr><th>Archivo o carpeta</th><th>Contenido</th></tr>
<tr><td><code>data.json</code></td><td>programas, ajustes y marcadores</td></tr>
<tr><td><code>alert-state.json</code></td><td>lo que las alertas ya han anunciado (nunca va en una copia de seguridad)</td></tr>
<tr><td><code>stats.json</code></td><td>estadísticas diarias del panel</td></tr>
<tr><td><code>work/&lt;slug&gt;/</code></td><td>archivos de trabajo</td></tr>
<tr><td><code>logs/</code></td><td>un registro por programa y un archivo por día (<code>flowcast_dd-mm-yyyy.log</code>, hasta 5 MB, los últimos 7 días)</td></tr>
<tr><td><code>backups/</code></td><td>una copia de <code>data.json</code> hecha antes de cada actualización (las últimas 3; siguen cifradas, solo se abren en este PC)</td></tr>
<tr><td><code>history/</code></td><td>historial de ejecuciones</td></tr>
</table>
<p>La <strong>Consola</strong> en la parte inferior de la ventana muestra la salida en vivo de cada producción; haz clic en su barra para abrirla o cerrarla.</p>
<p>La pestaña <em>Registro</em> de cada programa tiene <strong>📁 Carpeta</strong>, <strong>💾 Exportar</strong> y <strong>🗑 Borrar</strong>.</p>` },

    { title: 'Preguntas frecuentes y solución de problemas', html: `
<h3>Un programa no se inicia a la hora prevista</h3>
<p>FlowCast debe estar en marcha, aunque sea minimizado en la bandeja. Comprueba que el programa está activado, en modo Programado y dentro de su periodo de validez. Si el PC estaba apagado, la recuperación lo ejecuta en el siguiente inicio.</p>
<h3>«No se ha detectado actualización» pero los archivos son nuevos</h3>
<p>Todas las fuentes con <em>Comprobar actualización</em> deben ser más recientes que la última producción. Desmarca los archivos fijos (cortinillas, intros) o usa <strong>⚡ Forzar</strong> una vez.</p>
<h3>Error de FFmpeg</h3>
<p>Pulsa <strong>Probar</strong> junto a la ruta de FFmpeg. <em>No encontrado</em>: indica la ruta completa de <code>ffmpeg.exe</code>. <em>Codificador desconocido</em>: tu compilación no tiene un codificador (por ejemplo <code>libvorbis</code> para OGG); instala una compilación de gyan.dev o BtbN.</p>
<h3>Falla la subida por FTP</h3>
<ul><li>Comprueba el servidor, el puerto y las credenciales con <strong>🔌 Probar conexión</strong>.</li><li>Comprueba que la carpeta remota existe (botón <strong>📂</strong>).</li><li>Para FTPS activa <em>Usar FTPS (SSL/TLS)</em>; aumenta el tiempo de espera FTP en conexiones lentas.</li></ul>
<h3>La prueba de correo falla con un error de certificado</h3>
<p>El nombre del servidor no coincide con su certificado: usa el nombre del servidor SMTP que te da tu proveedor (capítulo 10).</p>
<h3>macOS dice que no se puede abrir FlowCast</h3>
<p>FlowCast no tiene certificado de Apple. Abre <em>Ajustes del Sistema → Privacidad y seguridad</em> y pulsa <strong>Abrir de todos modos</strong> (capítulo 2).</p>
<h3>macOS dice que FlowCast está «dañado» (versión 26.10.3 o anterior, Apple silicon)</h3>
<p>Instala encima la última versión. O, en Terminal, una sola vez: <code>xattr -cr /Applications/FlowCast.app &amp;&amp; codesign --force --deep -s - /Applications/FlowCast.app</code>.</p>
<h3>Dos entradas de FlowCast en <em>Aplicaciones</em></h3>
<p>Instalaste sobre la versión 26.5.0 o anterior. Exporta una copia de seguridad, desinstala las dos entradas, instala la versión nueva e importa la copia si hace falta.</p>` },

    { title: 'Soporte, privacidad y licencia', html: `
<p>FlowCast es gratuito y de código abierto, creado por Graziano Melzi · OnAir Garage.</p>
<ul>
<li>Página de la herramienta: <code>onairgarage.com/tools/flowcast/</code></li>
<li>Código fuente y versiones: <code>github.com/djgragra/flowcast</code></li>
<li>Contacto: <code>hello@onairgarage.com</code></li>
</ul>
<p><strong>Privacidad.</strong> FlowCast no tiene telemetría. Además de los servidores FTP y SMTP que configuras (y Telegram, si lo activas), solo contacta con GitHub (<code>api.github.com</code>) para buscar actualizaciones, algo que se puede desactivar.</p>
<p><strong>Ayuda e info</strong> (<em>Configuración</em>, o el botón ℹ) tiene la versión, el sistema, los enlaces y dos botones para el soporte: <strong>📋 Copiar info de soporte</strong> pone en el portapapeles la versión, el sistema, el idioma, el nombre de la instalación, la fecha de la última comprobación de actualizaciones y el último error — nunca tus ajustes, direcciones ni contraseñas — para pegarlo en un correo a <code>hello@onairgarage.com</code>; <strong>📂 Abrir carpeta de registros</strong> abre los archivos de registro diarios. Al final de la página, una pequeña tarjeta con una hucha dice que una propina para el autor es bienvenida; su botón abre en el navegador la página de apoyo de onairgarage.com. No aparece en ningún otro sitio y nunca lo pide dos veces.</p>
{{shot:settings-info}}
<p><strong>Licencia.</strong> Licencia MIT, © 2026 Graziano Melzi. FFmpeg es un proyecto aparte, con licencia LGPL/GPL, y no se distribuye con FlowCast.</p>` },
  ]
};
