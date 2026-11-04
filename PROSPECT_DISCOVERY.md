# Recherche de prospects · CRM2

Dans **Prospection → Recherche de prospects**, choisissez une zone, des secteurs,
des tranches d’effectif et le nombre de candidats. Le formulaire propose dix
candidats par défaut et accepte jusqu’à 25. La recherche se déclenche à la demande.

1. Ouvrez un résultat pour consulter l’identité, l’établissement, les identifiants,
   la source et la date de collecte. Les filtres de présence digitale s’appliquent
   aux résultats après qualification. « Afficher tous les résultats pour
   vérification » permet de reprendre les fiches sans site confirmé.
2. Saisissez le site public découvert et lancez sa vérification. Le rapprochement
   se fonde sur un SIREN ou SIRET trouvé sur la page ou sur une page de mentions
   légales du même domaine. Un identifiant affiché est un indice de correspondance,
   pas une preuve de contrôle du domaine. Une absence de résultat ne démontre pas
   que le site n’existe pas. Un HTTP 403, un délai ou une panne ne démontre pas une
   absence durable. Les coordonnées générales ne sont reprises que si elles sont
   explicitement publiées sur le site vérifié et correspondent aux règles
   de collecte. Les fiches individuelles ne sont pas créées.
3. Sur un site confirmé, lancez si nécessaire l’audit digital v3. Les scores
   locaux de qualification et les pistes issues de ses contrôles sont disponibles
   avant import. Les indices de croissance, de maintenance ou d’automatisation
   peuvent être documentés avec une source publique. Ils restent des hypothèses
   jusqu’à validation. Une intention d’achat inconnue reste inconnue.
4. Examinez les correspondances, puis approuvez, rejetez ou reportez la décision.
   Importez une fiche approuvée ou sélectionnez plusieurs fiches approuvées.
   Le lot est transactionnel. Un conflit empêche toute création dans le lot.
   L’import réutilise la création de fiche CRM et joint l’audit préparatoire.
5. Sur une entreprise importée, utilisez son onglet **Qualification IA** pour
   lancer Gemini individuellement si le CRM est configuré à cet effet. Les
   quotas et protections de l’intégration existante s’appliquent. En mode
   `free-test`, les scores locaux sont disponibles et Gemini reste réservé au
   test fictif dans les paramètres.

## Source et filtres

La recherche utilise [l’API Recherche d’Entreprises](https://recherche-entreprises.api.gouv.fr/)
et relie chaque fiche à l’[Annuaire des Entreprises](https://annuaire-entreprises.data.gouv.fr/).
Le serveur appelle `GET /search` avec une pagination bornée, le filtre d’activité
et, selon la recherche, un mot-clé, un code région, département ou postal, et les
sections d’activité applicables. Pour une ville, la recherche textuelle est suivie
d’une comparaison du libellé de la commune dans les établissements retournés.
Le formulaire accepte les codes INSEE de région et les départements ultramarins.
La recherche ne constitue pas un recensement exhaustif. Les résultats dépendent
de l’index de la source et des quatre pages au maximum examinées.

Le CRM vérifie localement les identifiants, l’activité de l’entreprise et de
l’établissement, le lieu, la correspondance de secteur et les tranches d’effectif.
La classification par secteur regroupe les divisions NAF. Les tranches du
registre sont rapprochées par chevauchement et les effectifs inconnus restent
éligibles. « Microentreprise » est une approximation par effectif, sans
détermination du régime fiscal, juridique ou du chiffre d’affaires.
Les données à diffusion restreinte sont exclues. Pour les entrepreneurs
individuels, seules les fiches disposant d’une enseigne publique sont retenues,
sans raison sociale personnelle ni adresse complète.

Le registre fournit l’identité, l’activité et la date de création disponible.
La fiche affiche jusqu’à trois dirigeants personnes physiques déclarés pour une
personne morale, à vérifier. Elle ignore les dates de naissance, nationalités
et autres champs personnels du registre. Un dirigeant déclaré ne devient pas
un contact CRM. Les entreprises fermées restent exclues de la prospection.

## Enrichissement et configuration Hostinger

1. Dans **Prospection → Recherche de prospects**, utilisez **Enrichir automatiquement**
   sur une fiche, ou cochez les lignes et lancez **Enrichir les prospects sélectionnés**.
   Avec la recherche web activée, une case permet également d’enrichir les
   premiers résultats après la recherche.
2. La file exécute une fiche à la fois et conserve la progression en SQLite.
   L’arrêt interrompt la recherche web et laisse se terminer la lecture HTML
   bornée en cours. Après un arrêt ou redémarrage, **Reprendre l’enrichissement**
   relance les fiches restantes. Les résultats sont mis en cache 24 heures
   pour un même candidat. Les erreurs et quotas restent visibles dans le lot.
3. Une correspondance exige un SIREN/SIRET visible sur la page ou ses mentions
   légales. Jusqu’à trois domaines sont contrôlés. Si plusieurs correspondent,
   ils restent à vérifier. Une recherche infructueuse décrit l’échantillon.
4. Le CRM peut relever un email générique, un numéro de standard, un lien de
   présentation, un lien LinkedIn d’entreprise et un formulaire HTML à partir
   des pages du site confirmé. Il ne soumet aucun formulaire. Les coordonnées
   contradictoires sont exclues de l’import. Les coordonnées saisies en
   consultation assistée restent des observations temporaires. La complétude
   suit sept groupes documentaires et reste indépendante du potentiel commercial.
5. PagesJaunes et Société.com s’ouvrent dans des liens de consultation manuelle.
   Les [CGU de PagesJaunes](https://www.pagesjaunes.fr/infoslegales/mentionslegales/)
   excluent la constitution automatique de bases de prospection. [L’API Pro
   Société.com](https://www.societe.com/solutions/api) est une offre distincte
   et n’est pas utilisée ici. Le registre et l’Annuaire restent prioritaires.

| Variable Hostinger | Fonction |
| --- | --- |
| `PROSPECT_BRAVE_ENABLED` | `false` par défaut. Activer explicitement après validation du plan et des conditions. |
| `PROSPECT_BRAVE_API_KEY` | Clé serveur, à saisir dans hPanel. |
| `PROSPECT_BRAVE_MONTHLY` | Plafond local par mois UTC, 300 par défaut, maximum 1 000. |
| `PROSPECT_ENRICHMENT_BATCH` | 10 fiches par lot, configurable jusqu’à 25. |

Le [tarif Brave Search](https://api-dashboard.search.brave.com/documentation/pricing)
affiche 5 USD pour 1 000 recherches et 5 USD de crédits mensuels. Vérifier le
compte, les conditions de réutilisation et tout achat automatique avant
activation. Avec 300 appels, la valeur tarifaire est de 1,50 USD avant crédits.
Le plafond local couvre seulement ce CRM. Sans clé, la vérification manuelle
du site, les annuaires et les audits restent accessibles. Après configuration,
redéployer l’application Node.js en conservant son répertoire SQLite persistant.
Commencer par une entreprise publique connue, puis contrôler la preuve
d’identité et la provenance des coordonnées avant d’approuver un import.

Les coordonnées nominatives ne sont pas recherchées ni transmises à Gemini.
L’analyse Gemini reste individuelle, après import, avec le régime de données et
les plafonds existants. Pour toute réutilisation commerciale d’informations
publiques, vérifier la finalité, les droits d’opposition et la conservation selon
les [recommandations de la CNIL](https://www.cnil.fr/fr/la-reutilisation-des-donnees-publiquement-accessibles-en-ligne-des-fins-de-demarchage-commercial).

## Stockage, sécurité et coûts

- Les tables SQLite `discovery_runs` et `discovery_candidates` isolent les
  candidats de la base commerciale. L’historique indique la date, les critères,
  les décisions, les correspondances, la source, les erreurs de recherche et
  les requêtes au registre. Les résultats temporaires sont purgés après 30 jours et les compteurs après 32 jours, au premier accès à la recherche. Les fiches importées et leurs
  audits suivent la conservation habituelle du CRM.
- Limites locales sur 24 h glissantes. Quarante requêtes au registre, vingt
  vérifications de sites, cinq audits préparatoires. Une seule recherche active
  et une seule vérification ou audit préparatoire à la fois par instance.
  L’arrêt d’une recherche interrompt la requête en cours et conserve les
  résultats déjà reçus. Les échecs et les quotas du registre sont signalés.
- Le client du registre utilise une destination fixe, sans redirection et avec
  un délai de 8 secondes par page. Pour un site, le module réutilise le contrôle
  DNS et la protection SSRF du moteur d’audit, avec vérification des redirections.
  La vérification met en cache un résultat 24 h, l’audit préparatoire sept jours.
- Les doublons forts bloquent l’import. Les noms similaires demandent une
  revue explicite et sont recontrôlés à l’import. Les oppositions détectées
  et les empreintes de suppression bloquent les réintroductions correspondantes.
  Les coordonnées générales frappées d’une opposition sont écartées.
- Le flux de découverte utilise l’API publique du registre et l’audit HTML local,
  sans appel PageSpeed ni intégration Google Places. Gemini, si autorisé pour les
  données réelles, suit le mode et les plafonds déjà configurés dans CRM2.
  La recherche et l’import n’envoient aucun email et ne démarrent aucune campagne.

## Vérification

`npm run build` et `npm test` couvrent le flux avec réponses simulées, y compris
les refus de la source, les correspondances de domaine, les imports et la
qualification Gemini individuelle. La recherche réelle doit être contrôlée
sur l’environnement de test avec la source officielle accessible. Aucun accès
réel au registre n’a pu être confirmé depuis l’environnement de développement.
