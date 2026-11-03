# Phase 3 — moteur d’audit digital

## Référence et analyse préalable

Dépôt et cible exclusifs : `OmniDigital-fr/CRM_GPT` et `crm2.omnidigital.fr`. Base analysée : **44a8b52d4ed01780ec7a34be83f6c512383b5ac8**, incluant les entreprises/contacts, le pipeline, le logo officiel et le Kanban en cinq colonnes. Branche : `feature/digital-audit-engine`. Aucun merge ou déploiement sans accord explicite. Le CRM ancien n’est ni consulté ni modifié.

Architecture réutilisée : Node 22.16+, Express 5, SQLite natif, HTML/JS/CSS sans compilation, authentification Basic, contrôles d’origine et réponses de sécurité. `site-audit.js` contenait déjà `siteUrl`, `resolvePublic`, un transport HTTP/TLS avec épinglage DNS, un plafond de 2 Mo et un audit HTML/PageSpeed mobile. Les entreprises disposent déjà d’une table `audits`; les contacts gardent des projections `prospects` avec leur historique `site_audits`. Ces structures et leurs résultats sont conservés.

Différences corrigées par cette phase : audit principal jusque-là orienté contact, pas de desktop/CrUX détaillé, pas de file d’attente, de comparaison professionnelle ni de véritable export PDF. Le nouveau moteur est rattaché à la société et réutilise le transport protégé ; l’ancienne vue Audit du site et ses APIs restent disponibles. Le budget PageSpeed et la concurrence sont partagés avec les anciennes routes d’audit.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `site-audit.js` | Transport existant enrichi : en-têtes sélectionnés, résolution publique, redirections tracées, budget partagé de requêtes, délai DNS inclus dans le délai global. |
| `digital-audit.js` | Extraction HTML bornée, contrôles détaillés, PSI mobile/desktop, classement, pistes commerciales, comparaison. Aucun JavaScript distant exécuté. |
| `audit-engine-server.js` | File locale, états persistés, budgets de fréquence, snapshots, APIs et génération à la demande des PDF. |
| `audit-report.js` | PDF réel en mémoire avec PDFKit, polices embarquées, pagination et deux niveaux de lecture. |
| `static/digital-audit-ui.js` | Sélection société/URL, suivi de l’exécution, catégories, preuves, mesures, historique, comparaison et téléchargement PDF authentifié. |

`crm-server.js` initialise et monte le module après l’authentification ; `entities.js` conserve les anciens audits tout en partageant les limites ; navigation/styles/fiches société enrichis sans changer les coordonnées, tâches ou opportunités. PDFKit 0.17.2 est la seule dépendance de production ajoutée ; les sous-ensembles DejaVu Sans, avec licence, sont inclus dans `assets/` pour éviter une dépendance aux polices installées sur Hostinger. Aucun binaire Chrome, Python ou LibreOffice requis en production.

## Données et états

Réutilisation de `audits(id, company_id, contact_id, payload, source, created_at)` : chaque exécution terminée par le moteur produit un **nouvel identifiant**, `contact_id=NULL`, `source='Moteur digital v3'`, avec un payload versionné. Rien n’écrase les snapshots précédents, y compris les anciens formats.

Nouvelles tables :

- `digital_audit_jobs` : id, company_id, requested_url, state, progress, audit_id, error, created_at, started_at, finished_at.
- `digital_psi_usage` : identifiant et date de tentative d’appel Google, sans URL contenant la clé ni secret.

États : `queued`, `running`, `completed`, `partial`, `failed`, `interrupted`. L’API de lancement répond 202 ; le navigateur consulte l’état toutes les deux secondes tant que la vue reste ouverte. Un arrêt propre attend l’analyse active et marque les demandes encore en attente comme interrompues. Au redémarrage, les demandes queued/running deviennent interrupted, sans relance automatique ou affirmation de réussite.

Un échec de lecture documenté produit un snapshot failed avec des contrôles non vérifiés. Une erreur interne imprévue produit un job failed avec message générique, sans résultat fabriqué. Les requêtes sur l’historique affichent également ces états. Les métadonnées du dernier audit de la société et les journaux société/commercial sont actualisés ; aucun email ni opportunité n’est créé.

## Périmètre HTTP et contrôles

- Page principale et jusqu’à deux pages internes Contact/Services/Prestations/Solutions, uniquement sans query string et même origine pour l’analyse de contenu.
- Un lien interne supplémentaire est testé si disponible, sans analyser son contenu comme page ; chemins d’action connus et fichiers statiques exclus. Le test n’est pas un crawl exhaustif.
- `/robots.txt`, `/sitemap.xml`, tentative de la variante HTTP pour vérifier une redirection vers HTTPS.
- Maximum **3 pages HTML analysées**, **16 requêtes HTTP**, redirections comprises, plafond **2 Mo par réponse**, échéance HTTP globale **45 secondes**.
- Une chaîne est limitée à cinq requêtes ; chaque destination de redirection est revalidée et chaque connexion résout puis épingle une adresse publique. Les ensembles DNS mixtes public/privé sont refusés.
- HTTP/HTTPS seulement, sans identifiants et sans port personnalisé ; URL limitée à 2048 caractères. Adresses locales, privées, réservées et IPv4 mappées IPv6 filtrées via `ipaddr.js`. Validation TLS maintenue.
- En-têtes conservés : HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy et X-Robots-Tag ; aucun cookie reçu n’est stocké.
- Pas de cookies/session client transmis au site, pas de soumission de formulaire, aucun JavaScript distant exécuté par le serveur CRM. Google réalise ses propres mesures sur son infrastructure quand PSI est activé.

SEO : title et longueur, description et longueur, meta robots et X-Robots-Tag, canonique, H1/H2/H3 et sauts de niveaux, sitemap, robots, Open Graph, JSON-LD, liens internes, destinations échantillonnées, alt, lang, volume de texte HTML. Les longueurs sont des repères éditoriaux et non des règles de classement. Le volume de texte n’évalue pas sa pertinence sémantique. Une canonique présente ou un JSON-LD reconnu ne sont pas automatiquement valides pour Google.

Mobile : viewport et diagnostics Lighthouse disponibles, sans affirmer le rendu responsive. Menus, débordements et cibles tactiles restent à tester sur appareil réel.

Conversion : formulaires possibles, téléphone/email cliquables, textes de CTA, liens de services, indices de localisation et de confiance. La présence est un indice, pas une validation du fonctionnement ni de l’authenticité. La non-détection sur une page ne vaut pas absence sur tout le site.

Informations légales : liens possibles de mentions légales, confidentialité, cookies et signatures d’outils de consentement. Aucun examen juridique définitif et aucun verdict automatique de conformité.

## Mesures Google et méthodologie

Configuration serveur existante : **PAGESPEED_API_KEY**, saisie uniquement dans l’environnement de l’application. Aucune clé n’est exposée à l’interface, aux snapshots, aux rapports, au journal ou au dépôt.

Deux appels par analyse : mobile et desktop, quatre catégories Lighthouse (performance, accessibility, best-practices, seo), via l’API officielle `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`. Aucun redirect de l’API n’est suivi. Délai par appel 60 secondes ; réponse bornée à 8 Mo avant parsing sur le transport Fetch standard. Codes externes en erreur, JSON invalide, scores hors plage et absence de catégories produisent des mesures indisponibles, sans déduire zéro.

Laboratoire : scores, LCP, FCP, TBT, Speed Index et CLS ; nombres invalides ou manquants affichés « Non disponible ». Opportunités Lighthouse et diagnostics limités, conservés avec titre/source/description ; les diagnostics d’accessibilité et SEO identifiables sont repris dans les contrôles.

Terrain : LCP, INP et CLS du 75e percentile, d’abord à l’URL, sinon à l’origine avec étiquette explicite. CLS de l’API PSI normalisé depuis son entier en centièmes ; aucune conversion appliquée au CLS de laboratoire déjà normalisé. INP n’est jamais inventé à partir de TBT ou d’une autre valeur. Si Google cesse de renvoyer les données CrUX ou qu’un site ne dispose pas d’un échantillon suffisant, elles restent indisponibles. Le moteur ne contacte pas une seconde API CrUX de secours.

Repères des contrôles terrain : LCP bon ≤ 2500 ms et médiocre > 4000 ms ; INP bon ≤ 200 ms et médiocre > 500 ms ; CLS bon ≤ 0,1 et médiocre > 0,25. Ces repères sont distincts du score de laboratoire. Aucun verdict global de réussite Core Web Vitals si les trois valeurs nécessaires manquent ou si leurs périmètres diffèrent.

Sources de méthodologie :

- https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed
- https://developers.google.com/speed/docs/insights/v5/about
- https://developer.chrome.com/docs/crux/guides/pagespeed-insights
- https://web.dev/articles/vitals
- https://support.google.com/webmasters/answer/9205520

## Classement et pistes commerciales

Les six catégories demandées sont affichées. **Performance et Accessibilité** peuvent montrer le score Lighthouse mobile correspondant, avec une source explicite et un périmètre limité. **SEO technique, Sécurité, Expérience mobile et Conversion** restent sans note synthétique : les contrôles partiels ne justifient pas une note arbitraire. Les autres scores Google sont visibles dans l’espace Mesures Google et ne sont pas transformés en notes globales de sécurité ou de conversion.

Chaque contrôle porte un état : Erreur critique, Problème important, Amélioration recommandée, Conforme au contrôle, Non vérifié. Il précise observation (présence/absence/erreur/recommandation/non vérifiable), preuve, page, source, confiance, date et recommandation. « Conforme au contrôle » signifie seulement que ce test précis est satisfait. Par exemple, HTTPS n’est pas un certificat de sécurité du site.

Une piste commerciale conserve problème, preuve, page, conséquence possible, service, priorité commerciale, confiance et date. Le champ `hypothesis=true` reste explicite. La priorité est un repère commercial séparé de la gravité technique, pas un montant de perte ou un score IA. Les problèmes répétés sont regroupés pour éviter des listes identiques sur plusieurs pages, sans supprimer les contrôles par page. Les textes destinés au dirigeant reformulent les constats ; le détail technique reste dans l’autre rapport.

Aucune cause certaine n’est inventée à partir d’un symptôme. La comparaison signale les contrôles non réexécutés et les URL différentes. Scores et métriques ne sont soustraits que si les deux nombres sont disponibles ; une portée terrain URL versus origine rend la différence non comparable. Les différences de conditions de mesure sont rappelées.

## Charge, limites et authentification

Une analyse active au total par processus, y compris les anciennes routes ; deux demandes peuvent attendre derrière une analyse active. Le nouveau moteur accepte au plus six demandes par heure, et une minute entre deux demandes d’une même société. Le budget PageSpeed est de **12 tentatives par heure**, commun avec les audits historiques, persistant en SQLite. Les appels échoués consomment aussi une tentative ; aucune nouvelle tentative automatique. Une analyse sans budget Google conserve ses contrôles HTML et marque les mesures manquantes.

Une exportation PDF active à la fois. Les PDF sont créés en mémoire à partir de résultats bornés. L’application doit continuer de tourner en **un seul processus Node** sur le même fichier SQLite, comme la messagerie existante. Ce n’est pas un ordonnanceur distribué : ne pas activer plusieurs réplicas sans une file et un verrou partagés adaptés.

Le parcours HTTP peut prendre jusqu’à 45 s, puis les deux mesures Google jusqu’à 120 s cumulées. Le lancement répond rapidement 202 et ne reste pas bloqué derrière un proxy Hostinger pendant toute cette durée. La file n’est pas reprise automatiquement après redémarrage.

Toutes les routes du module et les PDF restent derrière l’authentification et les contrôles d’origine existants. Aucun accès public, téléchargement de source, accès aux clés ou mode de désactivation de TLS. Le HTML externe est parsé comme données et échappé à l’affichage ; il n’est pas injecté comme code dans l’interface. Les PDF ne contiennent pas de JavaScript actif ni de ressources distantes.

## APIs et interface

- POST `/api/digital-audits` : `{ company_id, url? }`, réponse 202 avec identifiant d’exécution.
- GET `/api/digital-audits/jobs/:id` : état, progression et audit_id si disponible.
- GET `/api/digital-audits?company_id=...` : audits, anciens formats inclus, et dernières exécutions.
- GET `/api/digital-audits/:id` : snapshot détaillé.
- GET `/api/digital-audits/compare?left=...&right=...` : comparaison de deux nouveaux audits d’une même société.
- GET `/api/digital-audits/:id/report.pdf?audience=commercial` ou `technical` : document PDF téléchargeable réel.

Menu **Audit digital**, sélecteur société et URL modifiable, état/progression, six catégories, synthèse, contrôles, métriques, pistes et historique/comparaison. Les anciens formats restent lisibles ; la comparaison détaillée et les PDF sont proposés pour les nouveaux audits seulement. La fiche entreprise ouvre le nouveau module depuis Audits ; les contrôles historiques liés aux contacts restent utilisables.

## Rapports PDF

Synthèse commerciale : points positifs, priorités, conséquences possibles, améliorations et limites, en français simple. Rapport technique : scores et métriques, contrôles avec preuves/pages/sources, recommandations et priorités, causes laissées à confirmer. Polices françaises embarquées, en-tête de marque et pagination. Les caractères extérieurs au jeu latin pris en charge sont remplacés par `?` pour éviter une sortie illisible.

Les deux PDF sont générés par le serveur et ont été testés par téléchargement HTTP puis parsing réel avec PDF.js, avec vérification de contenu et absence de pages contenant uniquement le pied de page. Des échantillons techniques et commerciaux ont été rendus avec Poppler et inspectés visuellement ; une correction de pagination et l’intégration de polices ont été vérifiées avant livraison du code. Ces échantillons utilisent des données simulées, pas un audit réel d’un client.

## Installation et sauvegarde

```sh
git switch feature/digital-audit-engine
npm ci
npm run build
npm test
CRM_DATA_DIR=/chemin/absolu/donnees-test npm start
```

Ne pas utiliser de base ni de configuration email de production pour les essais. Sans clé PageSpeed, le moteur fonctionne en mode HTML partiel. Avec une clé, autoriser la sortie HTTPS vers www.googleapis.com et les destinations HTTP/HTTPS publiques des sites audités. Aucun changement de variables ou de DNS effectué dans cette phase.

Lorsqu’une base existante phase 2 ne contient pas `digital_audit_jobs`, le serveur réalise d’abord un `VACUUM INTO` cohérent dans `crm.sqlite3.before-digital-audit-<date>-<uuid>.sqlite3`, permissions 0600. Les anciennes conventions before-companies et before-commercial sont préservées selon l’état de la base. Aucune sauvegarde inutile pour une base neuve, aucun remplacement des données et aucun effacement d’historique.

Après approbation de publication seulement, confirmer la cible CRM2, préserver aussi une copie externe de la base, puis publier le commit approuvé. Vérifier une création de société, un audit sans clé, un audit avec clé si disponible, les anciens dossiers, le pipeline et un PDF authentifié. En cas de retour arrière : arrêter uniquement le CRM2, conserver la base courante, restaurer le code de référence et la copie SQLite cohérente antérieure, avec permissions adaptées et sans WAL/SHM d’un autre état. Les opérations nouvelles ne sont pas reprises automatiquement dans l’ancienne copie.

## Validation et limites

- `npm ci`, `npm run build` réussis ; **66 tests Node réussis**, dont les 51 tests précédents et 15 nouveaux.
- Tests simulés : URL/SSRF/IPv6, DNS mixte, redirections et budgets, extraction SEO/conversion, PageSpeed absent/invalide/quota, distinction labo/terrain et INP manquant, historiques, comparaison, file sérialisée, redémarrage, authentification/origine, PDF réels et sauvegarde phase 2.
- Parcours DOM jsdom : société, lancement de deux audits, vues techniques/Google, historique, comparaison et téléchargement PDF, sans erreur JavaScript remontée. Aucun ajout de jsdom aux dépendances du projet.
- Inspection visuelle des PDF rendus ; l’interface web n’a pas fait l’objet d’une validation visuelle desktop/mobile réelle dans cette session.
- `npm audit --omit=dev` : zéro vulnérabilité signalée au moment du contrôle ; ce résultat n’est pas une garantie générale de sécurité.
- Aucun appel PSI réel, aucun site client réellement audité pour les tests, aucun envoi d’email, aucun accès Hostinger et aucun déploiement.

Limites : pas de navigateur de rendu, crawl exhaustif, OCR, soumission de formulaire, validation des données structurées contre tous les schémas, audit juridique, test d’intrusion ni mesure d’impact commercial. Les chemins de sitemap alternatifs et les fichiers sitemap volumineux peuvent rester non vérifiés. Les anciennes vues d’audit conservent leur ancien périmètre tout en partageant les budgets.

Prochaine étape : validation visuelle et essais sur des domaines autorisés, puis association explicite des constats aux opportunités et amélioration des diagnostics selon les retours. Recherche de sociétés, enrichissement, IA et campagnes restent hors de cette phase.
