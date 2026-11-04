# Phase 4 — Qualification commerciale explicable et assistance IA

## État et périmètre

La qualification commerciale est intégrée à CRM2. La branche
`feature/gemini-ai-integration` remplace le fournisseur génératif à partir de
la phase 4 déjà intégrée dans `main` (`450cbea`).

L’interface est en français de France. La qualification est intégrée dans la
fiche Entreprise, onglet **Qualification IA**. Sans clé Gemini, le CRM, les règles,
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
| `contacts` / `prospects` | Restrictions et scénarios de réponses structurés | Aucune identité ni coordonnée envoyée à Gemini |
| `audits` | Dernier résultat du moteur digital v3 | Contrôles indicatifs, périmètre limité, audit de moins de 90 jours pour Need |
| `opportunities` | Montants récurrents saisis et contrats signés | Un état du pipeline ne constitue pas une preuve d’intention |
| Réponses structurées `prospects` | Scénario positif, demande d’informations/devis ou refus avec détail et date | Le contenu du message n’est pas envoyé ; le scénario demeure une déclaration humaine |

Les phases 1 à 3 restent intactes. Les résultats d’audits et coordonnées ne sont
pas dupliqués dans une nouvelle fiche. Un instantané de preuves est toutefois
conservé avec chaque qualification pour qu’une analyse antérieure reste lisible
après modification de la fiche ou réalisation d’un nouvel audit.

L’adaptateur Gemini remplace la précédente intégration OpenAI. Les vérifications
de sites restent assurées par le moteur v3. Les modules de qualification,
les scores, les preuves et les décisions commerciales restent locaux.

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
| `qualification_usage` | Réservations et consommation historiques OpenAI |
| `qualification_ai_calls` | Tests et analyses Gemini, quotas, cache, tokens et erreurs filtrées |

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

## Gemini et maîtrise des coûts

L’adaptateur `ai/providers/gemini.js` utilise `@google/genai` et
`generateContent` avec JSON Schema. La validation locale contrôle les longueurs,
les champs, les valeurs et les références de preuve. Le SDK s’exécute côté
serveur sur Node.js 22.16+. Le contrat du fournisseur normalise le modèle,
le JSON et les tokens. Les analyses historiques OpenAI gardent leur fournisseur,
leur modèle et leur consommation. Les nouveaux appels sont enregistrés dans
`qualification_ai_calls`.

Le modèle par défaut est `gemini-3.5-flash-lite`. La Google Gemini API le
documente comme adapté au traitement léger de données et à la traduction, avec
sorties structurées, niveau gratuit et aucune date d’arrêt annoncée au
4 novembre 2026. Les quotas dépendent du projet et du modèle. Vérifiez le quota
effectif dans Google AI Studio. Les limites locales ne sont pas les quotas Google.

- Par défaut, 5 demandes par heure et par compte CRM, 15 par jour et 150 par mois.
  Les journées et mois locaux suivent UTC. Le CRM utilise son authentification
  Basic existante et possède actuellement un seul compte configuré.
- Les tests, les appels échoués et les délais dépassés comptent dans ces limites.
  Un appel à la fois est autorisé via SQLite. Un appel bloqué est marqué interrompu
  au prochain lancement après cinq minutes.
- Une analyse identique terminée dans les 15 dernières minutes est réutilisée,
  avec la même fiche, le même contexte, le même instantané et le même modèle.
  Un contexte modifié déclenche une nouvelle analyse après le délai de 60 secondes.
- Le délai réseau est de 45 secondes par défaut. Le SDK effectue une seule
  tentative. Un 429 suspend les appels Gemini pendant 15 minutes. Vérifiez les
  limites du projet avant de relancer, notamment si son quota journalier est épuisé.
- Les réponses sont limitées à 256 000 octets et les données à 60 000 octets.
  La limite par défaut de 1 800 tokens de génération est configurable. Le modèle
  utilise un niveau de raisonnement minimal et aucune recherche ou autre outil.
- En mode payant, le CRM réserve une estimation prudente avant l’appel. En cas
  d’usage inconnu, la réservation reste comptabilisée. Les tokens de raisonnement
  déclarés sont inclus dans le coût de sortie. Les plafonds locaux sont des
  estimations et la facturation Google fait foi.

Tarifs standard vérifiés pour ce modèle. L’entrée texte coûte 0,30 USD par
million de tokens, la sortie 2,50 USD par million, raisonnement compris.
Par exemple, 5 000 tokens en entrée et 1 500 en sortie représentent environ
0,00525 USD par analyse, hors taxes et conversion. Pour changer de modèle en mode
payant, mettez aussi les deux tarifs à jour. Le mode de test gratuit est réservé
au modèle vérifié par défaut. Le CRM ne sélectionne aucun modèle de secours.

Sources officielles :

- [Modèle et capacités](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Tarifs Gemini](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite)
- [Limites](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Dates d’arrêt](https://ai.google.dev/gemini-api/docs/deprecations)
- [Sorties structurées](https://ai.google.dev/gemini-api/docs/structured-output)

## Configuration Hostinger — CRM2

1. Créez une clé dans [Google AI Studio](https://aistudio.google.com/api-keys).
   Utilisez un projet dédié et vérifiez son niveau d’usage et sa facturation.
2. Dans hPanel, ouvrez les variables d’environnement serveur de l’application
   **CRM2**. Définissez `GEMINI_API_KEY` sur la clé du projet. La clé reste dans
   hPanel, en dehors du dépôt et de l’interface du CRM.
3. Définissez `GEMINI_MODEL=gemini-3.5-flash-lite`. Consultez `.env.example`
   pour les limites `QUALIFICATION_MAX_PER_HOUR`, `QUALIFICATION_MAX_PER_DAY`,
   `QUALIFICATION_MAX_PER_MONTH`, le délai et les budgets.
4. Pour un essai technique de développeur sur données fictives, utilisez
   `GEMINI_BILLING_MODE=free-test`. Après vérification d’un projet sans
   facturation dans AI Studio, définissez `GEMINI_FREE_PROJECT_CONFIRMED=true`.
   Le CRM ne peut pas vérifier le niveau de facturation à partir de la clé.
   La confirmation atteste une vérification humaine et ne change pas le projet.
5. Enregistrez les variables et redémarrez l’application. Conservez Node.js
   22.16+, le répertoire SQLite persistant et la procédure `npm ci`,
   `npm run build`, `npm start`. L’accès HTTPS sortant à
   `generativelanguage.googleapis.com` doit être possible.
6. Dans **Paramètres → Intelligence artificielle**, cliquez sur **Tester la
   connexion Gemini**. Le test envoie un objet fictif et contrôle le retour JSON.
   Le panneau affiche le modèle, les compteurs, les tokens, la dernière analyse
   terminée et les dernières erreurs. Consultez AI Studio pour les quotas
   fournisseur et Cloud Billing pour la facturation éventuelle.
7. Pour suspendre tous les appels, définissez `GEMINI_ENABLED=false` et
   redémarrez. Retirer la clé désactive aussi les appels. Les scores locaux
   continuent de fonctionner.

### Usage avec des données CRM en France

Les [conditions Gemini](https://ai.google.dev/gemini-api/terms) exigent les
« Paid Services » lorsque des clients de l’API sont mis à disposition
d’utilisateurs de l’EEE, de Suisse ou du Royaume-Uni. Pour l’API, Google définit
cet accès par un projet associé à un compte de facturation actif. Les clauses
régionales sur l’usage des données s’appliquent aussi au quota gratuit, ce qui
est distinct de la restriction de mise à disposition. Google décrit aussi une
conservation limitée des requêtes et réponses pour la sécurité, la prévention
des abus et certaines obligations légales.

Le mode `free-test` bloque tout envoi de données d’entreprise. Après validation
des conditions, du traitement des données et des coûts, l’exploitant peut choisir
explicitement `GEMINI_BILLING_MODE=paid` et `GEMINI_ALLOW_CRM_DATA=true` avec
un projet approprié. Le bouton d’analyse demande ensuite une confirmation pour
chaque entreprise. Aucun basculement automatique vers ce mode n’existe.

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
| `POST /api/qualification/test` | Vérification Gemini avec un message fictif, soumise aux limites locales |
| `GET /api/qualifications/:id` | Instantané conservé et résultat IA éventuel |

La liste Entreprises propose aussi les seuils Fit/Need et un tri de priorité
effective. Aucune nouvelle permission ou hiérarchie d’utilisateurs n’est créée :
le modèle d’accès demeure celui du CRM existant, avec les mêmes droits d’édition.

## Tests et limites connues

Commandes de validation

- `npm run build`
- `npm test`

Les tests automatisés utilisent des réponses simulées, sans sites ni appels
Gemini réels. Ils couvrent scores, données manquantes, audits partiels/anciens,
signaux, refus, tarifs, budgets, réservation avant appel, concurrence, erreurs,
historique, décisions, FK, authentification, origine, oppositions, catalogue,
revenus saisis, minimisation et validation des preuves.

Les tests d’interface utilisent l’API locale et analysent le HTML généré.
Le test réel de connexion nécessite la clé de l’exploitant et un projet Gemini
configuré conformément au mode choisi.

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
