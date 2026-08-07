# Nexus

Wrapper desktop Electron (Windows) qui regroupe 6 services web dans une seule
fenetre avec une sidebar, chaque service tournant dans une **session totalement
isolee** (3 comptes WhatsApp connectes en meme temps, 2 Discord, 1 Google Calendar).

## Raccourcis clavier

| Raccourci        | Action                                                  |
| ---------------- | ------------------------------------------------------- |
| `Ctrl+1` … `Ctrl+6` | Basculer sur le service N (ordre de `services.js`)   |
| `Ctrl+R`         | Recharger le service actif                              |
| `Ctrl+Shift+R`   | Hard reload : vide le cache de la partition puis recharge |
| `Ctrl+Shift+I`   | DevTools du service actif                               |
| `Ctrl+,`         | DevTools de la sidebar (renderer principal)             |
| `Ctrl+Q`         | Quitter reellement l'app                                |

Les raccourcis passent par `before-input-event` (branche sur la sidebar **et** sur
chaque vue de service) plutot que par `globalShortcut` : ils ne fonctionnent que
quand l'app a le focus, et ne volent donc pas `Ctrl+1` au reste du systeme.

## Ordre des services

**Glisser-deposer l'icone dans la sidebar**, ou clic droit > _Monter_ / _Descendre_.
L'ordre est conserve au redemarrage et fait autorite partout : la 3e icone est
toujours `Ctrl+3`, et le menu du tray suit la meme sequence.

`services.js` ne definit donc que l'ordre **initial**. Un service ajoute plus tard
apparait a la fin sans perturber ton classement ; un service retire de
`services.js` disparait de l'ordre stocke sans le casser.

## Compteurs de non-lus

Le nombre est lu dans le **titre de la page** du service (`(3) WhatsApp`,
`(1) Discord`) via `page-title-updated`. Il alimente trois endroits :

- le badge rouge sur l'icone de la sidebar ;
- l'infobulle du tray (`Nexus - 7 non lus`) ;
- la **pastille sur l'icone de la barre des taches Windows**, qui affiche le total
  tous services confondus.

`app.setBadgeCount()` n'existe pas sous Windows : la pastille de la barre des
taches est une _overlay icon_, dessinee au canvas dans le renderer
(`drawOverlayBadge` dans `renderer/sidebar.js`) puis posee par `setOverlayIcon`.
Pour changer sa couleur ou sa forme, tout est dans cette fonction.

Cas particulier : quand un service signale des non-lus **sans compteur**
(Discord affiche parfois `• Discord | Amis`), le badge devient une pastille sans
chiffre.

**Ce que le nombre veut dire depend du service**, et l'app ne fait que relayer.
WhatsApp compte les **conversations** non lues, pas les messages : dix messages
du meme contact affichent `(1)`, un message de deux contacts differents affiche
`(2)`. Verifie dans les logs — le titre ne change tout simplement pas quand un
message arrive dans une conversation deja non lue.

C'est la meme valeur que WhatsApp affiche dans un onglet de navigateur. Obtenir
un compte de messages demanderait de lire la liste des conversations dans le DOM
de WhatsApp : classes obfusquees et libelles traduits, donc casse a chaque
refonte. Le titre, lui, est stable depuis des annees.

Quand la fenetre est masquee dans le tray, elle n'a plus de bouton dans la barre
des taches — donc plus de pastille. L'icone du tray prend alors le relais : elle
est recomposee avec le compteur incruste (`drawTrayIcon`). Au-dela de 9 elle
affiche `9+`, un chiffre plus long etant illisible une fois reduit a 16px.

## Couper les notifications d'un service

**Clic droit sur l'icone > _Notifications_** (case a cocher). Instantane, sans
rechargement, conserve au redemarrage.

Refuser la permission ne suffisait pas : les sites l'ont deja obtenue et en
gardent l'etat en cache. `window.Notification` est donc enveloppe directement
dans la page, via `executeJavaScript` — qui s'execute dans le monde principal,
contrairement a un preload qui, avec `contextIsolation`, ne pourrait pas toucher
au `window` du site. Le wrapper est pose sur `dom-ready`, avant que le site n'en
garde une reference ; ensuite seul un drapeau bascule.

Les badges de non-lus continuent de fonctionner sur un service coupe : c'est le
son et la pop-up Windows qui disparaissent, pas le comptage.

Trois voies mènent au bruit, et couper la seule API Notification n'en ferme
qu'une :

| Voie | Blocage |
| --- | --- |
| `new Notification(...)` depuis la page | wrapper pose sur `dom-ready` |
| `ServiceWorkerRegistration.showNotification()` | prototype enveloppe |
| Push recu directement par le service worker | permission Chromium refusee |
| Son joue par la page elle-meme (le "ding" de WhatsApp) | `setAudioMuted(true)` |

La derniere ligne est la moins evidente : WhatsApp joue son propre son via l'API
audio, totalement en dehors du systeme de notifications. **Consequence assumee :
un service coupe est aussi muet pendant un appel.** Pour decoupler les deux,
retirer l'appel a `setAudioMuted` dans `applyMuteState` (`main.js`).

## Tray & fermeture

- **Clic gauche** sur l'icone : affiche / masque la fenetre.
- **Clic droit** : les 6 services en acces direct (ouvre + focus) + Quitter.
- **Clic sur X** : la fenetre est masquee dans le tray, l'app continue de tourner
  (les services restent connectes et continuent d'emettre des notifications).
  Pour quitter pour de vrai : menu tray > Quitter, ou `Ctrl+Q`.

## Comportement au demarrage

Le dernier service actif est restaure, puis les 5 autres sont charges en
arriere-plan espaces de 1,5 s. C'est volontaire : sans ce prechargement, un service
jamais ouvert n'emettrait ni badge ni notification. `backgroundThrottling: false`
empeche Chromium de mettre en veille les WebSocket des vues masquees.

Chaque service preche coute un process Chromium. Pour ceux dont tu n'attends
aucune notification en arriere-plan (Google Agenda, typiquement), ajouter
`preload: false` dans `services.js` : ils ne se chargent qu'au premier clic.

Une vraie mise en veille des services inactifs n'aurait pas de sens ici : elle
reviendrait a desactiver ce pour quoi l'app existe. `preload: false` est le seul
arbitrage honnete entre memoire et notifications — service par service, en
connaissance de cause.

## Prerequis

- Node.js >= 20 (teste sur 22.14)
- Windows 10/11

## Commandes

```bash
npm install     # deps (telecharge Electron ~150 Mo au premier run)
npm start       # lance l'app
npm run dev     # idem + DevTools de la sidebar en fenetre detachee
npm run pack    # build non empaquete dans dist/win-unpacked (test rapide)
npm run build   # installer NSIS -> dist/Nexus-Setup-1.0.0.exe
```

Le build est **non signe** (usage perso) : aucun certificat requis. SmartScreen
affichera un avertissement "Editeur inconnu" au premier lancement de l'installer,
c'est normal — "Informations complementaires" > "Executer quand meme".

## Architecture

```
main.js       process principal : fenetre, sessions isolees, WebContentsView, IPC
preload.js    bridge contextBridge (window.hub) - seule surface exposee au renderer
services.js   config des services (le seul fichier a editer pour ajouter/retirer)
renderer/     sidebar en HTML/CSS/JS vanilla (= webContents de la BrowserWindow)
```

La `BrowserWindow` affiche la sidebar sur toute sa surface ; la `WebContentsView`
du service actif vient se poser par-dessus a partir de `x = 64px`. Quand un service
est en erreur, sa vue est masquee : l'ecran "Reessayer" du renderer redevient visible.

**Securite** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
sur la fenetre principale comme sur chaque vue de service.

## Ajouter un service

Editer `services.js` et ajouter une entree :

```js
{
  id: 'slack-boulot',                    // unique, sert de cle IPC + persistance
  name: 'Slack Boulot',
  url: 'https://app.slack.com/client',
  partition: 'persist:slack-boulot',     // "persist:" obligatoire pour garder la session
  color: '#4A154B',
  initials: 'SB',
  // userAgent: '...'                    // optionnel, seulement si le service bloque Electron
}
```

Redemarrer l'app. Rien d'autre a toucher : la sidebar, les raccourcis et le menu
tray se construisent depuis ce tableau.

## Icones de la sidebar

**Le plus simple : clic droit sur l'icone > _Changer l'icone..._**, choisir une
image, c'est applique immediatement et conserve au redemarrage. _Icone par defaut_
annule le choix. Le meme menu donne aussi _Recharger_ et _Outils de developpement_
pour ce service.

Quatre niveaux, dans cet ordre :

1. **Icone choisie dans l'app** (clic droit) — stockee en data URI 64x64 dans
   `config.json`, donc insensible au deplacement ou a la suppression du fichier
   source.
2. **Icone declaree** — deposer l'image dans `assets/icons/` et ajouter `icon:
   'mon-fichier.png'` au service dans `services.js`. Pratique pour versionner une
   config complete.
3. **Favicon du site** — recuperee toute seule au chargement, aucune config.
4. **Initiales colorees** — si tout le reste echoue.

Formats acceptes : PNG, JPEG, ICO (ce que `nativeImage` sait decoder).

Les icones sont affichees **pleines** : pas de fond, pas de cadre, pas de marge —
l'image occupe tout l'avatar (48px) et c'est sa propre forme qui prime. Le rayon
de 14px adoucit seulement les icones carrees.

Une pastille d'initiales n'apparait que sur les icones **automatiques** (favicon),
la ou deux services peuvent etre indiscernables — les 3 WhatsApp. Des que tu
choisis une icone toi-meme, elle disparait. Pour la supprimer partout, retirer la
regle `.service.has-icon.auto-icon .chip` dans `renderer/style.css`.

Quand un site declare plusieurs icones, la plus **definie** est retenue : les
candidates sont comparees sur leurs dimensions reelles (pas sur leur poids, un
PNG 16x16 mal compresse pouvant depasser un 256x256), les vectorielles gagnant
d'office. Le meilleur score est conserve pour toute la duree du chargement, sinon
la derniere annoncee ecraserait la meilleure — Discord annonce son icone
vectorielle, puis une version canvas de 16px avec son compteur incruste.

Deux details qui compliquent ce classement, tous les deux traites dans `main.js` :

- le `content-type` renvoye par les serveurs est peu fiable, le format est donc
  determine par les nombres magiques du fichier (`sniffMime`) ;
- `nativeImage` ne mesure ni les WebP ni les ICO. WhatsApp servant sa favicon en
  **WebP**, ses dimensions sont lues directement dans l'en-tete du fichier
  (`webpWidth`) ; les ICO, multi-resolution, recoivent un score plancher puisque
  Chromium y choisit lui-meme la meilleure frame.

Les icones transitent en data URI : la CSP du renderer reste en `img-src 'self'
data:`, aucune requete reseau n'est faite depuis la sidebar.

Pour **retirer** un service, supprimer son entree. Ses donnees restent sur disque
dans `%APPDATA%\Nexus\Partitions\<partition>` — a supprimer a la main si
tu veux vraiment repartir de zero.

## Troubleshooting

### Apres installation, je ne trouve que "Electron" dans le menu Demarrer

Deux raccourcis coexistent, et un seul est le bon :

```
Nexus.lnk    -> %LOCALAPPDATA%\Programs\Nexus\Nexus.exe          <- l'app installee
Electron.lnk -> <projet>\node_modules\electron\dist\electron.exe <- parasite de dev
```

Le second est cree automatiquement par `npm start` : pour afficher des toasts,
Windows exige un raccourci du menu Demarrer portant l'AppUserModelID de l'app,
et Chromium le fabrique en pointant sur le binaire Electron brut. Lance
directement, celui-ci n'a aucune application a charger et affiche la page
d'accueil d'Electron.

**Il ne se contente pas d'encombrer le menu Demarrer.** Windows n'utilise pas
l'icone de l'exe pour la barre des taches : il resout l'AppUserModelID vers un
raccourci et lui emprunte son icone et son libelle. Deux raccourcis revendiquant
`com.mehdi.nexus`, c'est le parasite qui peut gagner — l'app installee se
retrouve alors avec le logo Electron et le nom "Electron" en barre des taches.

D'ou l'identifiant distinct hors packaging (`main.js`) :

```js
app.setAppUserModelId(app.isPackaged ? 'com.mehdi.nexus' : 'com.mehdi.nexus.dev');
```

Le raccourci de dev ne peut plus revendiquer l'identite de l'app installee. Si le
mal est deja fait, supprimer `Electron.lnk` du menu Demarrer et relancer l'app.

**Version installee et version de dev partagent le meme `%APPDATA%\Nexus`** :
l'app installee retrouve les sessions ouvertes en dev, et inversement. Ne pas
lancer les deux en meme temps — le verrou d'instance unique fera que la seconde
se contentera de reveiller la fenetre de la premiere.

### L'ancien dossier `%APPDATA%\Messenger Hub`

Le projet s'appelait "Messenger Hub" avant d'etre renomme en Nexus. Le nom du
produit determine `app.getPath('userData')` : renommer sans rien faire aurait
donc reinitialise toutes les sessions (re-scan des 3 QR WhatsApp, relogin Google).
Le dossier a ete **copie** vers `%APPDATA%\Nexus` — l'ancien (~300 Mo) n'est plus
lu par personne et peut etre supprime une fois que tout est verifie.

Meme regle a l'avenir : changer `productName` dans `package.json` = changer de
dossier de donnees.

### `npm start` plante sur `TypeError: Cannot read properties of undefined (reading 'setAppUserModelId')`

La variable d'environnement `ELECTRON_RUN_AS_NODE=1` est presente : Electron demarre
alors comme un Node classique et `require('electron')` ne renvoie pas l'API (donc
`app` est `undefined`). C'est le cas dans le terminal integre de VS Code / Cursor
et dans certains harnais d'agents.

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

Rien a corriger dans le code : lance depuis un PowerShell/cmd normal et le probleme
n'apparait pas.

### WhatsApp affiche "Navigateur non supporte" / refuse de charger

WhatsApp Web bloque les User-Agent contenant `Electron`. Deux garde-fous sont deja
en place dans `main.js` (`getServiceSession`) :

1. reecriture de l'en-tete `User-Agent` via `session.webRequest.onBeforeSendHeaders`
   vers un Chrome 125 desktop ;
2. suppression des Client Hints `sec-ch-ua*`, qui trahissent Chromium/Electron meme
   quand l'UA string est maquillee.

Si le blocage persiste : mettre a jour la version de Chrome dans `WHATSAPP_UA`
(`services.js`) pour coller a une version recente, puis vider la partition
(`%APPDATA%\Nexus\Partitions\persist%3Awa-...`) et relancer.

### Un service reste bloque sur "Chargement..." puis propose "Reessayer"

Timeout de 15s (`LOAD_TIMEOUT_MS` dans `main.js`). Causes typiques : pas de reseau,
proxy/VPN, ou service down. Le bouton relance simplement `loadURL`.
`Ctrl+Shift+I` (etape 6) ouvrira les DevTools de la vue pour voir l'erreur reelle.

### Les 3 WhatsApp se deconnectent mutuellement

Verifier que chaque service a bien une `partition` **differente** et prefixee
`persist:` dans `services.js`. Deux services partageant la meme partition partagent
cookies et localStorage.

### Les notifications n'apparaissent pas dans le centre de notifications Windows

Verifier que les notifications sont autorisees pour l'app dans
_Parametres > Systeme > Notifications_, et que l'Assistant de concentration est off.
L'AppUserModelID (`com.mehdi.nexus`) est defini dans `main.js` ; en mode
`npm start` (non installe) Windows peut afficher "Electron" comme emetteur — apres
installation via l'installer NSIS, le bon nom apparait.

### Un service ne recoit pas ses notifications Windows

1. Le service doit avoir accorde la permission cote web (dans WhatsApp :
   _Parametres > Notifications_ ; dans Discord : _Parametres > Notifications_).
2. Cote Electron, la permission est accordee automatiquement (`ALLOWED_PERMISSIONS`
   dans `main.js`) — le log `[permission] <service> demande "notifications" -> OK`
   le confirme au premier chargement.
3. La fenetre doit rester **masquee, pas quittee** : un service quitte ne notifie plus.

## Feuille de route

- [x] 1. Scaffolding + `package.json`
- [x] 2. POC mono-service : WebContentsView + partition isolee + UA spoofing
- [x] 3. Sidebar complete + switching entre services
- [x] 4. Les 6 services + verification de l'isolation
- [x] 5. Badges de notifications (parsing `page-title-updated`) + notifs natives
- [x] 6. Tray + raccourcis clavier + persistance (electron-store) + close-to-tray
- [x] 7. Build NSIS (`dist\Nexus-Setup-1.0.0.exe`, 95 Mo) — installation a
      verifier a la main sur le poste cible

Ajoute apres coup : icones personnalisables (clic droit), compteur sur la barre
des taches et sur le tray, reordonnancement par glisser-deposer, coupure des
notifications par service, chargement paresseux optionnel.

## Note sur electron-store

La version pinnee est `8.2.0`, derniere version **CommonJS** du paquet.
`electron-store` >= 10 est ESM-only, ce qui obligerait a passer tout le projet en
ESM (ou a des `await import()` dans `main.js`) — inutile ici.
