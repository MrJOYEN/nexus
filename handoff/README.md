# Nexus — pack d'icônes

Tout est prêt à consommer. Deux conversions restent à faire côté machine (`.ico`, `.bmp`),
les commandes sont en bas.

---

## 1. Icône applicative

`icon/`

| Fichier | Rôle |
| --- | --- |
| `nexus-icon.svg` | **Master vectoriel.** Géométrie de référence. Tout le reste en dérive. |
| `nexus-icon-32.svg` | Dessin retravaillé pour 32 px. |
| `nexus-icon-16.svg` | Dessin retravaillé pour 16 px. |
| `nexus-1024.png` | **Le minimum vital** — carré, fond transparent. |
| `nexus-512.png` `nexus-256.png` `nexus-128.png` `nexus-64.png` | Rendus du master. |
| `nexus-48.png` `nexus-32.png` `nexus-16.png` | Rendus des **dessins retravaillés**, pas des réductions. |

Plaque violette `#8063F6`, blocs blancs, rayon 22 %, coins transparents.

### Les trois dessins ne sont pas trois réductions

Ce qui change entre eux, c'est la marge extérieure et la largeur des saignées — jamais le
nombre de blocs :

- **48 px et au-dessus** — géométrie de référence, marge 12,2 %.
- **32 px** — marge réduite, blocs grossis de 7,5 % puis rétractés sur eux-mêmes : les
  gouttières gagnent ce que la marge perd.
- **16 px** — même traitement poussé plus loin, gouttières à ≈1,8 px réels.

**Les quatre blocs sont conservés partout, y compris à 16 px.** En supprimer un pour gagner
de la place reviendrait à livrer un autre logo.

### Les contraintes, et comment elles sont traitées

- **Lisible à 16 px** — quatre aplats blancs massifs sur un aplat saturé, aucun trait fin,
  aucun texte. Les saignées sont ouvertes exprès pour cette taille.
- **Coin bas-droit recouvert** — la pastille de compteur mange le bas du bloc violet. C'est
  le bloc le plus large, et les trois coupes qui portent l'identité (deux diagonales raides,
  une douce) sont toutes hors zone.
- **Fond clair et sombre** — plaque violette plutôt que glyphe transparent. Ni fond blanc
  (tuile vide sur thème clair), ni glyphe sombre (invisible sur thème sombre).
- **Coins transparents** — 4,1 % du PNG 1024 est totalement transparent : jamais de
  rectangle autour de la tuile.

### À générer : `assets/icon.ico`

```bash
magick icon/nexus-16.png icon/nexus-32.png icon/nexus-48.png \
       icon/nexus-64.png icon/nexus-128.png icon/nexus-256.png \
       assets/icon.ico
```

L'ordre compte. Les frames 16, 32 et 48 sont les dessins retravaillés — sans elles Windows
réduit la 256 et tout le travail ci-dessus est perdu.

---

## 2. Icônes de service

`services/` — six pastilles d'initiales, PNG 128×128, fond transparent, aux couleurs de
`services.js`.

| Fichier | Service | Couleur |
| --- | --- | --- |
| `wa-perso-128.png` | WhatsApp Perso · W1 | `#25D366` |
| `wa-boulot-128.png` | WhatsApp Boulot · W2 | `#25D366` |
| `wa-asso-128.png` | WhatsApp Asso · W3 | `#25D366` |
| `dc-perso-128.png` | Discord Perso · D1 | `#5865F2` |
| `dc-dev-128.png` | Discord Dev · D2 | `#5865F2` |
| `gcal-128.png` | Google Agenda · GA | `#1A73E8` |

Déposer dans `assets/icons/`, puis déclarer sur le service :

```js
{ id: 'wa-perso', /* … */ icon: 'wa-perso-128.png' }
```

**Piège de format :** PNG ou JPEG uniquement. `nativeImage` ne décode ni SVG ni WebP depuis
un fichier local — un SVG serait silencieusement rejeté et retomberait sur les initiales.

Ces pastilles sont des **repères, pas des logos** : elles servent à verrouiller une config
reproductible, là où le favicon ne distingue pas trois WhatsApp.

---

## 3. Habillage de l'installeur

`installer/` — aux dimensions exactes, livrés en **PNG**.

| Fichier | Taille | Usage |
| --- | --- | --- |
| `installerSidebar.png` | 164×314 | bandeau latéral de l'installeur |
| `uninstallerSidebar.png` | 164×314 | idem, désinstalleur |
| `installerHeader.png` | 150×57 | bandeau haut des pages suivantes |

Le bandeau haut est sur fond blanc : c'est la couleur de page par défaut de NSIS, un fond
sombre y ferait une vignette flottante.

### À convertir en BMP

```bash
for f in installerSidebar uninstallerSidebar installerHeader; do
  magick installer/$f.png BMP3:assets/$f.bmp
done
```

`BMP3:` force le BMP 24 bits sans canal alpha — le seul dialecte que NSIS lit sans broncher.

---

## 4. Marque (hors icône applicative)

`logo/`

| Fichier | Usage |
| --- | --- |
| `nexus-mark.svg` | marque nue, blocs clairs — sur chrome sombre |
| `nexus-mark-ink.svg` | marque nue, blocs encre — sur fond clair |
| `nexus-mark-mono.svg` | `currentColor`, un seul ton |
| `nexus-app-icon.svg` | marque sur plaque blanche — documents, pas la barre des tâches |
| `nexus-lockup.svg` / `-ink.svg` | marque + logotype Archivo SemiBold |
| `nexus-master-1024.png` | le fichier d'origine, tel que fourni |

Le `<text>` des lockups est du texte vivant : **vectoriser avant toute diffusion externe**.

Zone de respiration = 0,12 × la hauteur de la marque. Taille minimale : 16 px avec plaque,
20 px sans. Le bloc violet reste en bas à droite. Interdits : rotation, contour, ombre
portée, dégradé, recoloration des blocs par service.

---

## Repères de couleur

```
violet marque   #8063F6
encre bloc      #1A202C
texte clair     #E8EBF2
rouge non-lu    #F2555A
```
