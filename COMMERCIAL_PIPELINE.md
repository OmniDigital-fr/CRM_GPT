# Phase 2 — pipeline commercial et opportunités

## Référence analysée avant modification

Dépôt : `OmniDigital-fr/CRM_GPT`, cible exclusive `crm2.omnidigital.fr`. Point de départ `main` : **7ea1eeaacebf5e890b6f759e938bf99823e40644**, intégrant la phase 1, sa correction d’opposition et le logo officiel. Branche : `feature/commercial-pipeline`. Ne pas fusionner ni publier sans l’accord de Paulo. Aucun accès ni changement au CRM ancien.

Différences par rapport à un CRM commercial entièrement normalisé :

- Les sociétés et contacts sont séparés, mais chaque contact garde une projection unique vers `prospects`. La messagerie, les séquences, les PDFs et audits utilisent encore ces projections. Cette compatibilité est maintenue.
- Les statuts de contact et d’entreprise ne sont pas des étapes d’opportunité. Les nouvelles opportunités ont leur propre pipeline et ne réécrivent pas les statuts des contacts.
- Le dashboard initial décrit les contacts et messages. Le nouveau dashboard commercial devient la vue principale ; l’activité initiale reste consultable dans un panneau dépliable.
- L’authentification existante est mono-administrateur. Le responsable commercial reste un libellé textuel ; aucun annuaire ni contrôle multi-utilisateur n’est inventé.
- La messagerie sait déjà envoyer sur confirmation individuelle. Cette phase ajoute uniquement la journalisation des faits confirmés ; aucun worker ou envoi automatique supplémentaire.

## Modèle de données

| Table | Contenu |
| --- | --- |
| `opportunities` | Identifiant, société, contact principal facultatif, nom, services, besoin, étape, priorité, origine, implantation en cêntimes (`implementation_cents`), récurrent mensuel en centimes (`monthly_cents`), probabilité nullable, conclusion prévue, prochaine action et échéance, responsable, perte, notes, référence du contrat, signature, dates et version. |
| `commercial_tasks` | Société obligatoire déduite si nécessaire, contact/opportunité facultatifs, titre, description, type, canal de relance, priorité, échéance UTC, état, responsable, date de fin, dates et version. |
| `commercial_events` | Références société/contact/opportunité/tâche, type, origine, détail, ancienne et nouvelle étape, date effective et date d’enregistrement. |
| `opportunity_stage_visits` | Première visite réellement enregistrée pour une opportunité et une étape, avec ordre du journal. Aucun passage implicite ni historique reconstitué. |

Clés étrangères et indices sur associations, étapes et échéances. Suppression référentielle restrictive. Des triggers refusent aussi les associations avec des contacts/opportunités d’une autre société. Une société peut avoir plusieurs opportunités, sans dupliquer ses coordonnées ou celles de ses contacts. Le transfert d’une opportunité à une autre société n’est pas proposé.

Étapes : Nouveau → À qualifier → Qualifié → À contacter → Contacté → Intéressé → Rendez-vous → Proposition envoyée → Négociation → Gagné / Perdu. Les sauts et retours en arrière restent possibles et sont journalisés. Le Kanban propose une liste d’étapes sur chaque carte et une vue tableau ; aucune dépendance au glisser-déposer.

## Montants, contrats et indicateurs

L’API accepte `implementation_amount` et `monthly_amount` en euros, puis convertit sans multiplication flottante en centimes entiers. Montants négatifs, notation scientifique, plus de deux décimales et valeurs supérieures à 1 000 000 000 € par montant refusés. Valeur non renseignée : zéro. Probabilité manuelle, entière, de 0 à 100, facultative ; aucune estimation IA.

Une opportunité **Gagné** exige une référence d’accord/contrat et une date de signature non future. C’est une confirmation déclarée par l’administrateur, pas une signature électronique ou une preuve vérifiée automatiquement. Une opportunité **Perdu** exige un motif. Le passage à l’une de ces étapes ouvre le formulaire de clôture.

| Indicateur | Calcul |
| --- | --- |
| Ouvertes | Toutes les opportunités hors Gagné et Perdu. |
| Gagnées / perdues | État courant des opportunités. |
| Implémentation potentielle | Somme des centimes des opportunités ouvertes, non pondérée. |
| Récurrent mensuel potentiel | Somme des récurrents des opportunités ouvertes, hors dossiers clos. |
| Récurrent mensuel contractualisé | Somme des récurrents des opportunités gagnées, avec référence et date d’accord obligatoires. Aucun encaissement ni facturation déduit. |
| Réunions réalisées | Nombre de faits « Réunion » explicitement confirmés dans le journal commercial. Une tâche terminée et l’étape Rendez-vous ne sont pas des réunions réalisées. |
| Propositions envoyées | Nombre de faits « Proposition » déclarés et confirmés. Le simple changement d’étape ne vaut pas un envoi. |
| Tâches en attente / en retard | État En attente ; retard si échéance strictement antérieure à l’instant du calcul. |
| Gain des dossiers clos | Gagnées / (gagnées + perdues), sinon valeur indéfinie affichée « — ». |
| Conversion entre étapes | Opportunités ayant ensuite atteint l’étape suivante / opportunités ayant réellement visité l’étape. Une opportunité compte une fois ; un passage direct ne crée aucune visite intermédiaire. Les transitions ultérieures à un retour en arrière sont prises en compte. Dénominateur nul : « — ». |

Indicateurs cumulatifs depuis l’utilisation de ce module, sans filtre de période dans cette phase. Les valeurs actuelles des opportunités sont utilisées ; il ne s’agit pas d’un grand livre comptable ou d’une prévision pondérée. Réouvrir ou perdre un contrat sort son récurrent de l’indicateur contractuel actuel. Le journal conserve les changements.

## Tâches et historique

Types : Appel, Email, Réunion, Proposition, Relance, Autre. États : En attente, Terminée, Annulée. Vues : en attente, retard, à venir, terminées, annulées, toutes. Une tâche de communication Appel/Email/Relance exige un interlocuteur ; une relance exige un canal. Une tâche d’opportunité hérite du contact principal si aucun contact n’est choisi. Les dates sont stockées en UTC ; saisie dans le fuseau explicite du navigateur, affichage en Europe/Paris. Aucun calendrier externe créé.

Terminer une tâche enregistre une date de fin réelle. Une édition ultérieure conserve cette date ; une réouverture l’efface de l’état courant mais conserve l’événement historique. Une nouvelle fin produit un nouvel événement. Les formulaires envoient une version de fiche ; une mise à jour concurrente périmée renvoie 409. Les clients API peuvent omettre cette version, avec la sémantique de dernière écriture.

Origines du journal :

- **Système** : audit de création/modification/étape/tâche, ou événement lié à une acceptation SMTP déjà enregistrée. Cela indique une journalisation automatique, pas une action commerciale accomplie spontanément par un robot.
- **Manuel** : interaction déclarée via le formulaire avec confirmation obligatoire et description/référence, ou envoi manuel déjà confirmé dans le module email.
- **Historique** : réponse venant du système historique, dont le caractère saisi/importé n’est pas reconstitué. L’interface indique « Origine historique non précisée ».

Les futurs envois confirmés et réponses sont reliés au contact et à sa société. Ils ne sont pas attribués arbitrairement à toutes ses opportunités. Les actions spécifiques à une opportunité peuvent être enregistrées dans sa fiche. Les fiches société/contact permettent aussi un enregistrement manuel et montrent les opportunités, tâches et événements associés dans « Suivi commercial ». Les anciens journaux d’interactions restent accessibles dans leurs onglets d’origine ; aucune duplication/réinterprétation de leur passé.

Les approbations email et les brouillons ne produisent aucun fait « Email envoyé ». Acceptation SMTP ne signifie pas réception ou lecture. Aucun envoi réel réalisé pour les tests.

## Opposition et accès

Les routes et fichiers du module passent après les mêmes contrôles d’authentification, d’origine et de contenu que le reste du CRM. Aucun nouvel accès public. Oppositions globales et restrictions par canal consultées côté serveur à la création, à l’édition et à la fin de tâches de prospection. La clôture administrative et l’annulation restent possibles. Les étapes de contact effectif sont bloquées si le contact principal est en opposition globale. Une réponse entrante ou une note peut toujours être enregistrée.

Une tâche d’email ne transmet jamais de message. La création d’une tâche de proposition est traitée prudemment comme une future communication email si elle cible un contact. Une opposition ultérieure ne supprime pas l’historique ; elle empêche de terminer/relancer une action interdite, que l’utilisateur peut annuler.

## APIs principales

- GET `/api/commercial/meta`, `/api/commercial/dashboard`.
- GET/POST `/api/opportunities`, GET `/api/opportunities/:id`, POST `/api/opportunities/:id/update`, POST `/api/opportunities/:id/stage`.
- GET/POST `/api/tasks`, GET `/api/tasks/:id`, POST `/api/tasks/:id/update`.
- POST `/api/commercial/events`, GET `/api/commercial/history` (filtre company_id, contact_id ou opportunity_id obligatoire).
- Les détails société et contact ajoutent `opportunities`, `tasks` et `commercial_history` à leur réponse actuelle.

Les filtres des listes acceptent les références et états documentés dans le code ; toutes les requêtes d’écriture sont validées côté serveur et transactionnelles. Pas d’API de suppression dans cette phase.

## Installation, sauvegarde et retour arrière

```sh
git switch feature/commercial-pipeline
npm ci
npm run build
npm test
CRM_DATA_DIR=/chemin/absolu/donnees-test npm start
```

Utiliser des données fictives et aucune configuration mail réelle dans le développement. Node.js 22.16+ comme auparavant. Aucune dépendance de production ajoutée.

Au premier démarrage sur une base phase 1 existante dépourvue d’opportunities, une sauvegarde cohérente VACUUM INTO est créée **avant toute extension** : `crm.sqlite3.before-commercial-<date>-<uuid>.sqlite3`, permissions 0600, dans le dossier privé des données. Une ancienne base sans companies conserve la convention before-companies. Une base neuve n’est pas sauvegardée inutilement. Échec de sauvegarde : arrêt du démarrage. Les nouvelles tables sont ajoutées sans supprimer ni convertir les données existantes.

Après approbation seulement : confirmer le chemin persistant du CRM2, sauvegarder également la base hors du déploiement et tester sa restauration, publier le commit approuvé, puis vérifier création de société/contact/opportunité, transitions, tâches, indicateurs et authentification. Ne pas activer de nouveau fournisseur mail ni modifier de variable secrète.

Retour arrière : arrêter uniquement le CRM2, préserver la base courante, remettre le code au commit de référence, restaurer la sauvegarde cohérente pré-extension avec le bon propriétaire et permissions, sans WAL/SHM provenant d’un autre état. Redémarrer et vérifier les comptes et historiques. Les opérations postérieures à la sauvegarde restent dans la copie conservée et ne sont pas reprises automatiquement. Aucun traitement du CRM ancien.

## Validation réalisée

- `npm ci`, `npm run build` réussis.
- **51 tests Node réussis** : 40 existants et 11 nouveaux (CRUD, multiples opportunités, transitions/historique, montants/dates, tâches, indicateurs/conversions, intégrité, opposition, authentification, faits email et sauvegarde de phase 1).
- Parcours DOM jsdom : affichage des onze colonnes, création d’opportunité, création et fin de tâche, affichage des associations dans la fiche société ; aucune erreur JavaScript remontée. jsdom n’est pas une dépendance du projet et n’est pas nécessaire pour npm test.
- Pas de validation visuelle réelle desktop/mobile dans cette session : le contrôle DOM ne certifie pas le rendu graphique.
- Aucun déploiement, aucune base de production consultée ou modifiée et aucun email réel envoyé.

## Fichiers modifiés

`commercial.js`, `tests/commercial.test.js`, `static/commercial-ui.js`, `crm-server.js`, `entities.js`, `static/entities-ui.js`, `static/app.js`, `static/index.html`, `static/style.css`, `package.json`, `README.md`, `COMMERCIAL_PIPELINE.md`.

## Limites et prochaine étape

Responsables textuels et accès mono-administrateur conservés ; pas de gestion d’équipe ni de signature électronique. Pas de glisser-déposer, d’envoi automatique, de rappels externes, de synchronisation agenda ni de facturation. Les rapports historiques ne sont pas attribués rétroactivement à une opportunité. Les confirmations manuelles sont des déclarations auditables, pas des preuves vérifiées par un tiers.

Valider visuellement les nouveaux écrans et tester le parcours commercial complet avec des données fictives avant publication. Après validation, envisager l’affectation explicite des messages/audits à une opportunité, les filtres temporels et la gestion des devis. La prospection et l’IA restent une phase ultérieure.
