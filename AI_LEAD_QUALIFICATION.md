# Phase 4 — Qualification commerciale explicable et assistance IA

## État et périmètre

Branche : `feature/ai-lead-qualification`, créée sur le `main` distant
`dd6c5a70404274b10e7b028bdc25cdb945753355` (dashboard réorganisé après phase 3).
Travail destiné exclusivement à CRM2. Aucun accès ni changement au CRM historique.
Le merge et le déploiement ne font pas partie de cette livraison.

L’interface est en français de France. La qualification est intégrée dans la
fiche Entreprise, onglet **Qualification IA**. Sans clé OpenAI, le CRM, les règles,
les preuves, le catalogue, les signaux, les décisions et les historiques restent
opérationnels ; seul le bouton de synthèse IA est désactivé.

## Analyse de l’existant et choix d’architecture

L’application est un serveur Node.js/Express 5 avec `node:sqlite`, sans framework
frontend. L’authentification Basic, le contrôle d’origine, les en-têtes CSP et le
stockage persistant sont déjà centralisés dans `crm-server.js`.

Les données existantes réutilisées sont :

| Source | Utilisation | Limite de fiabilité |
| --- | --- | --- |
| `companies` | Effectif, secteur, pays, présence d’un site, état commercial | Champs déclaratifs ; un champ vide ne prouve pas une absence |
| `contacts` / `prospects` | Restrictions et scénarios de réponses structurés | Aucune identité ni coordonnée envoyée à OpenAI |
| `audits` | Dernier résultat du moteur digital v3 | Contrôles indicatifs, périmètre limité, audit de moins de 90 jours pour Need |
| `opportunities` | Montants récurrents saisis et contrats signés | Un état du pipeline ne constitue pas une preuve d’intention |
| Réponses structurées `prospects` | Scénario positif, demande d’informations/devis ou refus avec détail et date | Le contenu du message n’est pas envoyé ; le scénario demeure une déclaration humaine |

Les phases 1 à 3 restent intactes. Les résultats d’audits et coordonnées ne sont
pas dupliqués dans une nouvelle fiche. Un instantané de preuves est toutefois
conservé avec chaque qualification pour qu’une analyse antérieure reste lisible
après modification de la fiche ou réalisation d’un nouvel audit.

Il n’existait aucune intégration IA dans `main`. L’intégration ajoutée utilise
l’API officielle OpenAI Responses avec `fetch` natif. Aucune nouvelle dépendance.
Les vérifications de site restent assurées par le moteur v3 ; la qualification ne
visite aucun site et n’exécute aucun JavaScript externe.

Modules :

- `qualification-rules.js` : méthode versionnée, scores, preuves et services admissibles.
- `qualification.js` : schéma SQLite, contexte, intégration OpenAI, validation,
  budgets, historique et routes authentifiées.
- `static/qualification-ui.js` : onglet Entreprise, décisions, signaux, synthèse,
  historique et édition du catalogue.
- La liste Entreprises reçoit une projection de qualification distincte des
  anciens champs manuels `priority` et `opportunity_score`.

## Méthodologie version `omni-qualification-1.0`

Il n’existe **aucune moyenne globale** des trois scores. Ils sont calculés par
le serveur, jamais attribués par le modèle. Les seuils sont des règles métier de
départ, explicites et à calibrer sur les résultats commerciaux réels. Ils ne sont
ni une prédiction statistique de vente ni une mesure d’urgence.

### Fit — adéquation

| Critère | Poids | Règle |
| --- | ---: | --- |
| Effectif | 35 | Jusqu’à 100 personnes : 100 ; effectif supérieur à 100 : 30 |
| Pays | 25 | France/FR : 100 ; autre pays renseigné : 40 |
| Secteur | 10 | Tous secteurs : 100 si renseigné, sans exclusion sectorielle |
| Présence digitale | 10 | Site renseigné : possibilité de diagnostic, valeur 100 |
| Compatibilité du besoin | 20 | Besoin confirmé récent lié à un service actif : 100 |

Les valeurs inconnues sont exclues du dénominateur et affichées comme manquantes.
Il faut au moins deux critères connus représentant au moins 40 % du poids total.
Sinon le score est `null` et l’interface affiche **Inconnu**.

Effectifs : nombres, plages simples `1-9` / `10 à 49`, ou mentions exactes
TPE/PME/micro-entreprise/indépendant/solo. Une plage traversant 100 personnes,
comme `50-199`, est inconnue. Les qualificatifs ne remplacent pas une vérification.
L’absence d’URL n’est jamais assimilée à une entreprise sans site. Aucun budget
minimum n’est supposé et aucun secteur n’est défavorisé arbitrairement.

### Need — besoin digital observé

Seul le dernier audit v3 de l’entreprise est utilisé, sans compléter ses données
avec un audit antérieur plus favorable. Un audit absent, ancien de plus de
90 jours ou insuffisamment couvert produit `null`.

Pour chaque catégorie, le serveur fait la moyenne des contrôles distincts :
erreur critique = 100, problème important = 65, amélioration recommandée = 20,
conforme au contrôle = 0. `Non vérifié` est exclu. Un contrôle répliqué sur
plusieurs pages compte une fois, avec la gravité maximale observée. Les résultats
PageSpeed ne sont pas inventés quand l’API ou les mesures sont indisponibles.

| Catégorie | Poids |
| --- | ---: |
| Conversion | 30 |
| SEO technique | 25 |
| Performance | 20 |
| Expérience mobile | 15 |
| Accessibilité | 5 |
| Sécurité | 5 |

Il faut au moins deux catégories vérifiées représentant au moins 40 % du poids
total. Le score est une moyenne pondérée normalisée sur les catégories connues.
Une note zéro signifie des contrôles exécutés sans problème dans ce périmètre ;
elle ne signifie pas que le site entier est parfait. Une note élevée ne prouve
ni manque à gagner, ni besoin d’achat, ni urgence commerciale.

Les services sont proposés comme pistes à confirmer pour des contrôles importants
ou critiques : performance → optimisation des performances ; SEO → optimisation
SEO ; conversion → conversion ; mobile → refonte à étudier ; sécurité et
accessibilité → conseil/diagnostic, sans affirmer qu’un site utilise WordPress.
Les autres services (maintenance WordPress, création, SEO local, automatisation,
CRM, assistants IA et tout service ajouté) nécessitent un **Besoin confirmé**
documenté et lié au code du service. Le catalogue seul ne suffit pas.

### Intent — intention documentée

Le dernier signal reconnu datant de moins de 180 jours prévaut. Les ouvertures
d’emails, tâches programmées et étapes du pipeline ne sont jamais utilisées comme
preuves d’intérêt. Les signaux futurs sont rejetés.

| Dernier signal | Score |
| --- | ---: |
| Demande d’informations | 40 |
| Réponse positive | 60 |
| Demande de devis | 85 |
| Rendez-vous confirmé | 75 |
| Projet annoncé | 60 |
| Refus explicite | 0 |
| Aucun signal récent suffisant | `null` / **Inconnue** |

Les signaux manuels exigent un type reconnu, une preuve factuelle, une source,
une date passée valide et une confirmation humaine. Un « Besoin confirmé »
alimente les pistes de services, sans devenir à lui seul une intention d’achat.
Les scénarios positifs/devis/informations/refus existants sont réutilisés seulement
avec une réponse détaillée et datée dans le CRM ; une simple réponse libre n’est
pas interprétée automatiquement par mots-clés.

### Priorité

Règles évaluées dans cet ordre :

1. Opposition/restriction détectée ou entreprise déclarée fermée → basse,
   vérification interne. La restriction concerne prudemment toute recommandation
   de contact même si un seul canal/interlocuteur est restreint ; elle n’étend pas
   juridiquement l’opposition aux autres contacts et ne modifie aucune préférence.
2. Dernier signal = refus explicite → basse.
3. Fit connu inférieur à 50 → basse.
4. Fit ≥ 70 et Intent ≥ 60, avec Need ≥ 30 ou besoin confirmé → haute.
5. Fit connu ≥ 50 avec Need ≥ 20 ou Intent positif → moyenne.
6. Fit et Need connus, sans condition précédente → basse.
7. Sinon → données insuffisantes.

La priorité peut être modifiée avec justification et version de fiche. Une
analyse ne touche jamais la décision humaine. Le retour aux recommandations est
une action explicite et historisée. Ces décisions restent séparées de la priorité
générale de l’entreprise et des priorités/étapes des opportunités.

### Revenu récurrent

Le potentiel récurrent est la somme **non pondérée** des montants mensuels déjà
saisis dans les opportunités ouvertes ; il demeure prévisionnel. Sans montant
saisi, il reste inconnu. Le contracté provient uniquement des opportunités gagnées
avec référence et date de signature. Aucun prix ni montant n’est inventé par IA.

## Données ajoutées et intégrité

| Table | Rôle |
| --- | --- |
| `qualification_services` | Catalogue configurable, désactivation plutôt que suppression |
| `qualification_signals` | Signaux humains datés, liés à l’entreprise et éventuellement au service |
| `qualification_manual` | Décision de priorité active, justification et version |
| `qualification_decisions` | Historique append-only des décisions et retours au calcul |
| `qualifications` | Instantanés scores/preuves, résultat IA, mode, état, modèle demandé/retourné, version et dates |
| `qualification_usage` | Réservation budgétaire, coût calculé, tokens et tarifs appliqués |

Toutes les associations utilisent des clés étrangères avec suppression restreinte.
La migration et l’initialisation du catalogue sont transactionnelles et
idempotentes. Le catalogue déjà personnalisé n’est pas écrasé au redémarrage.
Les anciens audits, messages, contacts et opportunités ne sont pas modifiés.

Avant d’étendre une base existante, `openDatabase` crée une sauvegarde
`crm.sqlite3.before-qualification-<date>-<id>.sqlite3`, permissions `0600`, dans le
dossier persistant déjà prévu pour le CRM. Une base nouvellement créée n’a pas de
sauvegarde inutile. Les migrations des phases précédentes gardent leurs noms.

Une analyse locale ou IA ajoute un nouvel enregistrement. Les échecs sont
historisés sans effacer le dernier résultat valide. L’écran présente les scores
courants, et l’historique présente les instantanés datés ; les preuves peuvent donc
évoluer sans réécrire l’analyse ancienne. Les listes d’historique retournent les
50 entrées les plus récentes, les autres restent conservées dans SQLite.

## OpenAI et maîtrise des coûts

API utilisée : `POST https://api.openai.com/v1/responses`, sans outils, sans
navigation, sans action administrative. `store:false`, JSON Schema strict,
validation serveur supplémentaire de la forme et des références. Les appels
sont uniquement individuels, après confirmation dans le formulaire.

Le serveur impose :

- Une analyse IA active à la fois, verrou SQLite partagé entre instances du service.
- Dix appels par heure et 60 secondes entre deux demandes pour la même entreprise.
- Budgets locaux de 1 USD/jour et 5 USD/mois, périodes calendaires UTC.
- 1 800 tokens de sortie maximum et délai de 45 secondes, configurables.
- Corps de requête maximal de 60 000 octets et réponse limitée à 256 000 octets.
- Réservation avant appel : borne prudente de tokens d’entrée
  `2 × octets UTF-8 du corps complet + 2048`, plus le maximum de sortie.
- Après réception d’un usage valide, coût calculé sur les tokens effectifs.
  Le prix des tokens d’entrée reste volontairement non remisé, même en cache.
- Aucun nouvel essai automatique. En cas d’échec ou de délai expiré sans usage
  confirmé, la réservation reste consommée par prudence : le fournisseur a pu
  exécuter le traitement. Le compteur local n’est pas une facture.
- Un appel abandonné conserve sa réservation. Un verrou de processus interrompu
  est marqué `interrupted` après cinq minutes au prochain lancement manuel.

Les tarifs par défaut ne sont disponibles que pour `gpt-4.1-mini` et sa version
`gpt-4.1-mini-2025-04-14`. Pour un autre modèle, les deux tarifs doivent être
explicitement configurés et supérieurs à zéro ; sinon l’IA reste indisponible.
Le modèle doit supporter Responses et Structured Outputs. Une réponse refusée,
incomplète ou invalide n’est pas présentée comme une synthèse réussie.

Tarifs officiels consultés le 4 novembre 2026 pour GPT-4.1 Mini :
0,40 USD/million de tokens d’entrée et 1,60 USD/million de sortie.
Exemple indicatif : 5 000 tokens d’entrée + 1 500 de sortie = **0,0044 USD** par
analyse, soit **0,44 USD** pour 100 analyses de ce volume. Le volume réel dépend
des preuves et de la réponse. Conversion EUR, taxes et éventuels changements de
tarifs non inclus. Aucun appel payant réel n’a été exécuté pendant cette livraison.

Ces budgets contrôlent uniquement ce module et dépendent de tarifs correctement
configurés. Ils ne limitent pas d’autres applications utilisant la même clé.
Vérifier également l’usage et les alertes du projet OpenAI. Les plafonds ne sont
pas modifiables par le modèle ou par un simple champ de la fiche entreprise.

Sources officielles :

- [Modèle, prix, endpoint et capacités GPT-4.1 Mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

## Configuration Hostinger — après revue et autorisation de déploiement

Conserver Node.js 22.16+ et le répertoire persistant déjà configuré. Exécuter
`npm ci`, `npm run build`, puis démarrer avec `npm start`, comme auparavant.
La seule nouvelle dépendance externe à l’exécution est l’API OpenAI en HTTPS
sortant, si la fonction est activée. Aucun worker, navigateur, Docker ou nouveau
service système n’est nécessaire.

Variables à définir **dans les variables serveur de l’application CRM2** :

```dotenv
OPENAI_API_KEY=<clé du projet OpenAI, à saisir uniquement dans le panneau serveur>
OPENAI_QUALIFICATION_MODEL=gpt-4.1-mini-2025-04-14
QUALIFICATION_DAILY_BUDGET_USD=1
QUALIFICATION_MONTHLY_BUDGET_USD=5
QUALIFICATION_MAX_PER_HOUR=10
QUALIFICATION_COOLDOWN_SECONDS=60
QUALIFICATION_MAX_OUTPUT_TOKENS=1800
QUALIFICATION_TIMEOUT_SECONDS=45
QUALIFICATION_INPUT_USD_PER_MILLION=0.40
QUALIFICATION_OUTPUT_USD_PER_MILLION=1.60
```

Ne jamais ajouter la vraie clé dans le code, GitHub, un fichier public, le
navigateur ou un message client. Ne pas préfixer ces variables avec un préfixe de
build frontend. L’API `/api/qualification/status` renvoie uniquement la
disponibilité, le modèle, les limites et le compteur ; jamais la clé.

Sans clé : démarrer normalement, ouvrir une entreprise, contrôler les scores
locaux et vérifier que l’indisponibilité IA est claire. Après activation : lancer
une seule entreprise de test, vérifier la synthèse et l’usage dans le projet
OpenAI avant une utilisation plus large. Ce test réel reste à réaliser par
l’exploitant dans son environnement avec sa clé.

## Sécurité, confidentialité et validation humaine

- L’authentification et le contrôle d’origine existants protègent toutes les routes.
- Minimisation : effectif, secteur, pays, présence d’URL sous forme booléenne,
  scores, preuves limitées et services admissibles. Pas de nom de personne,
  fiche contact, email, téléphone, notes libres, corps d’email ou HTML brut envoyé
  volontairement. Les coordonnées et URL rencontrées dans les extraits sont
  masquées ; cette mesure ne garantit pas l’anonymisation de tout texte libre.
- Cinquante preuves maximum dans un appel. Leur texte est limité et masqué.
- Le contenu des sites et des champs déclaratifs est explicitement non fiable.
  Les instructions de l’application restent dans `instructions`, les observations
  dans un objet JSON distinct. Aucun outil exécutable n’est exposé au modèle.
- Les recommandations doivent citer des preuves connues et les services doivent
  être admissibles pour ces preuves. Une référence inconnue fait échouer l’analyse.
- Les textes retournés sont affichés échappés, jamais interprétés comme HTML.
- Les stratégies de contact retournées en présence d’une restriction sont
  remplacées par des vérifications internes. Les protections existantes de
  brouillons/tâches/email continuent de s’appliquer indépendamment du score.
- Les logs ne contiennent que l’identifiant technique et un code d’erreur générique,
  jamais la réponse fournisseur, la clé ni les données envoyées.
- Aucun email, relance, tâche, opportunité ou modification de pipeline n’est créé.

La validation structurelle ne démontre pas la vérité d’un texte généré. Les
synthèses, objections et stratégies sont explicitement marquées comme assistance
IA à vérifier par un humain. Les preuves automatiques restent limitées au
périmètre audité ; une absence détectée ne démontre pas une absence sur tout le site.

## Routes

| Méthode et route | Effet |
| --- | --- |
| `GET /api/qualification/status` | Disponibilité, limites et utilisation |
| `GET /api/qualification/services` | Catalogue |
| `POST /api/qualification/services` | Ajouter/modifier/désactiver un service |
| `GET /api/qualification/companies` | Projection courante ; filtres `priority`, tri `fit_score`/`need_score` |
| `GET /api/companies/:id/qualification` | Scores actuels, décision, signaux, dernier résultat, historique |
| `POST /api/companies/:id/qualification/rules` | Nouvel instantané local gratuit |
| `POST /api/companies/:id/qualification/analyse` | Appel individuel avec `confirm` égal à l’identifiant entreprise |
| `POST /api/companies/:id/qualification/priority` | Décision justifiée avec `version`, ou retour explicite au calcul |
| `POST /api/companies/:id/qualification/signals` | Signal réel avec `confirmed:true`, preuve, source et date |
| `GET /api/qualifications/:id` | Instantané conservé et résultat IA éventuel |

La liste Entreprises propose aussi les seuils Fit/Need et un tri de priorité
effective. Aucune nouvelle permission ou hiérarchie d’utilisateurs n’est créée :
le modèle d’accès demeure celui du CRM existant, avec les mêmes droits d’édition.

## Tests et limites connues

**Validation finale : `npm run build` réussi et 90 tests Node réussis (66 existants et 24 nouveaux), sans échec.**

Les tests automatisés utilisent des réponses simulées, sans sites ni appels
OpenAI réels. Ils couvrent scores, données manquantes, audits partiels/anciens,
signaux, refus, tarifs, budgets, réservation avant appel, concurrence, erreurs,
historique, décisions, FK, authentification, origine, oppositions, catalogue,
revenus saisis, minimisation et validation des preuves.

Les tests des renderers exécutent le vrai JavaScript avec des réponses réelles de
l’API locale et analysent le HTML généré : onglet Entreprise, filtres/tri, mode
sans clé et échappement des contenus malveillants. Ils ne remplacent pas un
navigateur complet. **La revue visuelle desktop/mobile et le parcours complet
dans un navigateur restent à faire** : aucun navigateur de rendu n’était installé
dans cet environnement. Le CSS prévoit trois cartes sur desktop, une seule
colonne sous 650 px, contrôles natifs et tableaux défilants.

Limites métier : méthode initiale à calibrer, données déclaratives parfois
incomplètes, vieillissement des preuves, aucun enrichissement ni recherche
automatique. Le récapitulatif de qualification recalcule les règles lors du
chargement et effectue des lectures synchrones par entreprise : adapté à ce CRM
local, à mesurer et à mettre en cache/paginer avant plusieurs milliers de fiches.
La gestion de reprise suppose l’instance Node unique déjà utilisée par le CRM.
Les règles RGPD existantes ne sont ni réécrites ni contournées.

## Retour arrière

Avant un futur déploiement, conserver une copie hors déploiement du dossier de
données. En cas de problème d’interface, redéployer le commit précédent : les
tables ajoutées sont isolées et ne changent pas le schéma des anciennes entités.
Pour une restauration complète, arrêter l’application, sauvegarder la base
actuelle, restaurer la copie `.before-qualification-*` dans `CRM_DATA_DIR`, puis
relancer la version précédente. Cette restauration annule les écritures faites
après la copie ; ne jamais la faire sur une base active.
