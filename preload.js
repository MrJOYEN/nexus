'use strict';

// Bridge sidebar <-> main. Seule surface exposee au renderer (contextIsolation
// active, nodeIntegration desactive) : pas d'acces direct a Node ni a ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

contextBridge.exposeInMainWorld('hub', {
  /** Services, service actif, version, mise a jour en attente. */
  bootstrap: () => ipcRenderer.invoke('hub:bootstrap'),

  /** Affiche le service demande (swap de WebContentsView cote main). */
  select: (id) => ipcRenderer.send('hub:select', id),

  /** Relance le chargement d'un service en erreur, en veille ou en timeout. */
  retry: (id) => ipcRenderer.send('hub:retry', id),

  /** Menu natif du clic droit sur une icone de service. */
  serviceMenu: (id) => ipcRenderer.send('hub:service-menu', id),

  /** Cree ou met a jour un service -> { ok } ou { error }. */
  saveService: (draft) => ipcRenderer.invoke('hub:service-save', draft),

  /** Fin d'onboarding : cree les services choisis et demarre. */
  completeOnboarding: (drafts) => ipcRenderer.invoke('hub:onboard-complete', drafts),

  /** Change la langue -> { strings, language, preference }. */
  setLanguage: (preference) => ipcRenderer.invoke('hub:set-language', preference),

  /** { strings, language } - la langue a change depuis le menu. */
  onLanguage: (callback) => on('hub:language', callback),

  /** Supprime un service, apres confirmation native. */
  deleteService: (id) => ipcRenderer.invoke('hub:service-delete', id),

  /** Nouvel ordre complet des services, apres un drag & drop. */
  reorder: (ids) => ipcRenderer.send('hub:reorder', ids),

  /** Redemarre l'app sur la version telechargee. */
  installUpdate: () => ipcRenderer.send('hub:install-update'),

  /** Escamote la vue du service pour laisser voir une boite de dialogue. */
  setModalOpen: (open) => ipcRenderer.send('hub:modal', open),

  /** Pastille de non-lus sur l'icone de la barre des taches (dessinee au canvas). */
  setOverlayBadge: (dataUrl, description) =>
    ipcRenderer.send('hub:overlay', { dataUrl, description }),

  /** Icone du tray recomposee avec le compteur ; null = icone d'origine. */
  setTrayIcon: (dataUrl) => ipcRenderer.send('hub:tray-icon', dataUrl),

  /** { id, status: 'loading' | 'ready' | 'error' | 'hibernated', message? } */
  onStatus: (callback) => on('hub:status', callback),

  /** { id } - le service actif a change (clic sidebar, raccourci, tray). */
  onActive: (callback) => on('hub:active', callback),

  /** { id, count } - count > 0 : compteur, -1 : pastille sans nombre, 0 : rien. */
  onBadge: (callback) => on('hub:badge', callback),

  /** { id, dataUrl, source } - icone resolue pour un service. */
  onIcon: (callback) => on('hub:icon', callback),

  /** { order } - l'ordre a change ailleurs (menu contextuel Monter/Descendre). */
  onOrder: (callback) => on('hub:order', callback),

  /** { services } - la liste a change (creation, edition, suppression). */
  onServices: (callback) => on('hub:services', callback),

  /** { id } - le menu contextuel demande l'ouverture du formulaire d'edition. */
  onEditService: (callback) => on('hub:edit-service', callback),

  /** Le menu Fichier demande le formulaire de creation. */
  onNewService: (callback) => on('hub:new-service', callback),

  /** { domain, dataUrl } - vignette de catalogue arrivee en tache de fond. */
  onCatalogIcon: (callback) => on('hub:catalog-icon', callback),

  /** { state: 'downloading' | 'ready', version } */
  onUpdate: (callback) => on('hub:update', callback),
});
