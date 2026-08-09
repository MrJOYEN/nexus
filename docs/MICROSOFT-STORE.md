# Publication sur le Microsoft Store

Nexus part sur le Store en MSIX, et pas avec l'installeur EXE : Microsoft
resigne les paquets MSIX apres certification, donc aucun certificat a acheter.
Un EXE, lui, doit arriver deja signe par une autorite reconnue — quelques
centaines d'euros par an, avec jeton materiel.

Les deux canaux coexistent et ne se croisent jamais :

| Canal | Commande | Artefact | Mise a jour |
|---|---|---|---|
| GitHub Releases | `npm run release` | `Nexus-Setup-<version>.exe` | electron-updater |
| Microsoft Store | `npm run build:store` | `Nexus-<version>-store.msix` | le Store |

`npm run build:store` passe `appx` en cible sur la ligne de commande, ce qui
prime sur `win.target`, et `--publish never` pour qu'aucun artefact Store ne
parte vers GitHub. La cible `nsis` n'est pas touchee.

## Identite du paquet

Relevee dans Partner Center (Product management > Product identity) et recopiee
dans `build.appx` de `package.json`. Ces valeurs ne s'inventent pas et ne se
modifient plus une fois le produit publie.

| Champ | Valeur |
|---|---|
| `Package/Identity/Name` | `MehdiJoyen.NexusMessenger` |
| `Package/Identity/Publisher` | `CN=3AEA6691-12A7-4EC5-B304-754AC77D0730` |
| `Package/Properties/PublisherDisplayName` | `Mehdi Joyen` |
| Package Family Name | `MehdiJoyen.NexusMessenger_6sysvkg83wmrg` |
| Store ID | `9PBW3G2B60J6` |

## Ce que le paquet change dans le code

Tout passe par un seul drapeau, `isStore` dans `main.js`, qui lit
`process.windowsStore` : Electron le leve quand le process tourne depuis un
paquet MSIX. Rien n'est decide au build, le meme code sert aux deux canaux.

### Notifications — l'identite Windows

Un paquet MSIX impose son AUMID, `<PackageFamilyName>!<ApplicationId>`, soit
`MehdiJoyen.NexusMessenger_6sysvkg83wmrg!Nexus`. `app.setAppUserModelId()` n'est
donc plus appele dans le paquet : la valeur historique `com.mehdi.nexus` ferait
emettre les toasts sous une identite que Windows n'associe a aucun paquet
installe. Ils cesseraient de s'afficher, sans erreur, sans trace dans les logs.

C'est la fonction phare du produit : c'est le premier test a faire.

### Mises a jour — electron-updater desactive

Le Store distribue les mises a jour, et une application empaquetee ne peut pas
reecrire son propre paquet : le dossier d'installation est en lecture seule.
Dans le paquet, `require('electron-updater')` n'a jamais lieu, l'entree de menu
« Rechercher des mises a jour » devient « Voir dans le Microsoft Store », et ni
la pastille de la sidebar ni l'entree du tray n'apparaissent — elles dependent
de `pendingUpdate`, qui reste nul.

### Lancement au demarrage — StartupTask

`app.setLoginItemSettings()` ecrit sous `HKCU\...\Run`. Ce registre est
virtualise vers le conteneur du paquet, que Windows ne lit pas a l'ouverture de
session : l'appel reussit, le reglage est memorise, et rien ne demarre jamais.

C'est l'extension `windows.startupTask` de `installer/appx-extensions.xml` qui
fait foi. Elle est declaree `Enabled="false"` : l'activer par programme demande
l'API WinRT `StartupTask`, hors de portee d'Electron sans module natif. Le menu
Fichier ouvre donc directement Parametres > Applications > Demarrage.

**Ecart fonctionnel assume** : l'option « demarrer masque dans la zone de
notification » n'existe pas dans le paquet Store. Une entree StartupTask lance
l'executable sans argument, donc `--hidden` n'arrive jamais, et rien ne permet
de distinguer un lancement a l'ouverture de session d'un lancement manuel.
Honorer le reglage dans tous les cas masquerait aussi la fenetre quand
l'utilisateur ouvre Nexus depuis le menu Demarrer.

### Donnees — pas de virtualisation, et profil partage

Aucune ecriture hors du dossier de donnees : `electron-store` pour la config,
`catalog-icons.json` pour le cache d'icones, et les partitions `persist:<id>`
qui portent les sessions isolees. Tout vit sous `app.getPath('userData')`.

**Mesure faite sur le paquet installe** : `%APPDATA%` n'est pas redirige. Depuis
Windows 10 1903, les paquets `runFullTrust` ecrivent dans le vrai
`%APPDATA%\Nexus`, pas dans `LocalCache\Roaming` du conteneur — ce dernier reste
vide. Deux consequences, opposees :

- **La migration depuis l'EXE est automatique et totale.** La version Store
  ouvre le profil existant tel quel : services, ordre, sessions connectees. Rien
  a ecrire pour la prendre en charge.
- **Les deux versions partagent un seul profil.** Elles ne doivent donc jamais
  tourner en meme temps : deux instances Electron sur les memes bases LevelDB
  et les memes partitions de session, c'est de la corruption de donnees.

### Coexistence avec la version EXE

Le verrou de `app.requestSingleInstanceLock()` derive du chemin de `userData`,
identique pour les deux versions. Si la version NSIS tourne — son etat normal,
elle reside dans la zone de notification — le lancement du paquet Store ne
demarre rien : il reveille la fenetre de l'autre et s'arrete. Aucune erreur,
aucun log, l'utilisateur croit le paquet casse.

Ce comportement protege les donnees, et il ne se contourne pas proprement :
l'instance qui arrive ne peut pas savoir quelle version detient le verrou, et
afficher un avertissement a chaque echec casserait le cas normal ou l'on relance
l'app deja ouverte pour la remettre au premier plan.

**La regle est donc de ne pas les faire coexister** : desinstaller la version
EXE en passant au Store. Le profil etant partage, la bascule est transparente.
A rappeler dans la description de la fiche Store.

## Test local (sideload)

Le paquet produit n'est pas signe, et c'est voulu : le Store resigne apres
certification. Mais Windows refuse d'installer un MSIX non signe, d'ou un
certificat auto-signe pour le test seul.

```powershell
npm run build:store
.\installer\sideload-msix.ps1        # emet le certificat et signe une copie
```

Le script signe `Nexus-<version>-sideload.msix` et laisse
`Nexus-<version>-store.msix` intact : c'est ce dernier qu'on televerse.

Les deux dernieres etapes demandent une console **administrateur** :

```powershell
Import-Certificate -FilePath .\dist\nexus-sideload.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Add-AppxPackage -Path .\dist\Nexus-1.0.0-sideload.msix
```

C'est bien le `.cer` qu'on importe, jamais le `.pfx` : faire confiance a une
signature ne demande que la partie publique. Le `.pfx` porte la cle privee et
ne sert qu'a signer.

Le sujet du certificat doit correspondre au caractere pres au `Publisher` du
manifeste. Sinon l'installation echoue sur `0x800B0109`, un message qui ne
nomme jamais la vraie cause.

Pour desinstaller :

```powershell
Get-AppxPackage -Name MehdiJoyen.NexusMessenger | Remove-AppxPackage
```

## A verifier avant de soumettre

Dans cet ordre — les deux premiers sont ceux qui cassent silencieusement.

1. **Notifications.** Ouvrir un service, declencher un message entrant. Le toast
   doit s'afficher et porter « Nexus Messenger ». Verifier que l'AUMID vu par
   Windows est bien `MehdiJoyen.NexusMessenger_6sysvkg83wmrg!Nexus` :
   `(Get-AppxPackage -Name MehdiJoyen.NexusMessenger).PackageFamilyName`
2. **Sessions isolees.** Se connecter a deux comptes du meme service, fermer
   l'app, **redemarrer la machine**, rouvrir : les deux sessions doivent etre
   encore ouvertes et toujours distinctes. C'est le coeur du produit et le point
   que la virtualisation du systeme de fichiers peut casser.
3. **Lancement au demarrage.** Parametres > Applications > Demarrage : « Nexus »
   doit apparaitre. L'activer, redemarrer, verifier que Nexus se lance.
4. **Zone de notification.** Icone presente, fermeture de la fenetre qui replie
   dans le tray, menu contextuel operationnel.
5. **Migration depuis la version EXE.** Verifiee sur Windows 11 26100 : le
   paquet reprend le profil existant sans rien faire, `%APPDATA%` n'etant pas
   virtualise. Penser a desinstaller la version EXE au prealable, sinon son
   verrou d'instance empeche le paquet de demarrer (voir plus haut).

## Etat des verifications

Fait et mesure sur le paquet installe en sideload :

- Identite enregistree par Windows :
  `MehdiJoyen.NexusMessenger_6sysvkg83wmrg!Nexus`, conforme au manifeste.
- `NexusStartup` enregistre avec `State = 0` : declare, desactive, activable
  par l'utilisateur.
- Le paquet demarre et reprend le profil existant.
- Aucune ecriture hors du dossier de donnees.

Reste a valider a la main, faute de pouvoir l'automatiser :

- Affichage d'un toast sur message entrant (la fonction phare).
- Icone et repli dans la zone de notification.
- Activation du demarrage automatique puis redemarrage.
- Persistance des sessions isolees apres redemarrage.
