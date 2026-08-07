'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, net, nativeImage } = require('electron');
const { sniffMime, iconWidth, readIco, toDataUrl, SVG_SCORE } = require('./images');

/**
 * Vignettes du catalogue.
 *
 * Les logos ne sont pas embarques dans l'app : ils seraient figes, alors que les
 * marques changent. Ils sont recuperes depuis le site de chaque service, mis en
 * cache sur disque, et rafraichis une fois par mois.
 *
 * Le prechargement se fait en tache de fond des le demarrage : une grille qui se
 * remplit sous les yeux de l'utilisateur fait aussi pauvre que pas de logo du
 * tout. Quand le formulaire s'ouvre, tout est deja la.
 */

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // un mois
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_BYTES = 250 * 1024;
const GOOD_ENOUGH = 128; // au-dela, inutile d'essayer les candidats suivants

let cacheFile = null;
let cache = {}; // domaine -> { dataUrl, width, fetchedAt }
let saveTimer = null;
let running = false;
let log = () => {};
let notify = () => {};

function init(options = {}) {
  cacheFile = path.join(app.getPath('userData'), 'catalog-icons.json');
  log = options.log || log;
  notify = options.onIcon || notify;

  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    log('catalogue', `${Object.keys(cache).length} vignettes en cache`);
  } catch {
    cache = {}; // absent ou illisible : on repart d'un cache vide, sans bruit
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch (err) {
      log('catalogue', `cache non ecrit : ${err.message}`);
    }
  }, 2000);
}

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Candidats, du plus qualitatif au plus sur.
 * apple-touch-icon fait generalement 180px et existe sur la plupart des sites
 * modernes ; le service de DuckDuckGo sert de filet quand le site n'expose rien
 * a un chemin devinable ; favicon.ico est le dernier recours.
 */
function candidatesFor(domain) {
  const bare = domain.replace(/^www\./, '');
  const labels = bare.split('.');
  // Beaucoup de services vivent sur un sous-domaine applicatif qui n'expose
  // aucune icone (app.intercom.com, web.skype.com) alors que le domaine racine
  // en a une. On le garde en dernier recours.
  const root = labels.length > 2 ? labels.slice(-2).join('.') : null;

  return [
    `https://${domain}/apple-touch-icon.png`,
    `https://icons.duckduckgo.com/ip3/${bare}.ico`,
    `https://${domain}/favicon.ico`,
    ...(root ? [`https://icons.duckduckgo.com/ip3/${root}.ico`, `https://${root}/apple-touch-icon.png`] : []),
  ];
}

/**
 * Un logo affiche a 44px n'a aucun besoin d'etre stocke en 512. Sans ce
 * plafond, le cache depasse le megaoctet et transite en entier vers le renderer
 * a chaque demarrage.
 */
function shrink(candidate) {
  if (/svg/i.test(candidate.mime)) return candidate; // vectoriel : deja compact

  let current = candidate;

  // Un .ico embarque toutes les tailles a la fois : on ne garde que la plus
  // grande frame, quand elle est en PNG.
  if (/icon/i.test(current.mime)) {
    const frame = readIco(current.buffer);
    if (!frame?.buffer) return current;
    current = { buffer: frame.buffer, mime: 'image/png' };
  }

  const image = nativeImage.createFromBuffer(current.buffer);
  if (image.isEmpty() || image.getSize().width <= 192) return current;

  return {
    buffer: image.resize({ width: 128, height: 128, quality: 'best' }).toPNG(),
    mime: 'image/png',
  };
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;

    const declared = (response.headers.get('content-type') || '').split(';')[0];
    const candidate = { buffer, mime: sniffMime(buffer, declared || 'image/png') };

    // Une page HTML renvoyee en 200 a la place d'une image : frequent sur les
    // sites qui redirigent tout vers leur SPA.
    if (/html/i.test(candidate.mime)) return null;

    // Le score se calcule sur l'original — c'est lui qui dit la qualite reelle —
    // mais c'est la version reduite qu'on stocke.
    const width = iconWidth(candidate);
    return width > 0 ? { dataUrl: toDataUrl(shrink(candidate)), width } : null;
  } catch {
    return null; // hors ligne, DNS, timeout : une vignette manquante n'est pas une erreur
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIcon(domain) {
  let best = null;

  for (const url of candidatesFor(domain)) {
    const found = await download(url);
    if (found && (!best || found.width > best.width)) best = found;
    if (best && best.width >= GOOD_ENOUGH) break;
  }

  return best;
}

function isStale(entry) {
  return !entry || !entry.dataUrl || Date.now() - (entry.fetchedAt || 0) > MAX_AGE_MS;
}

/** Vignettes connues, pretes a etre envoyees au renderer. */
function known() {
  const result = {};
  for (const [domain, entry] of Object.entries(cache)) {
    if (entry?.dataUrl) result[domain] = entry.dataUrl;
  }
  return result;
}

/**
 * Met a jour ce qui manque ou a plus d'un mois. Les entrees fraiches ne sont
 * jamais retelechargees, donc un demarrage normal ne fait aucune requete.
 */
async function refresh(urls) {
  if (running) return;

  const domains = [...new Set(urls.map(domainOf).filter(Boolean))].filter((domain) =>
    isStale(cache[domain])
  );

  if (!domains.length) return;

  running = true;
  log('catalogue', `${domains.length} vignette(s) a rafraichir`);

  let index = 0;
  let updated = 0;

  const worker = async () => {
    while (index < domains.length) {
      const domain = domains[index++];
      const found = await fetchIcon(domain);

      if (found) {
        cache[domain] = { ...found, fetchedAt: Date.now() };
        updated++;
        notify(domain, found.dataUrl);
      } else {
        // Memorise l'echec pour ne pas reessayer a chaque demarrage.
        cache[domain] = { dataUrl: null, fetchedAt: Date.now() };
      }

      scheduleSave();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  running = false;
  log(
    'catalogue',
    `${updated}/${domains.length} vignette(s) recuperee(s)` +
      (updated < domains.length ? ` — ${domains.length - updated} sans icone exploitable` : '')
  );
}

module.exports = { init, refresh, known, domainOf, SVG_SCORE };
