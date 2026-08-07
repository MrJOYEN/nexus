'use strict';

// Logique de la sidebar. Aucun acces Node ici : tout passe par window.hub
// (expose par preload.js via contextBridge).

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const overlayAvatar = document.getElementById('overlay-avatar');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const overlayRetry = document.getElementById('overlay-retry');

/** id -> { service, el, status } */
const items = new Map();
let activeId = null;

function renderSidebar(services) {
  sidebar.innerHTML = '';

  services.forEach((service, index) => {
    const el = document.createElement('button');
    el.className = 'service';
    el.type = 'button';
    el.draggable = true; // reordonnancement par glisser-deposer
    el.dataset.id = service.id;
    el.dataset.label = service.name;
    el.dataset.name = `${service.name}   Ctrl+${index + 1}`;
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

    // Pastille d'initiales, affichee uniquement quand une icone remplace
    // l'avatar : les 3 WhatsApp partagent la meme favicon, c'est le seul moyen
    // de les distinguer d'un coup d'oeil.
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
    sidebar.append(el);

    items.set(service.id, { service, el, status: 'idle', badge: 0 });
    if (service.dataUrl) setIcon(service.id, service.dataUrl, service.source);
  });

  console.log(`[sidebar] ${services.length} service(s) rendus`);
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
  const others = [...sidebar.querySelectorAll('.service:not(.dragging)')];

  return others.find((el) => {
    const box = el.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

sidebar.addEventListener('dragover', (event) => {
  if (!dragged) return;
  event.preventDefault(); // sans ca, le drop est refuse
  event.dataTransfer.dropEffect = 'move';

  const target = dropTarget(event.clientY);
  if (target) sidebar.insertBefore(dragged, target);
  else sidebar.append(dragged);
});

sidebar.addEventListener('drop', (event) => event.preventDefault());

/** Ordre du DOM -> main. Les libelles Ctrl+N sont recalcules dans la foulee. */
function persistOrder() {
  const ids = [...sidebar.querySelectorAll('.service')].map((el) => el.dataset.id);
  refreshShortcutLabels();
  console.log(`[sidebar] nouvel ordre : ${ids.join(' > ')}`);
  window.hub.reorder(ids);
}

/** Le raccourci depend de la position : il suit l'icone quand elle se deplace. */
function refreshShortcutLabels() {
  [...sidebar.querySelectorAll('.service')].forEach((el, index) => {
    el.dataset.name = `${el.dataset.label}   Ctrl+${index + 1}`;
  });
}

/** Ordre impose par le main (menu contextuel Monter / Descendre). */
function applyOrder(order) {
  for (const id of order) {
    const item = items.get(id);
    if (item) sidebar.append(item.el); // append deplace l'element existant
  }
  refreshShortcutLabels();
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

  console.log(`[sidebar] ${id} -> ${status}${message ? ` (${message})` : ''}`);
  if (id === activeId) refreshOverlay();
}

/**
 * Icone du service (data URI fournie par main.js : fichier local declare dans
 * services.js, ou favicon du site).
 */
function setIcon(id, dataUrl, source) {
  const item = items.get(id);
  if (!item) return;

  const img = item.el.querySelector('.avatar img');

  // dataUrl null = "Icone par defaut" sans favicon disponible -> initiales.
  if (!dataUrl) {
    img.removeAttribute('src');
    img.hidden = true;
    item.el.classList.remove('has-icon', 'auto-icon');
    return;
  }

  img.src = dataUrl;
  img.hidden = false;
  item.el.classList.add('has-icon');
  // Pastille d'initiales uniquement sur les icones automatiques : c'est la que
  // deux services peuvent etre indiscernables (les 3 WhatsApp). Des que tu
  // choisis ton icone, la pastille disparait.
  item.el.classList.toggle('auto-icon', source === 'favicon');
}

/**
 * Badge de non-lus. Le comptage vient de main.js, qui parse le titre de la page
 * du service ("(3) WhatsApp"). count === -1 = non-lus sans nombre -> pastille.
 */
function setBadge(id, count) {
  const item = items.get(id);
  if (!item) return;

  item.badge = count;
  const badge = item.el.querySelector('.badge');
  badge.classList.toggle('dot', count === -1);
  badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  item.el.classList.toggle('has-badge', count !== 0);

  updateCounters();
}

// ---------------------------------------------------------------------------
// Pastille sur l'icone de la barre des taches Windows
//
// Electron ne fournit pas setBadgeCount sous Windows : il faut lui passer une
// image ("overlay icon"). On la dessine ici au canvas — le renderer a le rendu
// de texte et l'antialiasing gratuitement — puis on l'envoie au main process.
// ---------------------------------------------------------------------------

const overlayCanvas = document.createElement('canvas');
overlayCanvas.width = 32;
overlayCanvas.height = 32;

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

// ---------------------------------------------------------------------------
// Icone du tray, recomposee avec le compteur
//
// Quand la fenetre est masquee dans le tray, elle n'a plus de bouton dans la
// barre des taches — donc plus de pastille. Le tray prend le relais : on
// redessine son icone avec le compteur incruste.
// ---------------------------------------------------------------------------

const trayCanvas = document.createElement('canvas');
trayCanvas.width = 64;
trayCanvas.height = 64;

const trayBase = new Image();
let trayBaseReady = false;

trayBase.addEventListener('load', () => {
  trayBaseReady = true;
  updateCounters(); // l'image a pu arriver apres le premier badge
});

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

/** Recalcule le total et met a jour les deux compteurs (taskbar + tray). */
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

/**
 * L'overlay vit sous la WebContentsView : il n'est visible que quand main.js
 * masque la vue, c'est-a-dire en cas d'erreur / timeout de chargement.
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

// Bootstrap
(async () => {
  const { services, activeId: initialId, trayBase: trayBaseUrl } = await window.hub.bootstrap();
  if (trayBaseUrl) trayBase.src = trayBaseUrl;
  renderSidebar(services);
  setActive(initialId || services[0]?.id);

  window.hub.onStatus(({ id, status, message }) => setStatus(id, status, message));
  window.hub.onActive(({ id }) => setActive(id));
  window.hub.onBadge(({ id, count }) => setBadge(id, count));
  window.hub.onIcon(({ id, dataUrl, source }) => setIcon(id, dataUrl, source));
  window.hub.onOrder(({ order }) => applyOrder(order));
})();
