'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  session,
  shell,
  dialog,
  ipcMain,
  nativeImage,
} = require('electron');
const Store = require('electron-store');
const { SERVICES } = require('./services');

const SIDEBAR_WIDTH = 68; // doit rester synchro avec --sidebar-width dans renderer/style.css
const LOAD_TIMEOUT_MS = 15000; // au-dela, on affiche le bouton "Reessayer"
const PRELOAD_STAGGER_MS = 1500; // delai entre les chargements des services en arriere-plan
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const ICONS_DIR = path.join(__dirname, 'assets', 'icons');

const isDev = process.argv.includes('--dev');

function log(scope, ...args) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] [${scope}]`, ...args);
}

/** id -> { service, view, status, message, timer, badge } */
const views = new Map();
let mainWindow = null;
let tray = null;
let activeId = null;
let isQuitting = false;

// Persistance : geometrie de la fenetre + dernier service actif.
// electron-store ecrit dans %APPDATA%\Nexus\config.json
const store = new Store({
  defaults: {
    window: { width: 1400, height: 900, x: undefined, y: undefined, maximized: false },
    lastActiveId: null,
    // id -> data URI : icones choisies par l'utilisateur (clic droit sur l'icone).
    icons: {},
    // Ordre d'affichage choisi par l'utilisateur (drag & drop dans la sidebar).
    order: [],
    // id -> true : services dont les notifications sont coupees.
    muted: {},
  },
});

function isMuted(id) {
  return Boolean(store.get('muted')?.[id]);
}

/**
 * Services dans l'ordre d'affichage : celui stocke, complete par services.js.
 * Cet ordre fait autorite partout — sidebar, raccourcis Ctrl+1..6, menu tray —
 * pour que la 3e icone soit toujours Ctrl+3.
 * Les ids inconnus (service retire de services.js) sont ignores, les nouveaux
 * services arrivent a la fin sans casser l'ordre existant.
 */
function orderedServices() {
  const stored = store.get('order') || [];
  const byId = new Map(SERVICES.map((service) => [service.id, service]));

  const ordered = stored.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((service) => service.id));

  for (const service of SERVICES) {
    if (!seen.has(service.id)) ordered.push(service);
  }

  return ordered;
}

// Nom affiche par le Action Center Windows pour les notifications natives.
// A definir AVANT app.whenReady() sinon Windows utilise "electron.app.Electron".
app.setAppUserModelId('com.mehdi.nexus');

// Une seule instance : un 2e lancement reveille la fenetre existante.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// ---------------------------------------------------------------------------
// Sessions isolees + override User-Agent + permissions
// ---------------------------------------------------------------------------

const configuredPartitions = new Set();

// Permissions accordees aux services. "notifications" est la cle du sujet :
// c'est ce qui laisse passer les Notification HTML5 vers le Action Center Windows.
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media', // appels audio/video WhatsApp & Discord
  'audioCapture',
  'videoCapture',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'background-sync',
  'display-capture', // partage d'ecran Discord
]);

/**
 * Recupere (ou cree) la session d'un service et y branche l'override d'UA.
 * `persist:xxx` => stockage disque dedie : cookies, localStorage, IndexedDB et
 * Service Workers sont cloisonnes par service. C'est ce qui permet d'avoir 3
 * comptes WhatsApp connectes simultanement sans qu'ils se marchent dessus.
 */
function getServiceSession(service) {
  const ses = session.fromPartition(service.partition);

  // Une seule configuration par partition (les 6 services ont 6 partitions
  // distinctes, mais la fonction est appelee a chaque creation de vue).
  if (configuredPartitions.has(service.partition)) return ses;
  configuredPartitions.add(service.partition);

  if (service.userAgent) {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      headers['User-Agent'] = service.userAgent;

      // Les Client Hints (sec-ch-ua*) trahissent Electron meme quand l'UA string
      // est maquillee. On les supprime : un navigateur non-Chromium n'en envoie
      // pas, donc WhatsApp retombe sur l'analyse de l'User-Agent.
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('sec-ch-ua')) delete headers[key];
      }

      callback({ requestHeaders: headers });
    });

    // Cote renderer : aligne navigator.userAgent sur l'en-tete HTTP.
    ses.setUserAgent(service.userAgent);
    log('session', `${service.partition} : UA override actif`);
  }

  const allows = (permission) => {
    if (permission === 'notifications' && isMuted(service.id)) return false;
    return ALLOWED_PERMISSIONS.has(permission);
  };

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = allows(permission);
    log('permission', `${service.id} demande "${permission}" -> ${granted ? 'OK' : 'refuse'}`);
    callback(granted);
  });

  // Repond a Notification.permission / navigator.permissions.query() sans prompt.
  ses.setPermissionCheckHandler((_wc, permission) => allows(permission));

  return ses;
}

// ---------------------------------------------------------------------------
// Icones de service
//
// Priorite : 1) icone choisie dans l'app (clic droit > Changer l'icone),
//               persistee en data URI dans electron-store
//            2) fichier local declare via `icon` dans services.js
//            3) favicon du site, recuperee automatiquement
//            4) initiales colorees (fallback)
// Le renderer a une CSP stricte (img-src 'self' data:) : on lui envoie donc des
// data URI plutot que des chemins disque ou des URL distantes.
// ---------------------------------------------------------------------------

const iconCache = new Map(); // id -> favicon deja envoyee (evite les renvois inutiles)

/** Icone choisie par l'utilisateur, si elle existe. */
function storedIcon(id) {
  return store.get('icons')?.[id] || null;
}

/**
 * Icone effective d'un service, tous niveaux confondus.
 * `source` sert au renderer : la pastille d'initiales n'est affichee que sur les
 * icones automatiques (favicon), la ou deux services peuvent se ressembler. Des
 * que l'utilisateur a choisi son icone, elle disparait.
 */
function resolveIcon(service) {
  const stored = storedIcon(service.id);
  if (stored) return { dataUrl: stored, source: 'user' };

  const declared = loadCustomIcon(service);
  if (declared) return { dataUrl: declared, source: 'declared' };

  const favicon = iconCache.get(service.id);
  if (favicon) return { dataUrl: favicon, source: 'favicon' };

  return { dataUrl: null, source: null };
}

/**
 * Ouvre un selecteur de fichier et enregistre l'image choisie comme icone du
 * service. On stocke une data URI 64x64 plutot qu'un chemin : l'icone survit au
 * deplacement ou a la suppression du fichier source.
 */
async function chooseIcon(id) {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) return;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: `Icone de ${service.name}`,
    buttonLabel: 'Utiliser cette image',
    properties: ['openFile'],
    // nativeImage ne decode que PNG / JPEG (+ ICO sous Windows).
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico'] }],
  });

  if (canceled || !filePaths[0]) return;

  const image = nativeImage.createFromPath(filePaths[0]);
  if (image.isEmpty()) {
    log('icon', `${id} : image illisible -> ${filePaths[0]}`);
    dialog.showErrorBox(
      'Image illisible',
      'Ce fichier ne peut pas etre decode. Formats acceptes : PNG, JPEG, ICO.'
    );
    return;
  }

  // 128px : l'avatar fait 48px mais on garde de la marge pour les ecrans HiDPI.
  const dataUrl = image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
  store.set(`icons.${id}`, dataUrl);
  log('icon', `${id} : icone personnalisee definie (${path.basename(filePaths[0])})`);
  send('hub:icon', { id, dataUrl, source: 'user' });
}

/** Supprime l'icone choisie : on retombe sur services.js, puis la favicon. */
function resetIcon(id) {
  const icons = { ...store.get('icons') };
  delete icons[id];
  store.set('icons', icons);

  const service = SERVICES.find((s) => s.id === id);
  const { dataUrl, source } = resolveIcon(service);
  log('icon', `${id} : icone personnalisee retiree -> ${source || 'initiales'}`);
  send('hub:icon', { id, dataUrl, source });
}

/** Charge l'icone locale d'un service, si `icon` est renseigne. */
function loadCustomIcon(service) {
  if (!service.icon) return null;

  const file = path.isAbsolute(service.icon) ? service.icon : path.join(ICONS_DIR, service.icon);
  const image = nativeImage.createFromPath(file);

  if (image.isEmpty()) {
    log('icon', `${service.id} : fichier introuvable ou illisible -> ${file}`);
    return null;
  }

  log('icon', `${service.id} : icone locale ${path.basename(file)}`);
  return image.resize({ width: 64, height: 64 }).toDataURL();
}

// Score attribue aux icones vectorielles : elles restent nettes a n'importe
// quelle taille, elles doivent donc battre n'importe quel bitmap.
const SVG_SCORE = 4096;

/**
 * Determine le vrai format a partir des octets. Les serveurs mentent ou se
 * taisent : web.whatsapp.com sert un .ico sans content-type exploitable, ce qui
 * le rendait indecodable ET non identifiable. Les nombres magiques, eux, ne
 * mentent pas.
 */
function sniffMime(buffer, fallback) {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
      return 'image/x-icon';
    }
    if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
    if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
  }

  if (buffer.toString('utf8', 0, 300).trimStart().startsWith('<')) return 'image/svg+xml';
  return fallback;
}

/**
 * Score de qualite d'une icone = sa largeur en pixels.
 * getSize() renvoie 0 pour ce que nativeImage ne decode pas (SVG notamment) :
 * le SVG est traite a part, le reste retombe a 0 et perd face a tout bitmap
 * mesurable.
 */
/**
 * Largeur d'un WebP, lue dans son en-tete. nativeImage ne decode pas ce format
 * (Chromium si, l'icone s'affiche donc normalement) et web.whatsapp.com sert sa
 * favicon en WebP : sans ca elle serait scoree 0 et perdrait face a n'importe
 * quelle favicon dynamique de 16px.
 */
function webpWidth(buffer) {
  if (buffer.length < 30) return 0;

  switch (buffer.toString('latin1', 12, 16)) {
    case 'VP8X': // etendu : largeur du canvas sur 3 octets, moins 1
      return buffer.readUIntLE(24, 3) + 1;
    case 'VP8 ': // avec perte : 14 bits apres le sync code
      return buffer.readUInt16LE(26) & 0x3fff;
    case 'VP8L': // sans perte : 14 bits apres la signature, moins 1
      return (buffer.readUInt32LE(21) & 0x3fff) + 1;
    default:
      return 0;
  }
}

function iconWidth(candidate) {
  if (/svg/i.test(candidate.mime)) return SVG_SCORE;
  if (/webp/i.test(candidate.mime)) return webpWidth(candidate.buffer);

  // nativeImage ne decode pas les .ico depuis un buffer. Chromium, lui, sait les
  // afficher et y choisit la meilleure frame : on leur donne un score plancher
  // honorable, au-dessus des favicons dynamiques 16/32px mais sous un vrai PNG
  // haute definition.
  if (/icon/i.test(candidate.mime)) return 128;

  return nativeImage.createFromBuffer(candidate.buffer).getSize().width || 0;
}

/** Decode une data URI en buffer, pour la comparer aux favicons telechargees. */
function decodeDataUrl(url) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;

  const [, mime, base64, payload] = match;
  return {
    mime: mime || 'image/png',
    buffer: base64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8'),
  };
}

/**
 * Telecharge la favicon du service et la convertit en data URI.
 * Le fetch passe par la session du service : certains sites protegent leurs
 * assets derriere la session (et ca evite une requete hors partition).
 */
async function fetchFavicon(entry, urls) {
  const { service } = entry;
  const candidates = (urls || []).filter(Boolean);
  if (!candidates.length) return;

  // Une icone de priorite superieure est en place : on met quand meme la favicon
  // en cache (elle servira si l'utilisateur fait "Icone par defaut") mais on ne
  // l'affiche pas.
  const overridden = Boolean(storedIcon(service.id) || service.icon);
  // Les sites emettent page-favicon-updated plusieurs fois par chargement, et
  // pas forcement du meilleur au pire : Discord annonce d'abord son icone
  // vectorielle, puis une version canvas de 16px avec son compteur incruste. On
  // garde donc le meilleur score depuis le dernier chargement, pas le dernier
  // arrive. (entry.iconScore est remis a zero par loadService.)
  const publish = (dataUrl, score, note = '') => {
    if (iconCache.get(service.id) === dataUrl) return;

    if (entry.iconScore != null && score <= entry.iconScore) {
      log('icon', `${service.id} : favicon ${note} ignoree (moins bonne que l'actuelle)`);
      return;
    }

    entry.iconScore = score;
    iconCache.set(service.id, dataUrl);
    log('icon', `${service.id} : favicon retenue ${note}`.trim());
    if (!overridden) send('hub:icon', { id: service.id, dataUrl, source: 'favicon' });
  };

  try {
    // Un site declare souvent plusieurs icones : plusieurs tailles (16, 32,
    // 192...) et parfois une favicon dynamique en data URI, dessinee au canvas
    // pour y incruster son compteur de non-lus (Discord le fait). Cette
    // derniere est minuscule. L'avatar faisant 48px, on recupere TOUTES les
    // candidates et on garde la plus definie.
    const downloads = await Promise.all(
      candidates.map(async (candidate) => {
        if (candidate.startsWith('data:')) return decodeDataUrl(candidate);
        try {
          const response = await entry.view.webContents.session.fetch(candidate);
          if (!response.ok) return null;
          const buffer = Buffer.from(await response.arrayBuffer());
          const declared = (response.headers.get('content-type') || '').split(';')[0];
          return { buffer, mime: sniffMime(buffer, declared || 'image/png') };
        } catch {
          return null;
        }
      })
    );

    const best = downloads
      .filter(Boolean)
      .map((candidate) => ({ ...candidate, width: iconWidth(candidate) }))
      .sort((a, b) => b.width - a.width || b.buffer.length - a.buffer.length)[0];

    if (!best) throw new Error('aucune candidate exploitable');

    publish(
      `data:${best.mime};base64,${best.buffer.toString('base64')}`,
      best.width,
      `(${best.width >= SVG_SCORE ? 'vectorielle' : `${best.width || '?'}px`}, ` +
        `${best.mime}, ${Math.round(best.buffer.length / 1024)} Ko, ` +
        `${candidates.length} candidate(s))`
    );
  } catch (err) {
    log('icon', `${service.id} : favicon indisponible (${err.message}) -> initiales`);
  }
}

// ---------------------------------------------------------------------------
// Coupure des notifications, service par service
//
// Refuser la permission ne suffit pas : les sites l'ont deja obtenue et en
// gardent l'etat en cache. On enveloppe donc window.Notification dans la page
// elle-meme. executeJavaScript s'execute dans le monde principal — contrairement
// a un preload qui, avec contextIsolation, ne pourrait pas toucher au
// window du site.
//
// Le wrapper n'est pose qu'une fois ; ensuite seul le drapeau bascule, ce qui
// rend le mute/unmute instantane, sans rechargement.
// ---------------------------------------------------------------------------

const notificationPatch = (muted) => `(() => {
  const Native = window.__nexusNativeNotification || window.Notification;
  if (!Native) return 'sans-Notification';

  window.__nexusNativeNotification = Native;
  window.__nexusMuted = ${muted};

  if (!window.__nexusPatched) {
    const Patched = function (title, options) {
      if (window.__nexusMuted) {
        // Objet inerte : les sites branchent onclick/onclose dessus juste apres.
        return { title, body: (options || {}).body, close() {},
                 addEventListener() {}, removeEventListener() {} };
      }
      return new Native(title, options);
    };

    Patched.requestPermission = (...args) => Native.requestPermission(...args);
    Object.defineProperty(Patched, 'permission', { get: () => Native.permission });
    window.Notification = Patched;
    window.__nexusPatched = true;
  }

  return window.__nexusMuted ? 'coupe' : 'actif';
})()`;

function applyMuteState(entry) {
  const muted = isMuted(entry.service.id);

  entry.view.webContents
    .executeJavaScript(notificationPatch(muted), true)
    .then((state) => log('mute', `${entry.service.id} : notifications ${state}`))
    .catch((err) => log('mute', `${entry.service.id} : patch impossible (${err.message})`));
}

function setMuted(id, muted) {
  store.set('muted', { ...store.get('muted'), [id]: muted });

  const entry = views.get(id);
  if (entry) applyMuteState(entry);
  else log('mute', `${id} : ${muted ? 'coupe' : 'actif'} (service pas encore charge)`);
}

// ---------------------------------------------------------------------------
// Vues de service (WebContentsView, remplacant de BrowserView depuis Electron 30)
// ---------------------------------------------------------------------------

// Hotes autorises a ouvrir une vraie popup Electron : ce sont les flux d'auth
// (Google/Discord) qui ont besoin de la session du service. Tout le reste part
// dans le navigateur systeme.
const AUTH_HOST_PATTERNS = [
  /(^|\.)accounts\.google\.com$/,
  /(^|\.)accounts\.youtube\.com$/,
  /(^|\.)discord\.com$/,
  /(^|\.)whatsapp\.com$/,
];

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isAuthPopup(url) {
  const host = hostOf(url);
  return host ? AUTH_HOST_PATTERNS.some((re) => re.test(host)) : false;
}

function createServiceView(service) {
  const view = new WebContentsView({
    webPreferences: {
      session: getServiceSession(service),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sans ca, Chromium throttle les timers/WebSocket des vues cachees :
      // les 5 services en arriere-plan rateraient leurs notifications.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  view.setBackgroundColor('#1e1e2e');

  const entry = { service, view, status: 'idle', timer: null, badge: 0 };
  views.set(service.id, entry);

  const wc = view.webContents;

  // Les raccourcis doivent marcher quand le focus est dans le service (cas
  // normal) et pas seulement dans la sidebar.
  wc.on('before-input-event', handleShortcut);

  // dom-ready plutot que did-finish-load : on veut envelopper Notification avant
  // que le site n'en garde une reference.
  wc.on('dom-ready', () => applyMuteState(entry));

  wc.on('did-finish-load', () => setStatus(entry, 'ready'));

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED : navigation annulee (redirection interne), pas une erreur.
    if (!isMainFrame || errorCode === -3) return;
    setStatus(entry, 'error', `${errorDescription} (${errorCode}) sur ${validatedURL}`);
  });

  wc.on('render-process-gone', (_e, details) => {
    setStatus(entry, 'error', `Process renderer termine : ${details.reason}`);
  });

  // Detection des notifications non lues : les webapps mettent le compteur dans
  // le titre de l'onglet -> "(3) WhatsApp", "(1) Discord", "(12) Google Agenda".
  wc.on('page-title-updated', (_e, title) => updateBadge(entry, title));

  // Icone : favicon officielle du site, sauf si une icone locale est declaree.
  wc.on('page-favicon-updated', (_e, favicons) => fetchFavicon(entry, favicons));

  wc.setWindowOpenHandler(({ url }) => {
    if (isAuthPopup(url)) {
      log('popup', service.id, url);
      return {
        action: 'allow',
        // La popup herite de la session du service, sinon le login echoue.
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          width: 620,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: {
            session: getServiceSession(service),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }

    log('external', service.id, url);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Une popup d'auth ne doit pas SURVIVRE au login : une fois le flux termine,
  // le site renvoie la popup vers son propre domaine (ex. accounts.google.com
  // -> calendar.google.com). A ce moment on la ferme et on reprend la main dans
  // la vue principale, qui partage la meme session (donc deja authentifiee).
  wc.on('did-create-window', (child, { url }) => {
    const serviceHost = hostOf(service.url);
    let absorbed = false;

    log('popup', `${service.id} : fenetre ouverte (${url})`);

    child.webContents.on('did-navigate', (_e, navigatedUrl) => {
      if (absorbed || hostOf(navigatedUrl) !== serviceHost) return;
      absorbed = true;
      log('popup', `${service.id} : flux termine -> retour dans la fenetre principale`);
      wc.loadURL(navigatedUrl);
      setImmediate(() => !child.isDestroyed() && child.close());
    });

    child.on('closed', () => {
      // Popup fermee sans redirection detectee (login termine puis fermeture
      // manuelle) : on recharge le service pour prendre en compte la session.
      if (absorbed) return;
      log('popup', `${service.id} : fermee -> rechargement du service`);
      if (!wc.isDestroyed()) wc.reload();
    });
  });

  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  layoutViews();

  loadService(entry);
  return entry;
}

function loadService(entry) {
  const { service, view } = entry;
  clearTimeout(entry.timer);
  entry.iconScore = null; // nouvelle page = nouvelle competition entre favicons
  setStatus(entry, 'loading');
  log('load', service.id, '->', service.url);

  view.webContents
    .loadURL(service.url, { userAgent: service.userAgent })
    .catch((err) => setStatus(entry, 'error', err.message));

  // Garde-fou : si rien n'a charge au bout de 15s, on rend la main a l'UI.
  entry.timer = setTimeout(() => {
    if (entry.status === 'loading') {
      setStatus(entry, 'error', `Timeout : aucune reponse apres ${LOAD_TIMEOUT_MS / 1000}s`);
    }
  }, LOAD_TIMEOUT_MS);
}

function setStatus(entry, status, message) {
  if (status !== 'loading') clearTimeout(entry.timer);
  entry.status = status;
  entry.message = message;

  if (status === 'ready') log('ready', entry.service.id, '-', entry.view.webContents.getTitle());
  if (status === 'error') log('error', entry.service.id, '-', message);

  // En erreur la vue est masquee : l'overlay "Reessayer" du renderer principal
  // devient visible dessous.
  if (entry.service.id === activeId) {
    entry.view.setVisible(status !== 'error');
  }

  send('hub:status', { id: entry.service.id, status, message });
}

/**
 * Parse le compteur de non-lus dans le titre de la page.
 *  "(3) WhatsApp"       -> 3
 *  "(1) Discord | #dev" -> 1
 *  "• WhatsApp"         -> -1 (non-lus sans compteur : on affiche une pastille)
 *  "WhatsApp"           -> 0
 */
function parseBadgeCount(title) {
  const match = /\((\d+)\)/.exec(title || '');
  if (match) return Number(match[1]);
  if (/^\s*[•●*]/.test(title || '')) return -1;
  return 0;
}

function updateBadge(entry, title) {
  const count = parseBadgeCount(title);
  if (count === entry.badge) return;

  entry.badge = count;
  log('badge', entry.service.id, `-> ${count} (titre: "${title}")`);
  send('hub:badge', { id: entry.service.id, count });
  refreshTrayTooltip();
}

function showService(id) {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) return;

  activeId = id;
  store.set('lastActiveId', id);

  const entry = views.get(id) || createServiceView(service);

  for (const [otherId, other] of views) {
    other.view.setVisible(otherId === id && other.status !== 'error');
  }

  layoutViews();
  if (entry.status !== 'error') entry.view.webContents.focus();

  log('switch', id);
  send('hub:active', { id });
}

// ---------------------------------------------------------------------------
// Layout : la vue active occupe toute la fenetre moins la sidebar
// ---------------------------------------------------------------------------

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // getContentBounds = zone client (hors bordures/barre de titre OS).
  const { width, height } = mainWindow.getContentBounds();
  const bounds = {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height: Math.max(0, height),
  };

  for (const entry of views.values()) entry.view.setBounds(bounds);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Raccourcis clavier
// ---------------------------------------------------------------------------

/**
 * On passe par before-input-event plutot que par globalShortcut (qui capterait
 * les touches meme quand l'app n'a pas le focus) ou par un Menu applicatif
 * (dont les accelerateurs sont parfois avales par les webapps). Ce handler est
 * branche sur la sidebar ET sur chaque vue de service.
 */
function handleShortcut(event, input) {
  if (input.type !== 'keyDown' || !input.control) return;

  const key = (input.key || '').toLowerCase();
  const activeEntry = views.get(activeId);

  // Ctrl+1..6 : switch de service, dans l'ordre affiche par la sidebar
  const digit = Number(key);
  if (!input.shift && digit >= 1 && digit <= SERVICES.length) {
    event.preventDefault();
    showService(orderedServices()[digit - 1].id);
    return;
  }

  if (key === 'r' && activeEntry) {
    event.preventDefault();
    if (input.shift) {
      // Hard reload : on vide le cache HTTP de la partition avant de recharger.
      log('shortcut', `hard reload ${activeId}`);
      activeEntry.view.webContents.session
        .clearCache()
        .then(() => activeEntry.view.webContents.reloadIgnoringCache());
    } else {
      log('shortcut', `reload ${activeId}`);
      activeEntry.view.webContents.reload();
    }
    return;
  }

  if (key === 'i' && input.shift && activeEntry) {
    event.preventDefault();
    activeEntry.view.webContents.toggleDevTools();
    return;
  }

  if (key === ',' && !input.shift) {
    event.preventDefault();
    mainWindow.webContents.toggleDevTools();
    return;
  }

  if (key === 'q' && !input.shift) {
    event.preventDefault();
    quitApp();
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Nexus');

  // Clic gauche : show/hide. Clic droit : menu (gere par setContextMenu).
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
      log('tray', 'fenetre masquee');
    } else {
      showWindow();
    }
  });

  refreshTrayMenu();
  log('tray', 'icone creee');
}

function refreshTrayMenu() {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    ...orderedServices().map((service, index) => ({
      label: service.name,
      accelerator: `CommandOrControl+${index + 1}`,
      click: () => {
        showWindow();
        showService(service.id);
      },
    })),
    { type: 'separator' },
    { label: 'Afficher / masquer', click: () => (mainWindow?.isVisible() ? mainWindow.hide() : showWindow()) },
    { type: 'separator' },
    { label: 'Quitter', accelerator: 'CommandOrControl+Q', click: quitApp },
  ]);

  tray.setContextMenu(menu);
}

function refreshTrayTooltip() {
  if (!tray) return;
  const total = [...views.values()].reduce((sum, e) => sum + Math.max(0, e.badge), 0);
  tray.setToolTip(total > 0 ? `Nexus - ${total} non lus` : 'Nexus');
}

// ---------------------------------------------------------------------------
// Fenetre principale (son webContents = la sidebar)
// ---------------------------------------------------------------------------

let saveStateTimer = null;

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const maximized = mainWindow.isMaximized();
  // En maximise, getBounds() renvoie la taille plein ecran : on garde les
  // dernieres dimensions "normales" pour la restauration.
  const bounds = maximized ? store.get('window') : mainWindow.getBounds();
  store.set('window', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized,
  });
}

function scheduleSaveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 400);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const saved = store.get('window');

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    show: false,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null); // pas de menu natif : tout passe par les raccourcis
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('before-input-event', handleShortcut);

  mainWindow.once('ready-to-show', () => {
    if (saved.maximized) mainWindow.maximize();
    mainWindow.show();

    // Dernier service actif au relancement (ou le premier de la liste).
    const services = orderedServices();
    const lastId = store.get('lastActiveId');
    const startId = services.some((s) => s.id === lastId) ? lastId : services[0].id;
    showService(startId);

    // Les autres services sont charges en arriere-plan, en quinconce : sans ca
    // leurs badges et leurs notifications ne remonteraient qu'apres un premier
    // clic sur leur icone.
    let delay = PRELOAD_STAGGER_MS;
    for (const service of services) {
      if (service.id === startId) continue;

      // `preload: false` dans services.js : service charge seulement au premier
      // clic. Il economise un process Chromium, mais ne remonte ni badge ni
      // notification tant qu'il n'a pas ete ouvert au moins une fois.
      if (service.preload === false) {
        log('preload', `${service.id} ignore (preload: false)`);
        continue;
      }

      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || views.has(service.id)) return;
        log('preload', service.id);
        createServiceView(service);
      }, delay);
      delay += PRELOAD_STAGGER_MS;
    }

    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Resize : recalculer les bounds a chaque changement de taille/etat.
  mainWindow.on('resize', () => {
    layoutViews();
    scheduleSaveWindowState();
  });
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', () => {
    layoutViews();
    saveWindowState();
  });
  mainWindow.on('unmaximize', () => {
    layoutViews();
    saveWindowState();
  });
  mainWindow.on('enter-full-screen', layoutViews);
  mainWindow.on('leave-full-screen', layoutViews);

  // Clic sur X = minimize to tray. Le vrai quit passe par le menu tray ou Ctrl+Q.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    saveWindowState();
    mainWindow.hide();
    log('window', 'fermeture interceptee -> minimise dans le tray');
  });

  mainWindow.on('closed', () => {
    for (const entry of views.values()) clearTimeout(entry.timer);
    views.clear();
    mainWindow = null;
  });
}

function quitApp() {
  log('app', 'quit demande');
  isQuitting = true;
  saveWindowState();
  app.quit();
}

// ---------------------------------------------------------------------------
// IPC sidebar -> main
// ---------------------------------------------------------------------------

ipcMain.handle('hub:bootstrap', () => ({
  // On n'expose que le strict necessaire a l'UI (pas les UA ni les partitions).
  services: orderedServices().map((service) => ({
    id: service.id,
    name: service.name,
    color: service.color,
    initials: service.initials,
    // Icone choisie > icone declaree dans services.js > derniere favicon connue
    // (le renderer peut etre recharge alors que les services tournent deja).
    ...resolveIcon(service),
  })),
  activeId,
  // Base servant a composer l'icone du tray avec le compteur par-dessus.
  trayBase: nativeImage.createFromPath(ICON_PATH).resize({ width: 64, height: 64 }).toDataURL(),
}));

/** Enregistre un nouvel ordre complet (drag & drop cote sidebar). */
ipcMain.on('hub:reorder', (_e, ids) => {
  const known = new Set(SERVICES.map((service) => service.id));
  const order = (ids || []).filter((id) => known.has(id));

  // Un ordre partiel signifierait un desaccord entre la sidebar et services.js :
  // on prefere ne rien enregistrer plutot que de perdre un service.
  if (order.length !== SERVICES.length) {
    log('order', `ordre ignore : ${order.length}/${SERVICES.length} services`);
    return;
  }

  store.set('order', order);
  refreshTrayMenu();
  log('order', order.join(' > '));
});

/** Deplacement d'un cran depuis le menu contextuel. */
function moveService(id, delta) {
  const order = orderedServices().map((service) => service.id);
  const index = order.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return;

  order.splice(target, 0, order.splice(index, 1)[0]);
  store.set('order', order);
  refreshTrayMenu();
  log('order', `${id} -> position ${target + 1} (${order.join(' > ')})`);
  send('hub:order', { order });
}

// Clic droit sur une icone de la sidebar : menu natif (icone, ordre, reload).
ipcMain.on('hub:service-menu', (_e, id) => {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) return;

  const order = orderedServices();
  const index = order.findIndex((s) => s.id === id);
  const entry = views.get(id);

  const menu = Menu.buildFromTemplate([
    { label: service.name, enabled: false },
    { type: 'separator' },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: !isMuted(id),
      click: (item) => setMuted(id, !item.checked),
    },
    { type: 'separator' },
    { label: "Changer l'icone...", click: () => chooseIcon(id) },
    { label: 'Icone par defaut', enabled: Boolean(storedIcon(id)), click: () => resetIcon(id) },
    { type: 'separator' },
    { label: 'Monter', enabled: index > 0, click: () => moveService(id, -1) },
    {
      label: 'Descendre',
      enabled: index >= 0 && index < order.length - 1,
      click: () => moveService(id, 1),
    },
    { type: 'separator' },
    { label: 'Recharger', enabled: Boolean(entry), click: () => entry?.view.webContents.reload() },
    {
      label: 'Outils de developpement',
      enabled: Boolean(entry),
      click: () => entry?.view.webContents.toggleDevTools(),
    },
  ]);

  menu.popup({ window: mainWindow });
});

// Icone du tray redessinee avec le compteur incruste (composee au canvas cote
// renderer). Sans compteur, on remet le fichier d'origine.
ipcMain.on('hub:tray-icon', (_e, dataUrl) => {
  if (!tray) return;
  tray.setImage(
    dataUrl ? nativeImage.createFromDataURL(dataUrl) : nativeImage.createFromPath(ICON_PATH)
  );
});

// Compteur de non-lus sur l'icone de la barre des taches Windows.
// app.setBadgeCount() n'est pas supporte sous Windows : on passe par une
// "overlay icon", dessinee au canvas cote renderer puis transmise ici.
ipcMain.on('hub:overlay', (_e, { dataUrl, description }) => {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setOverlayIcon(
    dataUrl ? nativeImage.createFromDataURL(dataUrl) : null,
    description || ''
  );
});

ipcMain.on('hub:select', (_e, id) => showService(id));

ipcMain.on('hub:retry', (_e, id) => {
  const entry = views.get(id);
  if (entry) loadService(entry);
});

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  log('app', `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`);
  log('app', `${SERVICES.length} services : ${SERVICES.map((s) => s.id).join(', ')}`);
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  tray?.destroy();
  tray = null;
});

// La fenetre etant masquee (jamais fermee) tant qu'on ne quitte pas vraiment,
// cet evenement ne se declenche qu'apres un quit explicite.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
