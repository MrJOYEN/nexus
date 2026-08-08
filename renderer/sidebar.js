'use strict';

// Logique de la sidebar. Aucun acces Node ici : tout passe par window.hub
// (expose par preload.js via contextBridge).

const servicesEl = document.getElementById('services');
const overlay = document.getElementById('overlay');
const overlayAvatar = document.getElementById('overlay-avatar');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const overlayRetry = document.getElementById('overlay-retry');
const addButton = document.getElementById('add-btn');
const updateButton = document.getElementById('update-btn');

const modal = document.getElementById('modal');
const picker = document.getElementById('picker');
const catalogGrid = document.getElementById('catalog-grid');
const catalogEmpty = document.getElementById('catalog-empty');
const searchInput = document.getElementById('f-search');
const formTitle = document.getElementById('form-title');

const form = document.getElementById('service-form');
const formError = document.getElementById('form-error');
const formDelete = document.getElementById('form-delete');
const formBack = document.getElementById('form-back');
const formSave = document.getElementById('form-save');

const previewLogo = document.getElementById('preview-logo');
const previewName = document.getElementById('preview-name');
const previewSlot = document.getElementById('preview-slot');

const fields = {
  name: document.getElementById('f-name'),
  url: document.getElementById('f-url'),
  initials: document.getElementById('f-initials'),
  color: document.getElementById('f-color'),
  hibernate: document.getElementById('f-hibernate'),
  spoof: document.getElementById('f-spoof'),
  preload: document.getElementById('f-preload'),
};

/** id -> { service, el, status, badge } */
const items = new Map();
/** Les badges survivent aux re-rendus de la sidebar (edition, reordonnancement). */
const badges = new Map();

let activeId = null;
let splitId = null;
let editingId = null;
let catalog = [];
let catalogIcons = {};
let strings = {};

// ---------------------------------------------------------------------------
// Traduction
//
// Le renderer ne lit aucun fichier de langue : main.js lui envoie le
// dictionnaire deja resolu. Une cle absente s'affiche telle quelle, ce qui la
// rend visible immediatement plutot que de la laisser passer.
// ---------------------------------------------------------------------------

function t(key, vars) {
  const raw = strings[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Applique les cles posees dans le HTML (data-i18n, -placeholder, -title). */
function applyTranslations() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
}
/** cle de vignette -> elements affiches, mis a jour quand l'icone arrive. */
let tilesByKey = new Map();
let pickedIcon = null;

// ---------------------------------------------------------------------------
// Rendu de la sidebar
// ---------------------------------------------------------------------------

function renderSidebar(services) {
  servicesEl.innerHTML = '';
  items.clear();

  services.forEach((service, index) => {
    const el = document.createElement('button');
    el.className = 'service';
    el.type = 'button';
    el.draggable = true; // reordonnancement par glisser-deposer
    el.dataset.id = service.id;
    el.dataset.label = service.name;
    // Infobulle native : seule capable de s'afficher par-dessus la vue du
    // service, qui est une couche native au-dessus de la page.
    el.title = index < 9 ? `${service.name}\nCtrl+${index + 1}` : service.name;
    el.style.setProperty('--service-color', service.color);

    const avatar = document.createElement('span');
    avatar.className = 'avatar';

    const img = document.createElement('img');
    img.alt = '';
    img.hidden = true;
    img.addEventListener('error', () => {
      img.hidden = true;
      el.classList.remove('has-icon');
    });

    const initials = document.createElement('span');
    initials.className = 'initials';
    initials.textContent = service.initials;

    avatar.append(img, initials);

    // Pastille d'initiales, affichee uniquement quand une icone automatique
    // remplace l'avatar : c'est la que deux services peuvent etre
    // indiscernables (plusieurs comptes partagent la meme favicon).
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = service.initials;

    const badge = document.createElement('span');
    badge.className = 'badge';

    el.append(avatar, chip, badge);
    el.addEventListener('click', () => select(service.id));
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.hub.serviceMenu(service.id);
    });

    el.addEventListener('dragstart', (event) => {
      dragged = el;
      el.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', service.id);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragged = null;
      persistOrder();
    });

    servicesEl.append(el);
    items.set(service.id, { service, el, status: 'idle', badge: badges.get(service.id) || 0 });

    if (service.dataUrl) setIcon(service.id, service.dataUrl, service.source);
    if (service.hibernating) setStatus(service.id, 'hibernated');
    setBadge(service.id, badges.get(service.id) || 0);
  });

  if (activeId) setActive(activeId);
  if (splitId) setSplit(splitId);
  console.log(`[sidebar] ${services.length} service(s) rendus`);
}

function select(id) {
  if (id === activeId) return;
  window.hub.select(id);
}

function setActive(id) {
  activeId = id;
  for (const [itemId, item] of items) {
    item.el.classList.toggle('active', itemId === id);
  }
  refreshOverlay();
}

/** Service affiche dans la moitie droite : sa tuile porte un liseré accent. */
function setSplit(id) {
  splitId = id;
  for (const [itemId, item] of items) {
    item.el.classList.toggle('split', itemId === id);
  }
}

function setStatus(id, status, message) {
  const item = items.get(id);
  if (!item) return;

  item.status = status;
  item.message = message;
  item.el.classList.toggle('loading', status === 'loading');
  item.el.classList.toggle('error', status === 'error');
  item.el.classList.toggle('asleep', status === 'hibernated');

  console.log(`[sidebar] ${id} -> ${status}${message ? ` (${message})` : ''}`);
  if (id === activeId) refreshOverlay();
}

/**
 * Icone du service (data URI fournie par main.js : fichier local, favicon ou
 * image choisie par l'utilisateur).
 */
function setIcon(id, dataUrl, source) {
  const item = items.get(id);
  if (!item) return;

  const img = item.el.querySelector('.avatar img');

  if (!dataUrl) {
    img.removeAttribute('src');
    img.hidden = true;
    item.el.classList.remove('has-icon', 'auto-icon');
    return;
  }

  img.src = dataUrl;
  img.hidden = false;
  item.el.classList.add('has-icon');
  // Pastille d'initiales uniquement sur les icones automatiques : des que tu
  // choisis ton icone, elle disparait.
  item.el.classList.toggle('auto-icon', source === 'favicon');
}

/**
 * Badge de non-lus. Le comptage vient de main.js, qui parse le titre de la page
 * du service. count === -1 = non-lus sans nombre -> pastille.
 */
function setBadge(id, count) {
  const item = items.get(id);
  badges.set(id, count);
  if (!item) return;

  item.badge = count;
  const badge = item.el.querySelector('.badge');
  badge.classList.toggle('dot', count === -1);
  badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  item.el.classList.toggle('has-badge', count !== 0);

  updateCounters();
}

// ---------------------------------------------------------------------------
// Compteurs : barre des taches et icone du tray
// ---------------------------------------------------------------------------

const overlayCanvas = document.createElement('canvas');
overlayCanvas.width = 32;
overlayCanvas.height = 32;

const trayCanvas = document.createElement('canvas');
trayCanvas.width = 64;
trayCanvas.height = 64;

const trayBase = new Image();
let trayBaseReady = false;

trayBase.addEventListener('load', () => {
  trayBaseReady = true;
  updateCounters(); // l'image a pu arriver apres le premier badge
});

/**
 * Pastille posee sur l'icone de la barre des taches. Electron ne fournit pas
 * setBadgeCount sous Windows : il faut lui passer une image ("overlay icon"),
 * qu'on dessine ici — le renderer a le rendu de texte et l'antialiasing
 * gratuitement.
 */
function drawOverlayBadge(total, dotOnly) {
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);

  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(16, 16, dotOnly ? 9 : 15, 0, Math.PI * 2);
  ctx.fill();

  if (!dotOnly) {
    const label = total > 99 ? '99+' : String(total);
    // La taille de police descend avec le nombre de caracteres, sinon "99+"
    // deborde du cercle.
    const size = label.length === 1 ? 22 : label.length === 2 ? 18 : 14;
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 16, 17);
  }

  return overlayCanvas.toDataURL('image/png');
}

/**
 * Icone du tray recomposee avec le compteur. Quand la fenetre est masquee, elle
 * n'a plus de bouton dans la barre des taches — donc plus de pastille : le tray
 * prend le relais.
 */
function drawTrayIcon(total, dotOnly) {
  const ctx = trayCanvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(trayBase, 0, 0, 64, 64);

  // L'icone du tray est affichee en 16px : la pastille doit etre grosse et
  // franche, sinon elle disparait au redimensionnement.
  const radius = dotOnly ? 13 : 21;
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(64 - radius, 64 - radius, radius, 0, Math.PI * 2);
  ctx.fill();

  if (!dotOnly) {
    // Au-dela de 9, le chiffre devient illisible une fois reduit a 16px.
    const label = total > 9 ? '9+' : String(total);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${label.length === 1 ? 30 : 24}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64 - radius, 64 - radius + 1);
  }

  return trayCanvas.toDataURL('image/png');
}

function updateCounters() {
  let total = 0;
  let dot = false;

  for (const item of items.values()) {
    if (item.badge > 0) total += item.badge;
    else if (item.badge === -1) dot = true; // non-lus sans compteur
  }

  if (!total && !dot) {
    window.hub.setOverlayBadge(null, '');
    if (trayBaseReady) window.hub.setTrayIcon(null);
    return;
  }

  const description = total > 0 ? t('sidebar.unread', { count: total }) : t('sidebar.unreadDot');
  window.hub.setOverlayBadge(drawOverlayBadge(total, total === 0), description);
  if (trayBaseReady) window.hub.setTrayIcon(drawTrayIcon(total, total === 0));
}

// ---------------------------------------------------------------------------
// Reordonnancement par glisser-deposer
//
// L'element est deplace dans le DOM en temps reel pendant le drag (l'ordre du
// DOM fait foi), puis l'ordre final est envoye au main a la fin du geste.
// ---------------------------------------------------------------------------

let dragged = null;

/** Element devant lequel inserer, determine par le milieu de chaque icone. */
function dropTarget(y) {
  const others = [...servicesEl.querySelectorAll('.service:not(.dragging)')];

  return others.find((el) => {
    const box = el.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

servicesEl.addEventListener('dragover', (event) => {
  if (!dragged) return;
  event.preventDefault(); // sans ca, le drop est refuse
  event.dataTransfer.dropEffect = 'move';

  const target = dropTarget(event.clientY);
  if (target) servicesEl.insertBefore(dragged, target);
  else servicesEl.append(dragged);
});

servicesEl.addEventListener('drop', (event) => event.preventDefault());

/** Ordre du DOM -> main. Les libelles Ctrl+N sont recalcules dans la foulee. */
function persistOrder() {
  const ids = [...servicesEl.querySelectorAll('.service')].map((el) => el.dataset.id);
  refreshShortcutLabels();
  console.log(`[sidebar] nouvel ordre : ${ids.join(' > ')}`);
  window.hub.reorder(ids);
}

/** Le raccourci depend de la position : il suit l'icone quand elle se deplace. */
function refreshShortcutLabels() {
  [...servicesEl.querySelectorAll('.service')].forEach((el, index) => {
    el.title = index < 9 ? `${el.dataset.label}\nCtrl+${index + 1}` : el.dataset.label;
  });
}

/** Ordre impose par le main (menu contextuel Monter / Descendre). */
function applyOrder(order) {
  for (const id of order) {
    const item = items.get(id);
    if (item) servicesEl.append(item.el); // append deplace l'element existant
  }
  refreshShortcutLabels();
}

// ---------------------------------------------------------------------------
// Ecran de secours (sous la vue du service)
// ---------------------------------------------------------------------------

/**
 * L'overlay vit sous la WebContentsView : il n'est visible que quand main.js
 * masque la vue — erreur de chargement, ou service en veille.
 */
function refreshOverlay() {
  const item = items.get(activeId);
  if (!item) return;

  overlayAvatar.textContent = item.service.initials;
  overlayAvatar.style.setProperty('--service-color', item.service.color);

  const name = item.service.name;

  if (item.status === 'error') {
    overlayTitle.textContent = t('overlay.errorTitle', { name });
    overlayMessage.textContent = item.message || '';
    overlayRetry.classList.remove('hidden');
  } else if (item.status === 'hibernated') {
    overlayTitle.textContent = t('overlay.sleepingTitle', { name });
    overlayMessage.textContent = t('overlay.sleepingBody');
    overlayRetry.classList.remove('hidden');
  } else {
    overlayTitle.textContent = t('overlay.loading', { name });
    overlayMessage.textContent = '';
    overlayRetry.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
}

overlayRetry.addEventListener('click', () => {
  if (activeId) window.hub.retry(activeId);
});

// ---------------------------------------------------------------------------
// Catalogue
//
// Deux densites dans une seule vue : la galerie occupe tout l'espace tant
// qu'aucun service n'est choisi, puis cede la place aux reglages. Rien n'est
// masque a la va-vite — c'est la meme boite qui change d'etat.
// ---------------------------------------------------------------------------

/** Compare sans accents ni casse : "productivite" doit matcher "Productivité". */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Une saisie qui ressemble a une adresse : "slack.com", "https://x.fr/app". */
function looksLikeUrl(text) {
  const value = (text || '').trim();
  return /^https?:\/\/\S+$/i.test(value) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value);
}

/** Vignette : le logo du site s'il est connu, sinon la pastille de couleur. */
function buildLogo(entry, size) {
  const logo = document.createElement('span');
  logo.className = `logo ${size}`;
  logo.style.setProperty('background', entry.color || '#45475a');

  const img = document.createElement('img');
  img.alt = '';
  img.hidden = true;
  img.addEventListener('error', () => {
    img.hidden = true;
    logo.classList.remove('has-img');
  });

  const text = document.createElement('span');
  text.textContent = entry.initials || '';

  logo.append(img, text);

  const dataUrl = catalogIcons[entry.iconKey];
  if (dataUrl) {
    img.src = dataUrl;
    img.hidden = false;
    logo.classList.add('has-img');
  }

  if (entry.iconKey) {
    const list = tilesByKey.get(entry.iconKey) || [];
    list.push(logo);
    tilesByKey.set(entry.iconKey, list);
  }

  return logo;
}

/** Une vignette arrivee en tache de fond remplit les emplacements deja rendus. */
function applyCatalogIcon(key, dataUrl) {
  catalogIcons[key] = dataUrl;

  for (const logo of tilesByKey.get(key) || []) {
    const img = logo.querySelector('img');
    img.src = dataUrl;
    img.hidden = false;
    logo.classList.add('has-img');
  }
}

function buildTile(entry) {
  const tile = document.createElement('button');
  tile.className = 'tile';
  tile.type = 'button';

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = entry.name;

  tile.append(buildLogo(entry, 'md'), name);
  tile.addEventListener('click', () => pickCatalogEntry(entry));
  return tile;
}

function renderCatalog(query) {
  const needle = normalize(query).trim();
  catalogGrid.innerHTML = '';
  tilesByKey = new Map();

  // Une adresse saisie a la main passe avant tout le reste : c'est une intention
  // explicite, pas une recherche.
  if (looksLikeUrl(query)) {
    const custom = {
      name: query.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''),
      url: query.trim(),
      color: '#45475a',
      initials: '',
    };

    const tile = document.createElement('button');
    tile.className = 'tile custom';
    tile.type = 'button';

    const label = document.createElement('span');
    label.className = 'tile-name';
    label.textContent = custom.name;

    const hint = document.createElement('small');
    hint.textContent = t('picker.custom');

    tile.append(buildLogo({ ...custom, initials: '+' }, 'md'), label, hint);
    tile.addEventListener('click', () => pickCatalogEntry(custom));
    catalogGrid.append(tile);
  }

  // La recherche matche le nom et la categorie traduite : "prod" trouve la
  // rubrique Productivite en francais comme Productivity en anglais.
  const matches = needle
    ? catalog.filter((entry) =>
        normalize(`${entry.name} ${t(`cat.${entry.category}`)}`).includes(needle)
      )
    : catalog;

  // Sans recherche, la galerie garde ses rubriques : c'est ce qui la rend
  // parcourable. Des la premiere lettre, elles n'ont plus de sens et on passe a
  // une grille de resultats a plat.
  if (!needle) {
    let current = null;
    let group = null;

    for (const entry of matches) {
      if (entry.category !== current) {
        current = entry.category;
        const label = document.createElement('p');
        label.className = 'catalog-category';
        label.textContent = t(`cat.${current}`);
        catalogGrid.append(label);

        group = document.createElement('div');
        group.className = 'tiles';
        catalogGrid.append(group);
      }
      group.append(buildTile(entry));
    }
  } else if (matches.length) {
    const group = document.createElement('div');
    group.className = 'tiles';
    for (const entry of matches) group.append(buildTile(entry));
    catalogGrid.append(group);
  }

  catalogEmpty.classList.toggle('hidden', Boolean(matches.length) || looksLikeUrl(query));
}

/** Passage de la galerie aux reglages, avec les champs preremplis. */
function pickCatalogEntry(entry) {
  fields.name.value = entry.name || '';
  fields.url.value = entry.url || '';
  fields.initials.value = entry.initials || (entry.name || '').slice(0, 2).toUpperCase();
  fields.color.value = entry.color || '#45475a';
  fields.spoof.checked = Boolean(entry.spoof);
  pickedIcon = catalogIcons[entry.iconKey] || null;

  modal.classList.add('picked');
  refreshPreview();
  fields.name.focus();
  fields.name.select();
}

searchInput.addEventListener('input', () => renderCatalog(searchInput.value));

searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();

  // Entree valide le premier resultat : c'est le chemin le plus court quand on
  // sait deja ce qu'on cherche.
  const first = catalogGrid.querySelector('.tile');
  if (first) first.click();
});

// ---------------------------------------------------------------------------
// Formulaire de service
// ---------------------------------------------------------------------------

function refreshPreview() {
  const name = fields.name.value.trim();
  previewName.textContent = name || t('form.newService');

  const img = previewLogo.querySelector('img');
  const text = previewLogo.querySelector('span');

  previewLogo.style.setProperty('background', fields.color.value);
  text.textContent = fields.initials.value || name.slice(0, 2).toUpperCase();

  if (pickedIcon) {
    img.src = pickedIcon;
    img.hidden = false;
    previewLogo.classList.add('has-img');
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    previewLogo.classList.remove('has-img');
  }
}

for (const field of [fields.name, fields.initials, fields.color]) {
  field.addEventListener('input', refreshPreview);
}

function openForm(service) {
  editingId = service ? service.id : null;
  pickedIcon = service?.dataUrl || null;

  formError.classList.add('hidden');
  formDelete.classList.toggle('hidden', !service);

  if (service) {
    // Edition : le catalogue n'a rien a faire la, il ecraserait des reglages
    // deja etablis.
    modal.classList.add('picked');
    formTitle.textContent = service.name;
    formSave.textContent = t('form.save');
    formBack.textContent = t('form.cancel');

    fields.name.value = service.name || '';
    fields.url.value = service.url || '';
    fields.initials.value = service.initials || '';
    fields.color.value = service.color || '#45475a';
    fields.hibernate.value = String(service.hibernateAfter ?? 0);
    fields.spoof.checked = Boolean(service.spoofUserAgent);
    fields.preload.checked = service.preload !== false;

    const index = [...items.keys()].indexOf(service.id);
    previewSlot.textContent =
      index >= 0 && index < 9
        ? t('form.slotPosition', { n: index + 1 })
        : t('form.slotSidebar');
  } else {
    modal.classList.remove('picked');
    formTitle.textContent = t('picker.title');
    formSave.textContent = t('form.add');
    formBack.textContent = t('form.back');

    fields.name.value = '';
    fields.url.value = '';
    fields.initials.value = '';
    fields.color.value = '#45475a';
    fields.hibernate.value = '0';
    fields.spoof.checked = false;
    fields.preload.checked = true;

    previewSlot.textContent = t('form.slotEnd');
    searchInput.value = '';
    renderCatalog('');
  }

  refreshPreview();
  modal.classList.remove('hidden');
  // Sans ca le formulaire resterait cache derriere la vue du service.
  window.hub.setModalOpen(true);
  (service ? fields.name : searchInput).focus();
}

function closeForm() {
  modal.classList.add('hidden');
  modal.classList.remove('picked');
  window.hub.setModalOpen(false);
  editingId = null;
  pickedIcon = null;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const result = await window.hub.saveService({
    id: editingId,
    name: fields.name.value,
    url: fields.url.value,
    initials: fields.initials.value,
    color: fields.color.value,
    hibernateAfter: Number(fields.hibernate.value),
    spoofUserAgent: fields.spoof.checked,
    preload: fields.preload.checked,
  });

  if (result?.error) {
    formError.textContent = result.error;
    formError.classList.remove('hidden');
    return;
  }

  closeForm();
});

formDelete.addEventListener('click', async () => {
  if (!editingId) return;
  const result = await window.hub.deleteService(editingId);
  if (result?.ok) closeForm();
});

// En creation, "Back" ramene a la galerie ; en edition, il annule.
formBack.addEventListener('click', () => {
  if (editingId) return closeForm();
  modal.classList.remove('picked');
  searchInput.focus();
});

document.getElementById('form-cancel').addEventListener('click', closeForm);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  // Le formulaire du code de verrouillage se ferme aussi par Echap. L'ecran de
  // verrouillage, lui, ne se ferme jamais autrement que par le bon code.
  if (!lockSetup.classList.contains('hidden')) {
    closeLockSetup();
    return;
  }

  if (modal.classList.contains('hidden')) return;
  // Echap recule d'un cran plutot que de tout fermer : on ne perd pas sa
  // recherche parce qu'on s'est trompe de service.
  if (!editingId && modal.classList.contains('picked')) {
    modal.classList.remove('picked');
    searchInput.focus();
    return;
  }
  closeForm();
});

addButton.addEventListener('click', () => openForm(null));
updateButton.addEventListener('click', () => window.hub.installUpdate());

// ---------------------------------------------------------------------------
// Verrouillage
//
// L'ecran de code recouvre tout ; les vues de service sont masquees cote main
// tant qu'il est affiche. La verification du code se fait cote main, jamais ici.
// ---------------------------------------------------------------------------

const lockscreen = document.getElementById('lockscreen');
const lockForm = document.getElementById('lock-form');
const lockPin = document.getElementById('lock-pin');
const lockError = document.getElementById('lock-error');

const lockSetup = document.getElementById('lock-setup');
const lockSetupForm = document.getElementById('lock-setup-form');
const lockSetupTitle = document.getElementById('lock-setup-title');
const lockSetupSave = document.getElementById('lock-setup-save');
const lockSetupError = document.getElementById('lock-setup-error');
const lockFields = {
  current: document.getElementById('lock-current'),
  next: document.getElementById('lock-new'),
  confirm: document.getElementById('lock-confirm'),
};
let lockMode = null;

function setLocked(isLocked) {
  lockscreen.classList.toggle('hidden', !isLocked);
  if (!isLocked) return;

  // Un formulaire ouvert au moment du verrouillage se ferme : il resterait
  // invisible sous l'ecran de code, dans un etat incoherent.
  if (!modal.classList.contains('hidden')) closeForm();
  if (!lockSetup.classList.contains('hidden')) closeLockSetup();

  lockPin.value = '';
  lockError.classList.add('hidden');
  lockPin.focus();
}

lockForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const result = await window.hub.unlock(lockPin.value);
  if (result?.error) {
    lockError.textContent = result.error;
    lockError.classList.remove('hidden');
    lockPin.value = '';
    lockPin.focus();
  }
  // Le succes arrive par hub:lock { locked: false } : rien a faire ici.
});

function openLockSetup(mode) {
  lockMode = mode;
  lockSetupTitle.textContent = t(`lock.title.${mode}`);

  // 'set' : pas encore de code, donc pas de champ "code actuel".
  // 'remove' : seul le code actuel est demande.
  document.getElementById('lock-current-field').classList.toggle('hidden', mode === 'set');
  document.getElementById('lock-new-field').classList.toggle('hidden', mode === 'remove');
  document.getElementById('lock-confirm-field').classList.toggle('hidden', mode === 'remove');
  lockSetupSave.textContent = mode === 'remove' ? t('lock.removeConfirm') : t('form.save');

  for (const field of Object.values(lockFields)) field.value = '';
  lockSetupError.classList.add('hidden');
  lockSetup.classList.remove('hidden');
  window.hub.setModalOpen(true);
  (mode === 'set' ? lockFields.next : lockFields.current).focus();
}

function closeLockSetup() {
  lockSetup.classList.add('hidden');
  lockMode = null;
  window.hub.setModalOpen(false);
}

lockSetupForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const result = await window.hub.configureLock({
    mode: lockMode,
    current: lockFields.current.value,
    next: lockFields.next.value,
    confirm: lockFields.confirm.value,
  });

  if (result?.error) {
    lockSetupError.textContent = result.error;
    lockSetupError.classList.remove('hidden');
    return;
  }

  closeLockSetup();
});

document.getElementById('lock-setup-cancel').addEventListener('click', closeLockSetup);

function showUpdate(update) {
  if (!update) return;
  const ready = update.state === 'ready';
  updateButton.classList.toggle('hidden', !ready);
  updateButton.title = ready
    ? t('sidebar.updateReady', { version: update.version })
    : t('sidebar.updateDownloading', { version: update.version });
  console.log(`[sidebar] mise a jour ${update.state} : ${update.version}`);
}

// ---------------------------------------------------------------------------
// Onboarding (premier lancement)
//
// Etape 1 : la langue, appliquee immediatement et sans rechargement. Etape 2 :
// les services, choisis dans le catalogue avec les vrais logos, qui arrivent en
// continu pendant que l'utilisateur regarde la grille (le prechargement demarre
// sans delai quand l'onboarding est actif).
// ---------------------------------------------------------------------------

const onboarding = document.getElementById('onboarding');
const obWelcome = document.getElementById('ob-welcome');
const obPick = document.getElementById('ob-pick');
const obGrid = document.getElementById('ob-grid');
const obSkip = document.getElementById('ob-skip');
const obStart = document.getElementById('ob-start');

/** Selection en cours, dans l'ordre du clic : cet ordre devient la sidebar. */
const obPicked = [];

function obRefreshStart() {
  obStart.disabled = !obPicked.length;
  obStart.textContent = obPicked.length
    ? t('ob.start', { count: obPicked.length })
    : t('ob.startNone');
}

function obRenderGrid() {
  obGrid.innerHTML = '';
  let current = null;
  let group = null;

  for (const entry of catalog) {
    if (entry.category !== current) {
      current = entry.category;
      const label = document.createElement('p');
      label.className = 'catalog-category';
      label.textContent = t(`cat.${current}`);
      obGrid.append(label);

      group = document.createElement('div');
      group.className = 'tiles';
      obGrid.append(group);
    }

    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.type = 'button';

    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = '✓';

    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = entry.name;

    tile.append(buildLogo(entry, 'md'), name, tick);

    tile.addEventListener('click', () => {
      const index = obPicked.indexOf(entry);
      if (index >= 0) obPicked.splice(index, 1);
      else obPicked.push(entry);
      tile.classList.toggle('selected', index < 0);
      obRefreshStart();
    });

    group.append(tile);
  }
}

async function obSetLanguage(code) {
  const result = await window.hub.setLanguage(code);
  strings = result.strings || strings;
  document.documentElement.lang = result.language || code;
  applyTranslations();
  obRenderGrid(); // les libelles de categories changent avec la langue
  obRefreshStart();

  obWelcome.classList.add('hidden');
  obPick.classList.remove('hidden');
}

async function obFinish(drafts) {
  const result = await window.hub.completeOnboarding(drafts);
  onboarding.classList.add('hidden');
  console.log(`[onboarding] termine : ${result?.count ?? 0} service(s)`);

  // Personne ne demarre sur une fenetre vide : sans selection, on enchaine sur
  // le formulaire d'ajout.
  if (!result?.count) openForm(null);
}

for (const button of document.querySelectorAll('.ob-langs button')) {
  button.addEventListener('click', () => obSetLanguage(button.dataset.lang));
}

obSkip.addEventListener('click', () => obFinish([]));

obStart.addEventListener('click', () => {
  obStart.disabled = true;
  obFinish(
    obPicked.map((entry) => ({
      name: entry.name,
      url: entry.url,
      initials: entry.initials,
      color: entry.color,
      spoofUserAgent: Boolean(entry.spoof),
      preload: true,
    }))
  );
});

function startOnboarding() {
  // Si l'icone ne charge pas (CSP, chemin), on la retire plutot que d'afficher
  // une image cassee en plein ecran d'accueil.
  const logo = document.querySelector('.ob-logo');
  logo?.addEventListener('error', () => logo.remove());

  obRenderGrid();
  obRefreshStart();
  onboarding.classList.remove('hidden');
  console.log('[onboarding] premier lancement');
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async () => {
  const boot = await window.hub.bootstrap();

  // La traduction s'applique avant tout rendu : sinon l'anglais du HTML
  // apparaitrait une fraction de seconde avant d'etre remplace.
  strings = boot.strings || {};
  document.documentElement.lang = boot.language || 'en';
  applyTranslations();

  if (boot.trayBase) trayBase.src = boot.trayBase;
  catalog = boot.catalog || [];
  catalogIcons = boot.catalogIcons || {};

  activeId = boot.activeId;
  splitId = boot.splitId || null;
  renderSidebar(boot.services);
  if (boot.activeId) setActive(boot.activeId);
  if (boot.splitId) setSplit(boot.splitId);
  showUpdate(boot.update);
  if (boot.locked) setLocked(true);
  if (boot.onboarding) startOnboarding();

  console.log(
    `[sidebar] Nexus ${boot.version} — catalogue : ${catalog.length} services, ` +
      `${Object.keys(catalogIcons).length} vignettes en cache`
  );

  window.hub.onStatus(({ id, status, message }) => setStatus(id, status, message));
  window.hub.onActive(({ id }) => setActive(id));
  window.hub.onSplit(({ id }) => setSplit(id));
  window.hub.onBadge(({ id, count }) => setBadge(id, count));
  window.hub.onIcon(({ id, dataUrl, source }) => setIcon(id, dataUrl, source));
  window.hub.onOrder(({ order }) => applyOrder(order));
  window.hub.onServices(({ services }) => renderSidebar(services));
  window.hub.onCatalogIcon(({ key, dataUrl }) => applyCatalogIcon(key, dataUrl));
  window.hub.onEditService(({ id }) => {
    const item = items.get(id);
    if (item) openForm(item.service);
  });
  window.hub.onNewService(() => openForm(null));
  window.hub.onLock(({ locked }) => setLocked(locked));
  window.hub.onLockSetup(({ mode }) => openLockSetup(mode));
  window.hub.onUpdate(showUpdate);
  window.hub.onLanguage(({ strings: dict, language }) => {
    // Changement depuis le menu Fichier : on retraduit sur place, sans recharger.
    strings = dict || strings;
    document.documentElement.lang = language || 'en';
    applyTranslations();
    refreshShortcutLabels();
    if (!modal.classList.contains('hidden')) renderCatalog(searchInput.value);
    if (activeId) refreshOverlay();
  });
})();
