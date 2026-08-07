'use strict';

/**
 * Configuration des services.
 * Pour ajouter/retirer un service : editer ce tableau, c'est tout.
 *
 * Champs :
 *   id        identifiant unique (sert de cle pour la persistance et les IPC)
 *   name      libelle affiche (tooltip sidebar + menu tray)
 *   url       URL de demarrage
 *   partition partition de session Electron -> DOIT commencer par "persist:" pour
 *             que cookies / localStorage / IndexedDB survivent au redemarrage.
 *             Deux services avec des partitions differentes = deux navigateurs
 *             totalement etanches (3 WhatsApp sur 3 numeros en meme temps).
 *   color     couleur de la pastille d'initiales et du badge
 *   initials  texte affiche quand aucune icone n'est disponible
 *   icon      (optionnel) nom de fichier dans assets/icons/ (PNG/JPG/ICO, 64x64
 *             ou plus) ou chemin absolu. Prioritaire sur la favicon du site.
 *   userAgent (optionnel) force le User-Agent de la partition
 *
 * Ordre de resolution de l'icone : `icon` > favicon du site > initiales.
 * Les 3 WhatsApp ayant la meme favicon, une pastille d'initiales reste affichee
 * par-dessus l'icone pour les distinguer.
 */

// WhatsApp Web refuse les User-Agent contenant "Electron" (page "navigateur non
// supporte" / "mettez a jour votre navigateur"). On se fait passer pour un
// Chrome desktop standard sur les 3 partitions WhatsApp.
// Discord et Google Calendar fonctionnent avec l'UA Electron par defaut.
const WHATSAPP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SERVICES = [
  {
    id: 'wa-redlife',
    name: 'WhatsApp Red Life',
    url: 'https://web.whatsapp.com',
    partition: 'persist:wa-redlife',
    color: '#25D366',
    initials: 'RL',
    userAgent: WHATSAPP_UA,
  },
  {
    id: 'wa-certiflash',
    name: 'WhatsApp CertiFlash',
    url: 'https://web.whatsapp.com',
    partition: 'persist:wa-certiflash',
    color: '#25D366',
    initials: 'CF',
    userAgent: WHATSAPP_UA,
  },
  {
    id: 'wa-alphadigital',
    name: 'WhatsApp Alpha Digital',
    url: 'https://web.whatsapp.com',
    partition: 'persist:wa-alphadigital',
    color: '#25D366',
    initials: 'AD',
    userAgent: WHATSAPP_UA,
  },
  {
    id: 'discord-perso',
    name: 'Discord Perso',
    url: 'https://discord.com/app',
    partition: 'persist:discord-perso',
    color: '#5865F2',
    initials: 'DP',
  },
  {
    id: 'discord-pro',
    name: 'Discord Pro',
    url: 'https://discord.com/app',
    partition: 'persist:discord-pro',
    color: '#5865F2',
    initials: 'DPro',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    url: 'https://calendar.google.com',
    partition: 'persist:gcal',
    color: '#4285F4',
    initials: 'GC',
  },
];

module.exports = { SERVICES, WHATSAPP_UA };
