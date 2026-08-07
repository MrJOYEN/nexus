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
const form = document.getElementById('service-form');
const formTitle = document.getElementById('form-title');
const formError = document.getElementById('form-error');
const formDelete = document.getElementById('form-delete');
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
let editingId = null;

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
    // Si l'icone est cassee, on retombe proprement sur les initiales.
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
    // indiscernables (trois WhatsApp partagent la meme favicon).
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

  const description = total > 0 ? `${total} messages non lus` : 'Messages non lus';
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

  if (item.status === 'error') {
    overlayTitle.textContent = `${item.service.name} n'a pas pu se charger`;
    overlayMessage.textContent = item.message || '';
    overlayRetry.classList.remove('hidden');
  } else if (item.status === 'hibernated') {
    overlayTitle.textContent = `${item.service.name} est en veille`;
    overlayMessage.textContent = 'Son process a ete libere. Clique pour le reveiller.';
    overlayRetry.classList.remove('hidden');
  } else {
    overlayTitle.textContent = `Chargement de ${item.service.name}...`;
    overlayMessage.textContent = '';
    overlayRetry.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
}

overlayRetry.addEventListener('click', () => {
  if (activeId) window.hub.retry(activeId);
});

// ---------------------------------------------------------------------------
// Formulaire de service
// ---------------------------------------------------------------------------

function openForm(service) {
  editingId = service ? service.id : null;

  formTitle.textContent = service ? `Modifier ${service.name}` : 'Nouveau service';
  fields.name.value = service?.name || '';
  fields.url.value = service?.url || '';
  fields.initials.value = service?.initials || '';
  fields.color.value = service?.color || '#45475a';
  fields.hibernate.value = String(service?.hibernateAfter ?? 0);
  fields.spoof.checked = Boolean(service?.spoofUserAgent);
  fields.preload.checked = service ? service.preload !== false : true;

  formError.classList.add('hidden');
  formDelete.classList.toggle('hidden', !service);

  modal.classList.remove('hidden');
  // Sans ca le formulaire resterait cache derriere la vue du service.
  window.hub.setModalOpen(true);
  fields.name.focus();
}

function closeForm() {
  modal.classList.add('hidden');
  window.hub.setModalOpen(false);
  editingId = null;
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
  // La confirmation est une boite native, cote main : la vue reste escamotee
  // tant que le formulaire est ouvert, donc rien a masquer de plus ici.
  const result = await window.hub.deleteService(editingId);
  if (result?.ok) closeForm();
});

document.getElementById('form-cancel').addEventListener('click', closeForm);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeForm();
});

addButton.addEventListener('click', () => openForm(null));
updateButton.addEventListener('click', () => window.hub.installUpdate());

function showUpdate(update) {
  if (!update) return;
  const ready = update.state === 'ready';
  updateButton.classList.toggle('hidden', !ready);
  updateButton.title = ready
    ? `Installer la version ${update.version} et redemarrer`
    : `Telechargement de ${update.version}...`;
  console.log(`[sidebar] mise a jour ${update.state} : ${update.version}`);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async () => {
  const boot = await window.hub.bootstrap();
  if (boot.trayBase) trayBase.src = boot.trayBase;

  activeId = boot.activeId;
  renderSidebar(boot.services);
  if (boot.activeId) setActive(boot.activeId);
  showUpdate(boot.update);

  console.log(`[sidebar] Nexus ${boot.version}`);

  window.hub.onStatus(({ id, status, message }) => setStatus(id, status, message));
  window.hub.onActive(({ id }) => setActive(id));
  window.hub.onBadge(({ id, count }) => setBadge(id, count));
  window.hub.onIcon(({ id, dataUrl, source }) => setIcon(id, dataUrl, source));
  window.hub.onOrder(({ order }) => applyOrder(order));
  window.hub.onServices(({ services }) => renderSidebar(services));
  window.hub.onEditService(({ id }) => {
    const item = items.get(id);
    if (item) openForm(item.service);
  });
  window.hub.onUpdate(showUpdate);
})();
