'use strict';

/**
 * Services livres par defaut.
 *
 * Ce fichier n'est plus la configuration active : il sert de **semence**. Au
 * premier lancement, cette liste est copiee dans le store (config.json), qui
 * devient la seule source de verite. Tout est ensuite modifiable depuis l'app —
 * ajout, edition, suppression, reordonnancement — sans toucher au code.
 *
 * Modifier ce fichier n'a donc d'effet que sur une installation neuve, ou apres
 * "Reinitialiser les services" dans l'app.
 *
 * Champs :
 *   id             identifiant unique, cle des IPC et de la persistance
 *   name           libelle affiche (infobulle sidebar, menu tray)
 *   url            URL de demarrage
 *   partition      partition de session Electron -> DOIT commencer par "persist:"
 *                  pour que cookies / localStorage / IndexedDB survivent au
 *                  redemarrage. Deux partitions differentes = deux navigateurs
 *                  etanches (3 WhatsApp sur 3 numeros en meme temps).
 *   color          couleur de la pastille d'initiales et du badge
 *   initials       texte affiche quand aucune icone n'est disponible
 *   icon           (optionnel) fichier dans assets/icons/ ou chemin absolu
 *   spoofUserAgent (optionnel) se faire passer pour Chrome — voir CHROME_UA
 *   preload        (defaut true) charger des le demarrage. `false` economise un
 *                  process, mais aucun badge ni notification avant la premiere
 *                  ouverture
 *   hibernateAfter (defaut 0) minutes d'inactivite avant mise en veille
 *                  automatique. 0 = jamais. Un service en veille ne consomme
 *                  plus rien, mais ne notifie plus non plus.
 */

// WhatsApp Web refuse les User-Agent contenant "Electron" (page "navigateur non
// supporte"). Les services qui le demandent se font passer pour un Chrome
// desktop standard. Discord et Google Agenda n'en ont pas besoin.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Volontairement minimal et neutre : de quoi comprendre l'app en trois clics,
 * rien de plus. Une installation neuve ne doit pas commencer par le menage de
 * six services qui appartiennent a quelqu'un d'autre.
 *
 * Pour plusieurs comptes d'un meme service, dupliquer l'entree en changeant
 * `id` et `partition` — ou, plus simplement, utiliser le bouton + de la sidebar.
 */
const DEFAULT_SERVICES = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com',
    partition: 'persist:whatsapp',
    color: '#25D366',
    initials: 'WA',
    spoofUserAgent: true, // WhatsApp Web refuse les navigateurs Electron
  },
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    partition: 'persist:discord',
    color: '#5865F2',
    initials: 'DC',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    url: 'https://calendar.google.com',
    partition: 'persist:google-calendar',
    color: '#4285F4',
    initials: 'GC',
  },
];

/** Valeurs par defaut appliquees a tout service, d'ou qu'il vienne. */
const SERVICE_DEFAULTS = {
  icon: null,
  spoofUserAgent: false,
  preload: true,
  hibernateAfter: 0,
};

module.exports = { DEFAULT_SERVICES, SERVICE_DEFAULTS, CHROME_UA };
