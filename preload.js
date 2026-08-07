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
  /** Liste des services + service actif au demarrage. */
  bootstrap: () => ipcRenderer.invoke('hub:bootstrap'),

  /** Affiche le service demande (swap de WebContentsView cote main). */
  select: (id) => ipcRenderer.send('hub:select', id),

  /** Relance le chargement d'un service en erreur/timeout. */
  retry: (id) => ipcRenderer.send('hub:retry', id),

  /** Menu natif du clic droit sur une icone de service. */
  serviceMenu: (id) => ipcRenderer.send('hub:service-menu', id),

  /** Nouvel ordre complet des services, apres un drag & drop. */
  reorder: (ids) => ipcRenderer.send('hub:reorder', ids),

  /** { order } - l'ordre a change ailleurs (menu contextuel Monter/Descendre). */
  onOrder: (callback) => on('hub:order', callback),

  /** Pastille de non-lus sur l'icone de la barre des taches (dessinee au canvas). */
  setOverlayBadge: (dataUrl, description) =>
    ipcRenderer.send('hub:overlay', { dataUrl, description }),

  /** { id, status: 'loading' | 'ready' | 'error', message? } */
  onStatus: (callback) => on('hub:status', callback),

  /** { id } - le service actif a change (clic sidebar, raccourci, tray). */
  onActive: (callback) => on('hub:active', callback),

  /** { id, count } - count > 0 : compteur, -1 : pastille sans nombre, 0 : rien. */
  onBadge: (callback) => on('hub:badge', callback),

  /** { id, dataUrl } - favicon recuperee apres coup pour un service. */
  onIcon: (callback) => on('hub:icon', callback),
});
