# Positionnement et SEO — état du marché

Relevé du 8 août 2026. Sources vérifiables listées en fin de document.

## Résumé

Le créneau « messenger » est jouable, mais pas pour la raison qu'on croit. Les
concurrents ne sont pas absents : ils sont soit partis vers un autre vocabulaire
(navigateur / workspace / productivité, payant, B2B), soit en dette technique.

L'angle le plus solide pour Nexus n'est pas « j'agrège des messageries » — c'est
une commodité que six produits offrent déjà — mais **« ça marche encore le mois
prochain »**. La fraîcheur du moteur Chromium est en train de devenir un critère
de choix visible par l'utilisateur final, et c'est mesurable.

## 1. L'état réel des concurrents

| Produit | Dernière version stable | Moteur | Statut |
| --- | --- | --- | --- |
| **Ferdium** | v7.1.2 — 19/04/2026 | Electron 37.6 → **Chromium 138** | Actif mais lent : nightlies quotidiennes, 11 stables au total, 767 tickets ouverts |
| **Franz 5** (OSS) | v5.11.0 — 09/04/2025 | — | Gelé. Le dépôt porte une « legacy notice » depuis juin 2026 |
| **Franz 6** | — | — | Commercial, abonnement, IA cross-canal, Signal natif. Vivant et financé |
| **Rambox CE** | 0.8.0 — 21/04/2022 | — | **Dépôt archivé.** Rambox est passé propriétaire/payant |
| **Wavebox** | — | Chromium complet | Vivant, ~16 $/mois, cible équipes |
| **Shift** | — | Chromium | Vivant, payant, repositionné « navigateur modulaire » |
| **All-in-One Messenger** | — | — | Gratuit, 40+ services, maintenance peu visible |
| **Nexus** | 1.0.0 | Electron 43.3 → **Chromium 150** | — |

### Correction importante sur Ferdium

Ferdium **n'est pas un projet mort**, et l'affirmer publiquement serait
factuellement faux et facile à réfuter : il y a des commits tous les jours, des
nightlies automatiques, des traductions Crowdin qui rentrent, de nouveaux
contributeurs ce mois-ci.

Ce qui est vrai, et vérifiable, c'est autre chose :

- **Deux versions stables par an au mieux** — v7.1.2 (avril 2026), v7.1.1
  (octobre 2025), v7.1.0 (mai 2025). L'utilisateur lambda, qui installe une
  stable, attend six mois entre deux corrections.
- **767 tickets ouverts**, et les plus récents sont tous du même genre : « les
  notifications Google Messages persistent après désactivation », « WhatsApp
  affiche une erreur de base de données », « Zulip plante sur le compteur de
  non-lus », « connexion Twitter restreinte ».
- **Le moteur a un an et demi de retard** : Electron 37 / Chromium 138, aussi
  bien sur la stable que sur la branche de développement.

C'est exactement le vécu décrit — « trop de bugs et d'incompatibilités » — mais
la formulation honnête est bien plus solide en communication que « projet
mort ». On attaque sur des faits datés, pas sur un jugement que leur communauté
démontera en un commentaire.

## 2. La fenêtre Slack — le fait le plus actionnable du dossier

Slack applique une politique de dépréciation semestrielle. Prochaine échéance :

> **Chrome/Chromium 142 et antérieurs : fin de support le 9 novembre 2026.**
> Passé cette date, les navigateurs concernés sont *bloqués* — impossible de se
> connecter, de créer un espace de travail ou de gérer les réglages.

Conséquences directes :

- **Ferdium tourne sur Chromium 138.** Slack y sera bloqué le 9 novembre 2026
  s'ils ne montent pas Electron d'ici là. Le ticket est ouvert chez eux depuis
  le 6 août 2026 (ferdium-app#2465). Techniquement c'est faisable ; leur cadence
  de publication de stables rend le calendrier tendu.
- **Nexus tourne sur Chromium 150**, soit huit versions au-dessus du seuil.

À manier avec lucidité : c'est **une fenêtre de trois mois, pas un avantage
durable**. Ferdium peut publier un bump d'Electron. Mais la fenêtre révèle une
dynamique de fond qui, elle, est durable : les services web déprécient les vieux
moteurs deux fois par an, et un agrégateur qui ne suit pas Electron perd ses
services un par un. La maintenance du moteur *est* le produit.

**Recommandation produit :** en faire une politique explicite et affichée —
Nexus suit la ligne stable d'Electron, avec un délai maximal annoncé. C'est un
engagement qu'aucun concurrent gratuit ne tient aujourd'hui, et c'est vérifiable
par n'importe qui.

## 3. Ce que ça change pour le positionnement « messenger »

Le mot est effectivement disponible dans le haut du marché :

- **Rambox** : « Browsers are for browsing, Rambox is for working » → productivité
- **Wavebox** : « The #1 browser for multi-client sign-in » → navigateur pro
- **Shift** : « Reimagine your browser » → navigateur modulaire
- **WebCatalog** : « A home for your apps and accounts » → apps web

Aucun ne dit plus « messenger ». Restent sur ce terrain : Franz (payant),
All-in-One Messenger (gratuit, peu actif) et quelques apps du Microsoft Store.

Le positionnement disponible se résume à quatre attributs qu'aucun concurrent ne
cumule : **gratuit + à jour + Windows natif + sessions réellement isolées**.

Le message ne devrait pas insister sur le nombre de services intégrés (Franz en
annonce 75+, WebCatalog 50 000 — bataille perdue d'avance et sans intérêt) mais
sur les deux problèmes concrets du README : la surcharge d'onglets et,
surtout, **plusieurs comptes du même service en parallèle**. C'est ce second
point qui est à la fois différenciant et fortement recherché.

## 4. Plan SEO par ordre de priorité

### Cluster 1 — Multi-comptes, intention transactionnelle *(priorité haute)*

« plusieurs comptes WhatsApp sur PC », « two WhatsApp accounts on one computer »,
« multiple Discord accounts desktop ». C'est le trafic le plus qualifié : la
personne a le problème que Nexus résout exactement, et elle cherche un outil.

Occupé par : SingleSpace (mono-service), One Messenger Hub, un article de blog
Rambox, GoLogin (navigateur anti-détection, hors sujet mais bien classé), et des
blogs génériques. Aucun titulaire n'est imprenable.

### Cluster 2 — Alternatives et comparatifs *(priorité haute)*

« Ferdium alternative », « Rambox alternative free », « Franz alternative ».
Franz industrialise déjà des pages `/vs/rambox`, `/vs/ferdium`, `/vs/shift`,
`/vs/station`, `/vs/beeper`, plus une page « alternatives ».

Deux remarques :

1. Sur ces requêtes, les annuaires tiers — AlternativeTo, Slashdot, SourceForge,
   SaaSHub — occupent le haut des résultats. **Être référencé chez eux pèse plus
   qu'écrire ses propres pages comparatives**, surtout pour un nouveau domaine
   sans historique.
2. Sur les pages comparatives maison, s'en tenir aux faits datés et vérifiables
   de la section 1. Une comparaison honnête qui reconnaît les forces de l'autre
   est plus crédible et vieillit mieux.

### Cluster 3 — Dépannage, longue traîne *(à fort potentiel, peu exploité)*

« WhatsApp not working in Ferdium », « Slack blocked unsupported browser »,
« Ferdium Slack stopped working ». Intention brûlante : l'outil de la personne
vient de casser, elle cherche une solution immédiate.

Ce cluster va **grossir mécaniquement autour du 9 novembre 2026**. Une page de
dépannage honnête, publiée en amont, expliquant la dépréciation Slack et
comment vérifier la version de Chromium de son agrégateur, se positionnerait
avant la vague.

### Cluster 4 — Français et espagnol *(gain le plus rapide)*

Le SERP francophone sur « plusieurs comptes WhatsApp PC » ne contient que des
blogs traduits automatiquement et du contenu générique. Nexus est déjà localisé
FR/ES : c'est nettement moins disputé qu'un affrontement frontal en anglais.

### Ce sur quoi ne pas se battre

« productivity browser », « workspace », « team collaboration » — défendus par
des produits financés, avec des années de contenu et de backlinks, et un
utilisateur cible qui n'est pas celui de Nexus.

## 5. Au-delà du SEO

Pour un produit gratuit sans historique de domaine, les canaux qui comptent en
premier ne sont pas les pages de destination :

- Fiches sur AlternativeTo, Slashdot, SourceForge, SaaSHub (c'est ce qui ressort
  sur les requêtes « alternatives »)
- Présence Microsoft Store — plusieurs concurrents de ce marché y captent une
  part notable de leurs installations
- Le README GitHub lui-même : c'est une page indexée, et pour un projet open
  source c'est souvent le premier résultat sur la marque

## Limites de ce rapport

Les données produit, versions et dates sont vérifiées auprès des sources
primaires (API GitHub, documentation Slack, pages des éditeurs) et sont
fiables au 8 août 2026.

L'analyse SEO, en revanche, repose sur la lecture des pages concurrentes et des
résultats de recherche — **pas sur des volumes de recherche ni des difficultés
de mot-clé mesurés**. Les priorités de la section 4 sont donc un raisonnement
sur l'intention, pas un arbitrage chiffré. Pour chiffrer, il faut une source de
volumétrie (Keyword Planner, Ahrefs, Semrush ou DataForSEO) ; une API de SERP
seule ne les fournit pas.

## Sources

- API GitHub : `ferdium/ferdium-app`, `meetfranz/franz`, `ramboxapp/community-edition`
- [ferdium-app#2465 — Slack wants Chromium 143 or higher](https://github.com/ferdium/ferdium-app/issues/2465)
- [Slack — support lifecycle for browsers](https://slack.com/help/articles/1500001836081-Slack-support-lifecycle-for-operating-systems-app-versions-and-browsers)
- [Electron releases](https://releases.electronjs.org/releases.json)
- Pages éditeurs : [Rambox](https://rambox.app/), [Ferdium](https://ferdium.org/),
  [Franz](https://meetfranz.com/), [Wavebox](https://wavebox.io/),
  [Shift](https://shift.com/), [WebCatalog](https://webcatalog.io/),
  [All-in-One Messenger](https://allinone.im/)
- [Franz — all-in-one messenger alternatives](https://meetfranz.com/all-in-one-messenger-alternatives)
