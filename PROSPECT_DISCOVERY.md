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

Le registre fournit l’identité et l’activité. Le module attend un lien de site
fourni pendant la revue. Il ne devine pas le domaine. Les recherches automatiques
de domaines, Google Places et les autres fournisseurs d’enrichissement pourront
être ajoutés séparément après validation des coûts et des conditions d’utilisation.

## Stockage, sécurité et coûts

- Les tables SQLite `discovery_runs` et `discovery_candidates` isolent les
  candidats de la base commerciale. L’historique indique la date, les critères,
  les décisions, les correspondances, la source, les erreurs de recherche et
  les requêtes au registre. Les résultats et compteurs temporaires sont purgés
  au premier accès à la recherche après 30 jours. Les fiches importées et leurs
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
