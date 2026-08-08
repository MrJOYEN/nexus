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
  clipboard,
  nativeImage,
} = require('electron');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { SERVICE_DEFAULTS, CHROME_UA } = require('./services');
const { CATALOG } = require('./catalog');
const { SVG_SCORE, sniffMime, iconWidth, decodeDataUrl } = require('./images');
const catalogIcons = require('./catalog-icons');
const i18n = require('./i18n');
const { t } = i18n;

const REPO_URL = 'https://github.com/MrJOYEN/nexus';

const SIDEBAR_WIDTH = 68; // doit rester synchro avec --sidebar-width dans renderer/style.css
const LOAD_TIMEOUT_MS = 15000; // au-dela, on affiche le bouton "Reessayer"
const PRELOAD_STAGGER_MS = 1500; // delai entre les chargements des services en arriere-plan
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const ICONS_DIR = path.join(__dirname, 'assets', 'icons');

const isDev = process.argv.includes('--dev');
// Passe par l'entree de demarrage Windows quand "demarrer masque" est actif :
// l'app s'ouvre dans la zone de notification, sans fenetre.
const startHidden = process.argv.includes('--hidden');

function log(scope, ...args) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] [${scope}]`, ...args);
}

/** id -> { service, view, status, message, timer, hibernateTimer, badge, iconScore } */
const views = new Map();
/** Services volontairement dechargés : connus, configures, mais sans process. */
const hibernated = new Set();

let mainWindow = null;
let tray = null;
let activeId = null;
let isQuitting = false;
// Demarrage masque avec une fenetre qui etait maximisee : maximize() afficherait
// la fenetre, on note l'etat et on l'applique au premier vrai affichage.
let pendingMaximize = false;
let pendingUpdate = null; // version telechargee, en attente de redemarrage

// Persistance : electron-store ecrit dans %APPDATA%\Nexus\config.json
const store = new Store({
  defaults: {
    window: { width: 1400, height: 900, x: undefined, y: undefined, maximized: false },
    lastActiveId: null,
    // La liste des services vit ici : construite a l'onboarding, editee depuis
    // l'app. Aucun fichier de code ne la definit.
    services: [],
    // Onboarding termine ? Tant que non (et que la liste est vide), le premier
    // lancement affiche l'accueil plutot qu'une fenetre vide.
    onboarded: false,
    // id -> data URI : icones choisies par l'utilisateur (clic droit sur l'icone).
    icons: {},
    // Ordre d'affichage choisi par l'utilisateur (drag & drop dans la sidebar).
    order: [],
    // id -> true : services dont les notifications sont coupees.
    muted: {},
    // 'system' ou un code de langue disponible ('en', 'fr', 'es').
    language: 'system',
    // Lancement avec Windows, et demarrage masque dans la zone de notification.
    autostart: false,
    autostartHidden: false,
  },
});

// ---------------------------------------------------------------------------
// Catalogue de services
// ---------------------------------------------------------------------------

/** Complete un service stocke avec les valeurs par defaut. */
function withDefaults(service) {
  return { ...SERVICE_DEFAULTS, ...service };
}

/**
 * L'onboarding ne se montre qu'une fois : premier lancement, aucune config.
 * Une installation qui a deja des services (mise a jour depuis une version
 * anterieure a l'onboarding) est consideree comme deja accueillie.
 */
function needsOnboarding() {
  if (store.get('onboarded')) return false;
  if (allServices().length) {
    store.set('onboarded', true);
    return false;
  }
  return true;
}

function allServices() {
  return (store.get('services') || []).map(withDefaults);
}

function getService(id) {
  return allServices().find((service) => service.id === id) || null;
}

/** User-Agent effectif : Chrome maquille, ou celui d'Electron par defaut. */
function userAgentFor(service) {
  return service?.spoofUserAgent ? CHROME_UA : undefined;
}

/**
 * Services dans l'ordre d'affichage. Cet ordre fait autorite partout — sidebar,
 * raccourcis Ctrl+1..9, menu tray — pour que la 3e icone soit toujours Ctrl+3.
 * Les ids inconnus sont ignores, les services non classes arrivent a la fin.
 */
function orderedServices() {
  const services = allServices();
  const stored = store.get('order') || [];
  const byId = new Map(services.map((service) => [service.id, service]));

  const ordered = stored.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((service) => service.id));

  for (const service of services) {
    if (!seen.has(service.id)) ordered.push(service);
  }

  return ordered;
}

function isMuted(id) {
  return Boolean(store.get('muted')?.[id]);
}

function slugify(text) {
  return (
    (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // diacritiques laissees par NFD
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'service'
  );
}

// Identite Windows de l'app : elle determine le nom affiche par le Action Center
// pour les notifications, mais aussi l'icone et le libelle dans la barre des
// taches — Windows resout cet identifiant vers un raccourci du menu Demarrer et
// lui emprunte son icone, celle de l'exe etant ignoree.
//
// D'ou l'identifiant distinct hors packaging : en dev, Chromium fabrique tout
// seul un raccourci pointant sur electron.exe pour autoriser les toasts. S'il
// portait le meme identifiant que l'app installee, il lui volerait son identite
// et la barre des taches afficherait le logo Electron.
//
// A definir AVANT app.whenReady().
app.setAppUserModelId(app.isPackaged ? 'com.mehdi.nexus' : 'com.mehdi.nexus.dev');

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
  // Sans elle, Chromium s'autorise a evincer l'IndexedDB du site sous pression
  // disque — donc a deconnecter un compte. WhatsApp la demande a chaque
  // chargement, et l'etancheite des sessions est la raison d'etre de l'app.
  'persistent-storage',
]);

/**
 * Recupere (ou cree) la session d'un service et y branche l'override d'UA.
 * `persist:xxx` => stockage disque dedie : cookies, localStorage, IndexedDB et
 * Service Workers sont cloisonnes par service. C'est ce qui permet d'avoir 3
 * comptes WhatsApp connectes simultanement sans qu'ils se marchent dessus.
 */
function getServiceSession(service) {
  const ses = session.fromPartition(service.partition);

  if (configuredPartitions.has(service.partition)) return ses;
  configuredPartitions.add(service.partition);

  const id = service.id;

  // Les handlers relisent le service dans le store a chaque appel : ses reglages
  // sont editables a chaud, une closure figee les rendrait obsoletes.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const ua = userAgentFor(getService(id));
    if (!ua) return callback({ requestHeaders: details.requestHeaders });

    const headers = details.requestHeaders;
    headers['User-Agent'] = ua;

    // Les Client Hints (sec-ch-ua*) trahissent Electron meme quand l'UA string
    // est maquillee. On les supprime : un navigateur non-Chromium n'en envoie
    // pas, donc WhatsApp retombe sur l'analyse de l'User-Agent.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('sec-ch-ua')) delete headers[key];
    }

    callback({ requestHeaders: headers });
  });

  applySessionUserAgent(service);

  const allows = (permission) => {
    if (permission === 'notifications' && isMuted(id)) return false;
    return ALLOWED_PERMISSIONS.has(permission);
  };

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const granted = allows(permission);
    log('permission', `${id} demande "${permission}" -> ${granted ? 'OK' : 'refuse'}`);
    callback(granted);
  });

  // Repond a Notification.permission / navigator.permissions.query() sans prompt.
  ses.setPermissionCheckHandler((_wc, permission) => allows(permission));

  return ses;
}

/** Aligne navigator.userAgent sur l'en-tete HTTP (a rejouer apres edition). */
function applySessionUserAgent(service) {
  const ua = userAgentFor(service);
  if (!ua) return;
  session.fromPartition(service.partition).setUserAgent(ua);
  log('session', `${service.partition} : UA override actif`);
}

// ---------------------------------------------------------------------------
// Icones de service
//
// Priorite : 1) icone choisie dans l'app (clic droit > Changer l'icone),
//               persistee en data URI dans electron-store
//            2) fichier local declare via `icon`
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
 * service. On stocke une data URI plutot qu'un chemin : l'icone survit au
 * deplacement ou a la suppression du fichier source.
 */
async function chooseIcon(id) {
  const service = getService(id);
  if (!service) return;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: t('icon.title', { name: service.name }),
    buttonLabel: t('icon.button'),
    properties: ['openFile'],
    // nativeImage ne decode que PNG / JPEG (+ ICO sous Windows).
    filters: [{ name: t('icon.filter'), extensions: ['png', 'jpg', 'jpeg', 'ico'] }],
  });

  if (canceled || !filePaths[0]) return;

  const image = nativeImage.createFromPath(filePaths[0]);
  if (image.isEmpty()) {
    log('icon', `${id} : image illisible -> ${filePaths[0]}`);
    dialog.showErrorBox(t('icon.errorTitle'), t('icon.errorDetail'));
    return;
  }

  // 128px : l'avatar fait 48px mais on garde de la marge pour les ecrans HiDPI.
  const dataUrl = image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
  store.set(`icons.${id}`, dataUrl);
  log('icon', `${id} : icone personnalisee definie (${path.basename(filePaths[0])})`);
  send('hub:icon', { id, dataUrl, source: 'user' });
}

/** Supprime l'icone choisie : on retombe sur le fichier declare, puis la favicon. */
function resetIcon(id) {
  const icons = { ...store.get('icons') };
  delete icons[id];
  store.set('icons', icons);

  const service = getService(id);
  if (!service) return;

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

  return image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
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
    // pour y incruster son compteur de non-lus. L'avatar faisant 48px, on
    // recupere TOUTES les candidates et on garde la plus definie.
    const downloads = await Promise.all(
      candidates.map(async (candidate) => {
        if (candidate.startsWith('data:')) return decodeDataUrl(candidate);
        try {
          const response = await entry.view.webContents.session.fetch(candidate);
          if (!response.ok) return null;
          const buffer = Buffer.from(await response.arrayBuffer());
          const declared = (response.headers.get('content-type') || '').split(';')[0];
          const mime = sniffMime(buffer, declared || 'image/png');
          // Une page HTML servie a la place d'une icone : ce n'est pas une
          // favicon, et la garder afficherait une image cassee.
          return /html/i.test(mime) ? null : { buffer, mime };
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
// a un preload qui, avec contextIsolation, ne pourrait pas toucher au window du
// site.
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

  // Deuxieme voie, distincte : un site peut notifier via son service worker
  // (ServiceWorkerRegistration.showNotification), qui ne touche jamais a
  // window.Notification. Discord et WhatsApp le font.
  const swProto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
  if (swProto && swProto.showNotification && !window.__nexusSwPatched) {
    const nativeShow = swProto.showNotification;
    swProto.showNotification = function (...args) {
      if (window.__nexusMuted) return Promise.resolve();
      return nativeShow.apply(this, args);
    };
    window.__nexusSwPatched = true;
  }

  return (window.__nexusMuted ? 'coupe' : 'actif')
    + ' [permission Chromium: ' + Native.permission
    + ' | service worker: ' + (window.__nexusSwPatched ? 'enveloppe' : 'absent') + ']';
})()`;

function applyMuteState(entry) {
  const muted = isMuted(entry.service.id);

  // Troisieme voie, la plus sournoise : les webapps jouent leur propre son
  // depuis la page (le "ding" de WhatsApp), sans passer par l'API Notification.
  // Aucune barriere cote notifications ne peut l'arreter — il faut couper
  // l'audio du webContents.
  // Consequence assumee : un service coupe est aussi muet pendant un appel.
  entry.view.webContents.setAudioMuted(muted);

  entry.view.webContents
    .executeJavaScript(notificationPatch(muted), true)
    .then((state) =>
      log('mute', `${entry.service.id} : notifications ${state} | audio ${muted ? 'coupe' : 'actif'}`)
    )
    .catch((err) => log('mute', `${entry.service.id} : patch impossible (${err.message})`));
}

function setMuted(id, muted) {
  store.set('muted', { ...store.get('muted'), [id]: muted });

  const entry = views.get(id);
  if (entry) applyMuteState(entry);
  else log('mute', `${id} : ${muted ? 'coupe' : 'actif'} (service pas charge)`);
}

// ---------------------------------------------------------------------------
// Vues de service (WebContentsView, remplacant de BrowserView depuis Electron 30)
// ---------------------------------------------------------------------------

// Hotes autorises a ouvrir une vraie popup Electron : ce sont les flux d'auth
// qui ont besoin de la session du service. Tout le reste part dans le navigateur
// systeme.
const AUTH_HOST_PATTERNS = [
  /(^|\.)accounts\.google\.com$/,
  /(^|\.)accounts\.youtube\.com$/,
  /(^|\.)login\.microsoftonline\.com$/,
  /(^|\.)appleid\.apple\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)discord\.com$/,
  /(^|\.)whatsapp\.com$/,
  /(^|\.)slack\.com$/,
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
      // les services en arriere-plan rateraient leurs notifications.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  view.setBackgroundColor('#1e1e2e');

  const entry = { service, view, status: 'idle', timer: null, hibernateTimer: null, badge: 0 };
  views.set(service.id, entry);
  hibernated.delete(service.id);

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
  // le titre de l'onglet -> "(3) WhatsApp", "(1) Discord".
  wc.on('page-title-updated', (_e, title) => {
    // Titre brut journalise : c'est la seule source du comptage, et chaque
    // service a sa propre convention (messages ? conversations ?).
    log('title', `${service.id} : "${title}"`);
    updateBadge(entry, title);
  });

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

  // Un service preche naît en arriere-plan : sa minuterie de veille doit
  // demarrer ici, sinon elle n'existerait qu'apres un premier changement de
  // service — et un service jamais consulte ne s'endormirait jamais.
  if (service.id !== activeId) scheduleHibernation(entry);

  return entry;
}

function loadService(entry) {
  const { service, view } = entry;
  clearTimeout(entry.timer);
  entry.iconScore = null; // nouvelle page = nouvelle competition entre favicons
  setStatus(entry, 'loading');
  log('load', service.id, '->', service.url);

  view.webContents
    .loadURL(service.url, { userAgent: userAgentFor(service) })
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
 *  "• Discord"          -> -1 (non-lus sans compteur : pastille sans chiffre)
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

// ---------------------------------------------------------------------------
// Mise en veille
//
// Un service en veille est detruit : son process Chromium disparait et la
// memoire est rendue. En contrepartie il ne remonte plus ni badge ni
// notification jusqu'au prochain clic. C'est le seul arbitrage possible — un
// service qui notifie est un service qui tourne.
// ---------------------------------------------------------------------------

function hibernateService(id, reason) {
  const entry = views.get(id);
  if (!entry) return;

  // Le service affiche n'est jamais mis en veille : la zone deviendrait vide.
  if (id === activeId) return;

  clearTimeout(entry.timer);
  clearTimeout(entry.hibernateTimer);

  mainWindow?.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  views.delete(id);
  hibernated.add(id);

  log('veille', `${id} endormi (${reason})`);
  send('hub:status', { id, status: 'hibernated' });
  send('hub:badge', { id, count: 0 });
  refreshTrayTooltip();
}

/**
 * Programme la veille d'un service qui vient de passer en arriere-plan.
 *
 * A n'appeler QUE lorsqu'un service cesse d'etre affiche. Le rappeler a chaque
 * changement de service, y compris pour ceux qui etaient deja en arriere-plan,
 * relancerait leur compte a rebours : le delai ne s'ecoulerait alors que si
 * l'utilisateur ne touche plus du tout a la sidebar, ce qui n'est pas
 * "inactivite de ce service".
 */
function scheduleHibernation(entry) {
  clearTimeout(entry.hibernateTimer);

  const minutes = Number(entry.service.hibernateAfter) || 0;
  if (minutes <= 0) return;

  entry.hibernateTimer = setTimeout(
    () => hibernateService(entry.service.id, `${minutes} min sans consultation`),
    minutes * 60000
  );
}

function showService(id) {
  const service = getService(id);
  if (!service) return;

  const previousId = activeId;
  activeId = id;
  store.set('lastActiveId', id);

  // Le service demande se reveille tout seul : createServiceView le recharge.
  const entry = views.get(id) || createServiceView(service);
  clearTimeout(entry.hibernateTimer); // on le consulte : son compte a rebours s'annule

  // Seul le service qu'on vient de quitter demarre son compte a rebours. Les
  // autres gardent le leur, deja en cours.
  if (previousId && previousId !== id) {
    const previous = views.get(previousId);
    if (previous) scheduleHibernation(previous);
  }

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
  // input.alt exclut AltGr : sur un clavier AZERTY, AltGr est envoye comme
  // Ctrl+Alt, et taper ~ # { [ dans un service declencherait nos raccourcis.
  if (input.type !== 'keyDown' || !input.control || input.alt) return;

  const key = (input.key || '').toLowerCase();
  const activeEntry = views.get(activeId);
  const services = orderedServices();

  // Ctrl+1..9 : switch de service, dans l'ordre affiche par la sidebar.
  // On lit la POSITION de la touche (input.code, Digit1..Digit9), pas le
  // caractere produit : sur un AZERTY la rangee du haut donne & é " ' ( - è _ ç
  // sans Shift, et comparer input.key a un chiffre ne matchait jamais.
  const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(input.code || '');
  const digit = digitMatch ? Number(digitMatch[1]) : NaN;
  if (!input.shift && digit >= 1 && digit <= Math.min(9, services.length)) {
    event.preventDefault();
    log('shortcut', `Ctrl+${digit} -> ${services[digit - 1].id}`);
    showService(services[digit - 1].id);
    return;
  }

  if (key === 'n' && !input.shift) {
    event.preventDefault();
    send('hub:new-service', {});
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

  const template = [
    ...orderedServices().map((service, index) => ({
      label: hibernated.has(service.id)
        ? t('tray.sleeping', { name: service.name })
        : service.name,
      accelerator: index < 9 ? `CommandOrControl+${index + 1}` : undefined,
      click: () => {
        showWindow();
        showService(service.id);
      },
    })),
    { type: 'separator' },
    {
      label: t('tray.toggle'),
      click: () => (mainWindow?.isVisible() ? mainWindow.hide() : showWindow()),
    },
  ];

  if (pendingUpdate) {
    template.push(
      { type: 'separator' },
      { label: t('tray.install', { version: pendingUpdate }), click: installUpdate }
    );
  }

  template.push(
    { type: 'separator' },
    { label: t('menu.help.about'), click: showAbout },
    { label: t('menu.file.quit'), accelerator: 'CommandOrControl+Q', click: quitApp }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function refreshTrayTooltip() {
  if (!tray) return;
  const total = [...views.values()].reduce((sum, entry) => sum + Math.max(0, entry.badge), 0);
  tray.setToolTip(total > 0 ? t('tray.unread', { count: total }) : 'Nexus');
}

// ---------------------------------------------------------------------------
// Mise a jour automatique (GitHub Releases via electron-updater)
// ---------------------------------------------------------------------------

function setupUpdater() {
  // Hors packaging il n'y a pas de version installee a remplacer : electron-updater
  // chercherait un dev-app-update.yml inexistant et jetterait a chaque demarrage.
  if (!app.isPackaged) {
    log('update', 'ignore : application non packagee');
    return;
  }

  autoUpdater.logger = {
    info: (message) => log('update', message),
    warn: (message) => log('update', `attention : ${message}`),
    error: (message) => log('update', `erreur : ${message}`),
    debug: () => {},
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log('update', `version ${info.version} disponible, telechargement en cours`);
    send('hub:update', { state: 'downloading', version: info.version });
  });

  autoUpdater.on('update-not-available', () => log('update', 'deja a jour'));

  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdate = info.version;
    log('update', `version ${info.version} prete, en attente de redemarrage`);
    send('hub:update', { state: 'ready', version: info.version });
    refreshTrayMenu();
  });

  autoUpdater.on('error', (err) => log('update', `echec : ${err.message}`));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_INTERVAL_MS);
}

function installUpdate() {
  if (!pendingUpdate) return;
  log('update', `installation de ${pendingUpdate}`);
  isQuitting = true; // sinon le close-to-tray empecherait le redemarrage
  autoUpdater.quitAndInstall();
}

// ---------------------------------------------------------------------------
// Barre de menus et "A propos"
// ---------------------------------------------------------------------------

/**
 * Fenetre "A propos". Les versions y sont copiables d'un clic : c'est la
 * premiere chose qu'on demande dans un rapport de bug, et personne ne sait les
 * retrouver autrement.
 */
async function showAbout() {
  const details = [
    `Nexus ${app.getVersion()}`,
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
    `${process.platform} ${process.arch}`,
  ].join('\n');

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t('menu.help.about'),
    message: `Nexus ${app.getVersion()}`,
    detail: `${t('about.tagline')}\n\n${details}`,
    buttons: [t('about.close'), t('about.copy'), t('about.repo')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    icon: nativeImage.createFromPath(ICON_PATH),
  });

  if (response === 1) clipboard.writeText(details);
  if (response === 2) shell.openExternal(REPO_URL);
}

function checkForUpdatesManually() {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('update.title'),
      message: t('update.devMessage'),
      detail: t('update.devDetail'),
      buttons: [t('about.close')],
    });
    return;
  }

  if (pendingUpdate) return installUpdate();

  log('update', 'verification manuelle');
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (result?.updateInfo?.version === app.getVersion()) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: t('update.title'),
          message: t('update.currentMessage'),
          detail: t('update.currentDetail', { version: app.getVersion() }),
          buttons: [t('about.close')],
        });
      }
    })
    .catch((err) =>
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: t('update.title'),
        message: t('update.failedMessage'),
        detail: err.message,
        buttons: [t('about.close')],
      })
    );
}

/**
 * Barre de menus classique, revelee par Alt (autoHideMenuBar).
 *
 * Piege a eviter : les raccourcis de l'app sont geres par before-input-event,
 * qui fonctionne meme quand le focus est dans un service. Si le menu les
 * enregistrait AUSSI, chaque frappe serait traitee deux fois — un Ctrl+Shift+I
 * qui ouvre puis referme les DevTools, par exemple. D'ou `registerAccelerator:
 * false` : le raccourci s'affiche dans le menu, mais n'est pas capte par lui.
 */
function createApplicationMenu() {
  const shown = (accelerator) => ({ accelerator, registerAccelerator: false });
  const active = () => views.get(activeId);

  const preference = store.get('language');

  const menu = Menu.buildFromTemplate([
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.file.new'),
          ...shown('CommandOrControl+N'),
          click: () => send('hub:new-service', {}),
        },
        { type: 'separator' },
        // La langue est un reglage, pas une rubrique d'aide. Elle se choisit a
        // l'onboarding puis se change ici.
        {
          label: t('menu.language'),
          submenu: [
            {
              label: t('menu.language.system'),
              type: 'radio',
              checked: preference === 'system',
              click: () => setLanguage('system'),
            },
            { type: 'separator' },
            ...i18n.AVAILABLE.map((code) => ({
              label: LANGUAGE_NAMES[code] || code,
              type: 'radio',
              checked: preference === code,
              click: () => setLanguage(code),
            })),
          ],
        },
        { type: 'separator' },
        {
          label: t('menu.file.autostart'),
          type: 'checkbox',
          checked: Boolean(store.get('autostart')),
          click: () => {
            store.set('autostart', !store.get('autostart'));
            applyAutostart();
            createApplicationMenu();
          },
        },
        {
          label: t('menu.file.autostartHidden'),
          type: 'checkbox',
          enabled: Boolean(store.get('autostart')),
          checked: Boolean(store.get('autostartHidden')),
          click: () => {
            store.set('autostartHidden', !store.get('autostartHidden'));
            applyAutostart();
            createApplicationMenu();
          },
        },
        { type: 'separator' },
        { label: t('menu.file.hide'), click: () => mainWindow?.hide() },
        { label: t('menu.file.quit'), ...shown('CommandOrControl+Q'), click: quitApp },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.edit.undo') },
        { role: 'redo', label: t('menu.edit.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.edit.cut') },
        { role: 'copy', label: t('menu.edit.copy') },
        { role: 'paste', label: t('menu.edit.paste') },
        { role: 'selectAll', label: t('menu.edit.selectAll') },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.view.reload'),
          ...shown('CommandOrControl+R'),
          click: () => active()?.view.webContents.reload(),
        },
        {
          label: t('menu.view.hardReload'),
          ...shown('CommandOrControl+Shift+R'),
          click: () => {
            const entry = active();
            if (!entry) return;
            entry.view.webContents.session
              .clearCache()
              .then(() => entry.view.webContents.reloadIgnoringCache());
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.view.fullscreen') },
        {
          label: t('menu.view.devtoolsService'),
          ...shown('CommandOrControl+Shift+I'),
          click: () => active()?.view.webContents.toggleDevTools(),
        },
        {
          label: t('menu.view.devtoolsSidebar'),
          ...shown('CommandOrControl+,'),
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: t('menu.services'),
      submenu: orderedServices().map((service, index) => ({
        label: hibernated.has(service.id)
          ? t('tray.sleeping', { name: service.name })
          : service.name,
        ...(index < 9 ? shown(`CommandOrControl+${index + 1}`) : {}),
        click: () => showService(service.id),
      })),
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.help.updates'), click: checkForUpdatesManually },
        { type: 'separator' },
        { label: t('menu.help.docs'), click: () => shell.openExternal(`${REPO_URL}#readme`) },
        { label: t('menu.help.issue'), click: () => shell.openExternal(`${REPO_URL}/issues/new`) },
        { label: t('menu.help.source'), click: () => shell.openExternal(REPO_URL) },
        { type: 'separator' },
        { label: t('menu.help.about'), click: showAbout },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

// Les langues s'affichent dans leur propre langue : un francophone perdu dans
// une interface anglaise doit reconnaitre "Francais" sans le traduire.
const LANGUAGE_NAMES = { en: 'English', fr: 'Français', es: 'Español' };

/**
 * Change la langue a chaud, sans rien recharger. Menus et tray sont reconstruits
 * ici ; la barre laterale recoit le nouveau dictionnaire et retraduit sur place.
 * Les services, eux, ne bougent pas.
 */
function setLanguage(preference) {
  store.set('language', preference);
  const applied = i18n.setLanguage(preference === 'system' ? null : preference);
  log('i18n', `langue : ${preference} -> ${applied}`);

  createApplicationMenu();
  refreshTrayMenu();
  refreshTrayTooltip();
  send('hub:language', { strings: i18n.dict(), language: applied, preference });
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
  if (pendingMaximize) {
    pendingMaximize = false;
    mainWindow.maximize(); // maximize() affiche la fenetre
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Enregistre (ou retire) le lancement automatique aupres de Windows. En dev,
 * openAtLogin enregistrerait electron.exe : le reglage est stocke mais seule
 * l'app installee l'applique.
 */
function applyAutostart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(store.get('autostart')),
    args: store.get('autostartHidden') ? ['--hidden'] : [],
  });
  log('autostart', `${store.get('autostart') ? 'actif' : 'inactif'}${store.get('autostartHidden') ? ' (masque)' : ''}`);
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

  // Barre de menus masquee par defaut (autoHideMenuBar), revelee par Alt :
  // l'app reste epuree, sans priver d'un point d'entree conventionnel vers
  // "A propos", les mises a jour ou le report de bug.
  createApplicationMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('before-input-event', handleShortcut);

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      pendingMaximize = saved.maximized;
      log('window', 'demarrage masque dans la zone de notification (--hidden)');
    } else {
      if (saved.maximized) mainWindow.maximize();
      mainWindow.show();
    }

    const services = orderedServices();
    if (!services.length) {
      log('services', 'aucun service configure');
      if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    // Dernier service actif au relancement (ou le premier de la liste).
    const lastId = store.get('lastActiveId');
    const startId = services.some((s) => s.id === lastId) ? lastId : services[0].id;
    showService(startId);

    // Les autres services sont charges en arriere-plan, en quinconce : sans ca
    // leurs badges et leurs notifications ne remonteraient qu'apres un premier
    // clic sur leur icone.
    let delay = PRELOAD_STAGGER_MS;
    for (const service of services) {
      if (service.id === startId) continue;

      if (service.preload === false) {
        log('preload', `${service.id} ignore (chargement a la demande)`);
        hibernated.add(service.id);
        send('hub:status', { id: service.id, status: 'hibernated' });
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
    for (const entry of views.values()) {
      clearTimeout(entry.timer);
      clearTimeout(entry.hibernateTimer);
    }
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
// Creation / edition / suppression de services
// ---------------------------------------------------------------------------

/** Payload envoye a la sidebar : tout ce qu'il faut pour afficher et editer. */
function serviceForRenderer(service) {
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    color: service.color,
    initials: service.initials,
    spoofUserAgent: Boolean(service.spoofUserAgent),
    preload: service.preload !== false,
    hibernateAfter: Number(service.hibernateAfter) || 0,
    muted: isMuted(service.id),
    hibernating: hibernated.has(service.id),
    ...resolveIcon(service),
  };
}

function broadcastServices() {
  send('hub:services', { services: orderedServices().map(serviceForRenderer) });
  refreshTrayMenu();
  createApplicationMenu(); // le menu Services doit suivre la liste
}

function normalizeUrl(raw) {
  const value = (raw || '').trim();
  if (!value) return null;
  // Saisir "web.whatsapp.com" doit marcher : sans schema, new URL() echoue et le
  // service ne chargerait jamais.
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/**
 * Cree ou met a jour un service. Retourne { ok } ou { error } — le renderer
 * affiche le message tel quel dans le formulaire.
 */
function saveService(draft) {
  const name = (draft.name || '').trim();
  const url = normalizeUrl(draft.url);

  if (!name) return { error: t('error.nameRequired') };
  if (!url) return { error: t('error.urlInvalid') };

  const services = allServices();
  const existing = draft.id ? services.find((service) => service.id === draft.id) : null;
  if (draft.id && !existing) return { error: t('error.serviceGone') };

  const settings = {
    name,
    url,
    color: /^#[0-9a-f]{6}$/i.test(draft.color || '') ? draft.color : '#45475a',
    initials: (draft.initials || name).trim().slice(0, 4).toUpperCase(),
    spoofUserAgent: Boolean(draft.spoofUserAgent),
    preload: draft.preload !== false,
    hibernateAfter: Math.max(0, Number(draft.hibernateAfter) || 0),
  };

  if (existing) {
    const urlChanged = existing.url !== settings.url;
    const spoofChanged = existing.spoofUserAgent !== settings.spoofUserAgent;

    const updated = services.map((service) =>
      service.id === existing.id ? { ...service, ...settings } : service
    );
    store.set('services', updated);
    log('services', `${existing.id} modifie`);

    const entry = views.get(existing.id);
    if (entry) {
      entry.service = withDefaults({ ...existing, ...settings });
      // L'UA est porte par la session : il faut le rejouer avant de recharger,
      // sinon la page repart avec l'ancienne identite.
      if (spoofChanged) applySessionUserAgent(entry.service);
      if (urlChanged || spoofChanged) loadService(entry);
    }
  } else {
    const taken = new Set(services.map((service) => service.id));
    let id = slugify(name);
    for (let n = 2; taken.has(id); n++) id = `${slugify(name)}-${n}`;

    const service = withDefaults({
      id,
      partition: `persist:${id}`, // partition dediee => session etanche des la creation
      ...settings,
    });

    store.set('services', [...services, service]);
    store.set('order', [...(store.get('order') || []), id]);
    log('services', `${id} cree (${settings.url})`);
  }

  broadcastServices();
  return { ok: true };
}

async function deleteService(id) {
  const service = getService(id);
  if (!service) return { error: t('error.serviceMissing') };

  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: [t('delete.cancel'), t('delete.confirm')],
    defaultId: 0,
    cancelId: 0,
    title: t('delete.title'),
    message: t('delete.message', { name: service.name }),
    detail: t('delete.detail'),
    checkboxLabel: t('delete.checkbox'),
    checkboxChecked: false,
  });

  if (response !== 1) return { ok: false };

  // La vue doit mourir avant la config : sinon elle continue de tourner sans
  // service correspondant.
  const entry = views.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    clearTimeout(entry.hibernateTimer);
    mainWindow?.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    views.delete(id);
  }
  hibernated.delete(id);
  iconCache.delete(id);

  store.set(
    'services',
    allServices().filter((service) => service.id !== id)
  );
  store.set('order', (store.get('order') || []).filter((entryId) => entryId !== id));

  for (const key of ['icons', 'muted']) {
    const map = { ...store.get(key) };
    delete map[id];
    store.set(key, map);
  }

  if (checkboxChecked) {
    await session.fromPartition(service.partition).clearStorageData();
    log('services', `${id} : donnees de session effacees`);
  }

  log('services', `${id} supprime`);

  if (activeId === id) {
    activeId = null;
    const next = orderedServices()[0];
    if (next) showService(next.id);
  }

  broadcastServices();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// IPC sidebar -> main
// ---------------------------------------------------------------------------

ipcMain.handle('hub:bootstrap', () => ({
  services: orderedServices().map(serviceForRenderer),
  activeId,
  version: app.getVersion(),
  onboarding: needsOnboarding(),
  // Le renderer est sandboxe : il ne lit pas les fichiers de langue, il recoit
  // le dictionnaire deja resolu.
  strings: i18n.dict(),
  language: i18n.current(),
  languagePreference: store.get('language'),
  // iconKey identifie la vignette de chaque entree : le domaine, sauf quand une
  // source est declaree (deux produits Google partagent mail.google.com).
  catalog: CATALOG.map((entry) => ({ ...entry, iconKey: catalogIcons.keyOf(entry) })),
  catalogIcons: catalogIcons.known(),
  update: pendingUpdate ? { state: 'ready', version: pendingUpdate } : null,
  // Base servant a composer l'icone du tray avec le compteur par-dessus.
  trayBase: nativeImage.createFromPath(ICON_PATH).resize({ width: 64, height: 64 }).toDataURL(),
}));

ipcMain.handle('hub:service-save', (_e, draft) => saveService(draft || {}));
ipcMain.handle('hub:service-delete', (_e, id) => deleteService(id));

/**
 * Fin d'onboarding : cree les services choisis dans l'ordre du clic, puis
 * demarre comme un lancement normal (premier service affiche, les autres
 * precharges en quinconce).
 */
ipcMain.handle('hub:onboard-complete', (_e, drafts) => {
  const picks = Array.isArray(drafts) ? drafts : [];

  for (const draft of picks) {
    const result = saveService(draft);
    if (result.error) log('onboarding', `"${draft?.name}" ignore : ${result.error}`);
  }

  store.set('onboarded', true);

  const services = orderedServices();
  log('onboarding', `termine : ${services.length} service(s)`);

  if (services.length) {
    showService(services[0].id);

    let delay = PRELOAD_STAGGER_MS;
    for (const service of services.slice(1)) {
      if (service.preload === false) continue;
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || views.has(service.id)) return;
        createServiceView(service);
      }, delay);
      delay += PRELOAD_STAGGER_MS;
    }
  }

  return { ok: true, count: services.length };
});

/** Changement de langue, depuis l'onboarding ou le menu Fichier. */
ipcMain.handle('hub:set-language', (_e, preference) => {
  setLanguage(preference);
  return { strings: i18n.dict(), language: i18n.current(), preference: store.get('language') };
});

/** Enregistre un nouvel ordre complet (drag & drop cote sidebar). */
ipcMain.on('hub:reorder', (_e, ids) => {
  const known = new Set(allServices().map((service) => service.id));
  const order = (ids || []).filter((id) => known.has(id));

  // Un ordre partiel signifierait un desaccord entre la sidebar et le store :
  // on prefere ne rien enregistrer plutot que de perdre un service.
  if (order.length !== known.size) {
    log('order', `ordre ignore : ${order.length}/${known.size} services`);
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

// Clic droit sur une icone de la sidebar : menu natif.
ipcMain.on('hub:service-menu', (_e, id) => {
  const service = getService(id);
  if (!service) return;

  const order = orderedServices();
  const index = order.findIndex((s) => s.id === id);
  const entry = views.get(id);
  const asleep = hibernated.has(id);

  const menu = Menu.buildFromTemplate([
    { label: service.name, enabled: false },
    { type: 'separator' },
    { label: t('ctx.edit'), click: () => send('hub:edit-service', { id }) },
    { label: t('ctx.delete'), click: () => deleteService(id) },
    { type: 'separator' },
    {
      label: t('ctx.notifications'),
      type: 'checkbox',
      checked: !isMuted(id),
      // On repart de l'etat stocke, pas de item.checked : selon les plateformes
      // le handler recoit la valeur d'avant ou d'apres la bascule, ce qui
      // inversait l'enregistrement.
      click: () => setMuted(id, !isMuted(id)),
    },
    {
      label: asleep ? t('ctx.sleeping') : t('ctx.sleep'),
      enabled: Boolean(entry) && id !== activeId,
      click: () => hibernateService(id, 'demande manuelle'),
    },
    { type: 'separator' },
    { label: t('ctx.icon'), click: () => chooseIcon(id) },
    { label: t('ctx.iconDefault'), enabled: Boolean(storedIcon(id)), click: () => resetIcon(id) },
    { type: 'separator' },
    { label: t('ctx.up'), enabled: index > 0, click: () => moveService(id, -1) },
    {
      label: t('ctx.down'),
      enabled: index >= 0 && index < order.length - 1,
      click: () => moveService(id, 1),
    },
    { type: 'separator' },
    { label: t('ctx.reload'), enabled: Boolean(entry), click: () => entry?.view.webContents.reload() },
    {
      label: t('ctx.devtools'),
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
ipcMain.on('hub:install-update', installUpdate);

// La vue du service recouvre toute la zone a droite de la sidebar : un
// formulaire affiche par le renderer serait cache dessous. On escamote donc la
// vue active le temps que la boite de dialogue est ouverte.
ipcMain.on('hub:modal', (_e, open) => {
  const entry = views.get(activeId);
  if (!entry) return;
  entry.view.setVisible(!open && entry.status !== 'error');
});

ipcMain.on('hub:retry', (_e, id) => {
  const entry = views.get(id);
  if (entry) loadService(entry);
  else {
    const service = getService(id);
    if (service) createServiceView(service);
  }
});

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  log('app', `Nexus ${app.getVersion()} — Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`);
  const preference = store.get('language');
  log('i18n', `langue : ${i18n.init(preference === 'system' ? null : preference)}`);

  catalogIcons.init({
    log,
    onIcon: (key, dataUrl) => send('hub:catalog-icon', { key, dataUrl }),
  });

  const services = allServices();
  log('app', `${services.length} services : ${services.map((s) => s.id).join(', ')}`);

  createWindow();
  createTray();
  setupUpdater();
  applyAutostart(); // aligne l'entree Windows sur la config a chaque demarrage

  // Prechargement des vignettes du catalogue : la grille doit etre chaude avant
  // que le formulaire ne s'ouvre. Pendant l'onboarding elle est visible tout de
  // suite, donc pas d'attente ; sinon on laisse les services demarrer d'abord.
  // Un cache frais ne declenche aucune requete.
  const delay = needsOnboarding() ? 0 : 8000;
  setTimeout(() => catalogIcons.refresh(CATALOG), delay);

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
