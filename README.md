# Nexus

Wrapper desktop Electron (Windows) qui regroupe tes services web dans une seule
fenetre avec une sidebar, chaque service tournant dans une **session totalement
isolee**.

C'est cette isolation qui fait tout l'interet : plusieurs comptes du **meme**
service peuvent rester connectes en parallele — trois WhatsApp sur trois numeros,
deux Discord, autant de boites qu'on veut — sans jamais se deconnecter les uns
les autres. La ou un navigateur classique n'en tolere qu'un seul a la fois.

L'app est livree avec trois services d'exemple (WhatsApp, Discord, Google
Calendar). Tout le reste s'ajoute depuis l'interface : bouton `+`, une URL, et
c'est fait.

## Raccourcis clavier

| Raccourci        | Action                                                  |
| ---------------- | ------------------------------------------------------- |
| `Alt`            | Afficher la barre de menus                              |
| `Ctrl+N`         | Nouveau service                                         |
| `Ctrl+1` … `Ctrl+9` | Basculer sur le service N (ordre de la sidebar)      |
| `Ctrl+R`         | Recharger le service actif                              |
| `Ctrl+Shift+R`   | Hard reload : vide le cache de la partition puis recharge |
| `Ctrl+Shift+I`   | DevTools du service actif                               |
| `Ctrl+,`         | DevTools de la sidebar (renderer principal)             |
| `Ctrl+Q`         | Quitter reellement l'app                                |

Les raccourcis passent par `before-input-event` (branche sur la sidebar **et** sur
chaque vue de service) plutot que par `globalShortcut` : ils ne fonctionnent que
quand l'app a le focus, et ne volent donc pas `Ctrl+1` au reste du systeme.

## Barre de menus

Masquee par defaut, **revelee par `Alt`** : l'app reste epuree sans priver d'un
point d'entree conventionnel vers _A propos_, les mises a jour, la documentation
et le report de bug. Les memes entrees essentielles sont dans le menu du tray.

_A propos_ affiche les versions de Nexus, Electron, Chromium et Node, avec un
bouton pour les copier — c'est la premiere chose qu'on demande dans un rapport de
bug, et personne ne sait les retrouver autrement.

Detail d'implementation qui a son importance : les entrees de menu declarent leur
raccourci avec `registerAccelerator: false`. Le raccourci s'**affiche** dans le
menu mais n'est pas capte par lui — sans quoi chaque frappe serait traitee deux
fois, par le menu et par `before-input-event`. Un `Ctrl+Shift+I` aurait ouvert
puis referme les DevTools dans la foulee.

## Ordre des services

**Glisser-deposer l'icone dans la sidebar**, ou clic droit > _Monter_ / _Descendre_.
L'ordre est conserve au redemarrage et fait autorite partout : la 3e icone est
toujours `Ctrl+3`, et le menu du tray suit la meme sequence.

L'ordre vit dans `config.json`, pas dans le code. Un service cree plus tard
apparait a la fin sans perturber ton classement ; un service supprime disparait
de l'ordre stocke sans le casser.

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
- **Clic droit** : tous les services en acces direct (ouvre + focus) + Quitter.
- **Clic sur X** : la fenetre est masquee dans le tray, l'app continue de tourner
  (les services restent connectes et continuent d'emettre des notifications).
  Pour quitter pour de vrai : menu tray > Quitter, ou `Ctrl+Q`.

## Comportement au demarrage

Le dernier service actif est restaure, puis les 5 autres sont charges en
arriere-plan espaces de 1,5 s. C'est volontaire : sans ce prechargement, un service
jamais ouvert n'emettrait ni badge ni notification. `backgroundThrottling: false`
empeche Chromium de mettre en veille les WebSocket des vues masquees.

Chaque service preche coute un process Chromium. Pour ceux dont tu n'attends
aucune notification en arriere-plan (Google Agenda, typiquement), decocher
**Charger au demarrage** dans le formulaire d'edition : ils ne se chargent qu'au
premier clic. Voir aussi [Mise en veille](#mise-en-veille), qui decharge un
service deja demarre.

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
services.js   semence : services livres par defaut, copies dans config.json au 1er run
catalog.js    catalogue de services proposes a l'ajout (aide a la saisie)
renderer/     sidebar en HTML/CSS/JS vanilla (= webContents de la BrowserWindow)
```

La `BrowserWindow` affiche la sidebar sur toute sa surface ; la `WebContentsView`
du service actif vient se poser par-dessus a partir de `x = 64px`. Quand un service
est en erreur, sa vue est masquee : l'ecran "Reessayer" du renderer redevient visible.

**Securite** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
sur la fenetre principale comme sur chaque vue de service.

## Mises a jour automatiques

L'app packagee interroge les **GitHub Releases** du depot au demarrage puis toutes
les 4 heures, telecharge en arriere-plan et propose de redemarrer. Rien n'est
installe sans action de ta part : un bouton apparait en bas de la sidebar et dans
le menu du tray.

Publier une version :

```bash
npm version patch          # 1.0.0 -> 1.0.1 (electron-updater compare les versions)
set GH_TOKEN=<token>       # scope "repo"
npm run release            # build + publication de la Release GitHub
```

`npm run build` continue de produire un installeur local sans rien publier.

- Le depot doit etre **public**, sinon electron-updater ne peut pas lire les
  Releases sans jeton embarque dans l'app.
- L'app n'est pas signee : electron-updater ne verifie donc pas de signature
  (`publisherName` n'est pas configure). Ca fonctionne, mais quiconque
  controlerait le depot pourrait pousser une version — c'est le compromis assume
  d'une distribution non signee.
- La mise a jour differentielle s'appuie sur le `.blockmap` genere a cote de
  l'installeur : il doit accompagner chaque Release.

## Mise en veille

Un service en veille est **detruit** : son process Chromium disparait et la
memoire est rendue. En contrepartie il ne remonte plus ni badge ni notification
jusqu'au prochain clic, qui le recharge. C'est le seul arbitrage possible — un
service qui notifie est un service qui tourne.

Deux voies :

- **manuelle** — clic droit sur l'icone > _Mettre en veille_ ;
- **automatique** — un delai par service dans le formulaire d'edition (jamais,
  15 min, 30 min, 1 h, 3 h). Le compte a rebours demarre quand le service passe
  en arriere-plan et s'annule des qu'on y revient.

Le service affiche n'est jamais endormi, quel que soit le delai : la zone
principale deviendrait vide.

A ne pas confondre avec `preload: false`, qui repousse seulement le **premier**
chargement. La veille, elle, decharge un service deja demarre, encore et encore.

## Ajouter un service

**Depuis l'app** : bouton `+` en bas de la sidebar, ou _Fichier > Nouveau
service_. Un champ de recherche propose une **cinquantaine de services connus**
(`catalog.js`) et prerremplit nom, adresse, couleur et initiales — tout reste
modifiable avant enregistrement. Pour un service absent du catalogue, ignorer la
recherche et saisir l'adresse.

Le service obtient sa **propre partition de session** des sa creation, donc une
session etanche : c'est ce qui permet d'ajouter un quatrieme WhatsApp sur un
quatrieme numero.

### Les vignettes du catalogue

Ce sont les **vrais logos** — Telegram, Discord, Gmail — pas des pastilles
d'initiales. Ils ne sont simplement pas embarques dans l'app : ils seraient
figes, alors que les marques changent (Twitter est devenu X, Slack a change de
marque). Ils sont recuperes depuis le site de chaque service, mis en cache sur
disque, et rafraichis **une fois par mois**.

Pour chaque domaine, plusieurs candidats sont essayes dans l'ordre :
`apple-touch-icon.png` (generalement 180px, present sur la plupart des sites
modernes), le service d'icones de DuckDuckGo, puis `favicon.ico` — et enfin les
memes sur le domaine racine, car beaucoup de services vivent sur un sous-domaine
applicatif qui n'expose rien (`app.intercom.com`, `web.skype.com`). Le premier
qui atteint 128px l'emporte, sinon le plus grand.

Piege reel rencontre la : une application monopage renvoie son `index.html` en
**200** sur n'importe quel chemin inconnu. `/apple-touch-icon.png` retourne donc
une page complete, que le detecteur de format prenait pour du SVG — donc pour la
meilleure candidate de toutes. Cinq services affichaient une image cassee. Le
detecteur distingue maintenant `<svg` de `<!doctype html>`.

Le prechargement demarre **8 secondes apres le lancement**, une fois les services
en route. C'est deliberе : une grille qui se remplit sous les yeux de
l'utilisateur fait aussi pauvre que pas de logo du tout, donc tout doit etre en
cache avant qu'il n'ouvre le formulaire. Un cache frais ne declenche aucune
requete au demarrage suivant.

Cache dans `%APPDATA%\Nexus\catalog-icons.json`. Les echecs sont memorises comme
tels, pour ne pas retenter cinquante-sept domaines a chaque lancement.

Deux reductions avant stockage, sans quoi le cache depasse le megaoctet et
transite en entier vers le renderer a chaque demarrage :

- un `.ico` est un **conteneur** qui embarque la meme icone en 16, 32, 48, 128 et
  256px. On n'en affiche qu'une : `readIco` lit la table des matieres et ne garde
  que la plus grande frame, quand elle est deja en PNG ;
- les bitmaps au-dela de 192px sont ramenes a 128, largement assez pour un
  affichage a 44px.

Si un service ajoute affiche "navigateur non supporte", cocher **Se faire passer
pour Chrome** dans son formulaire. Seul WhatsApp est marque comme tel dans le
catalogue a ce jour ; les contributions sont bienvenues.

Clic droit sur une icone > _Modifier_ pour rouvrir le formulaire, _Supprimer_
pour la retirer (avec une case a cocher pour effacer aussi les donnees de session).

`services.js` n'est plus la configuration active : c'est une **semence**, copiee
dans `config.json` au premier lancement. Le modifier n'a d'effet que sur une
installation neuve. Pour ajouter un service par le code :

```js
{
  id: 'slack-boulot',                // unique, sert de cle IPC et de persistance
  name: 'Slack Boulot',
  url: 'https://app.slack.com/client',
  partition: 'persist:slack-boulot', // "persist:" obligatoire pour garder la session
  color: '#4A154B',
  initials: 'SB',
  // spoofUserAgent: true,           // seulement si le service refuse Electron
  // preload: false,                 // charger au premier clic plutot qu'au demarrage
  // hibernateAfter: 30,             // minutes d'inactivite avant veille (0 = jamais)
}
```

Rien d'autre a toucher : la sidebar, les raccourcis et le menu tray se
construisent depuis cette liste.

Pour **retirer** un service, utiliser l'app. Ses donnees de session restent sur
disque dans `%APPDATA%\Nexus\Partitions\<partition>` sauf si tu coches la case
d'effacement — sinon, a supprimer a la main.

## Identite visuelle

Les sources de la marque vivent dans `handoff/` (master vectoriel, rendus PNG,
habillage de l'installeur, declinaisons du logo). Les fichiers consommes par le
build sont derives dans `assets/` :

```bash
# assets/icon.ico — l'ordre compte : les frames 16, 32 et 48 sont des dessins
# retravaillés, pas des reductions. Sans elles Windows reduit la 256 et le
# travail sur les petites tailles est perdu.
magick handoff/icon/nexus-16.png handoff/icon/nexus-32.png handoff/icon/nexus-48.png \
       handoff/icon/nexus-64.png handoff/icon/nexus-128.png handoff/icon/nexus-256.png \
       assets/icon.ico

# habillage NSIS — BMP3 force le 24 bits sans canal alpha, seul dialecte lu par NSIS
for f in installerSidebar uninstallerSidebar installerHeader; do
  magick handoff/installer/$f.png BMP3:assets/$f.bmp
done
```

electron-builder detecte ces trois BMP par leur nom dans `buildResources`
(`assets/`), sans configuration. Ils sont exclus du paquet (`!assets/*.bmp`) :
ils servent au moment du build, pas a l'execution.

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
la ou deux services peuvent etre indiscernables : plusieurs comptes d'un meme
service partagent forcement la meme favicon. Des que tu choisis une icone
toi-meme, elle disparait. Pour la supprimer partout, retirer la regle
`.service.has-icon.auto-icon .chip` dans `renderer/style.css`.

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

## Troubleshooting

### Les infobulles de la sidebar

Ce sont des infobulles **natives** (attribut `title`), pas du HTML. Une infobulle
dessinee par la sidebar resterait invisible : la `WebContentsView` du service est
une couche native posee au-dessus de la page, donc rien de ce que peint le
renderer ne peut deborder par-dessus. Elle serait tronquee aux 68px de la
sidebar. Meme limite pour tout ce qui voudrait s'afficher par-dessus un service —
d'ou la vue escamotee pendant l'affichage du formulaire.

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
`Ctrl+Shift+I` ouvre les DevTools de la vue pour voir l'erreur reelle.

### Plusieurs comptes du meme service se deconnectent mutuellement

Chaque service doit avoir une `partition` **differente**, prefixee `persist:`.
Deux services qui partagent une partition partagent cookies et localStorage, donc
la session. Les services crees depuis l'app obtiennent la leur automatiquement ;
le cas ne se presente qu'en editant `config.json` a la main.

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

## Tester sans toucher a l'installation

Version de dev et version installee partagent `%APPDATA%\Nexus` : le verrou
d'instance unique empeche donc de lancer les deux, et un test en dev touche tes
vraies sessions. Pour travailler sur un profil jetable :

```bash
npx electron . --user-data-dir="%TEMP%\nexus-test"
```

Profil vide, verrou distinct, sessions reelles intactes. C'est aussi la seule
facon de verifier un comportement de premier lancement (la semence des services,
par exemple) sans repartir de zero sur ta vraie configuration.

## Ce que Nexus sait faire

- **Sessions etanches** — une partition par service, donc plusieurs comptes du
  meme service connectes en parallele.
- **Services editables depuis l'app** — creation, edition, suppression,
  reordonnancement par glisser-deposer, avec un catalogue d'une cinquantaine de
  services connus pour eviter d'aller chercher les URLs.
- **Notifications Windows natives**, coupables service par service — y compris
  le son joue par la page, que l'API de notification ne controle pas.
- **Compteurs de non-lus** sur l'icone de la sidebar, la barre des taches et le
  tray, lus dans le titre des pages.
- **Icones** : la tienne, sinon la meilleure favicon du site, sinon les
  initiales.
- **Mise en veille** manuelle ou automatique, pour rendre la memoire d'un
  service qu'on ne consulte plus.
- **Tray, raccourcis clavier, close-to-tray**, geometrie de fenetre persistee.
- **Mises a jour automatiques** via GitHub Releases.

Ce qui n'existe pas : macOS et Linux (le code est proche mais rien n'est teste),
la signature de code, et toute forme de synchronisation entre machines.

## Limites connues

- Le compteur de non-lus vaut ce que le service publie dans son titre — WhatsApp
  y met un nombre de **conversations**, pas de messages.
- Un service en veille ne notifie plus tant qu'il n'est pas reveille.
- Couper les notifications d'un service coupe aussi son audio, donc le son de ses
  appels.
- L'installeur n'est pas signe : SmartScreen affiche un avertissement au premier
  lancement.

## Note sur electron-store

La version pinnee est `8.2.0`, derniere version **CommonJS** du paquet.
`electron-store` >= 10 est ESM-only, ce qui obligerait a passer tout le projet en
ESM (ou a des `await import()` dans `main.js`) — inutile ici.
