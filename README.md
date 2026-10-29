# OmniDigital CRM

## Serveur Node.js — version principale pour Hostinger

Node.js **22.16+** (22 récent ou 24), Express, SQLite et extraction PDF JavaScript. Les interfaces et la base restent compatibles avec le prototype Python. Le serveur Node n’a pas besoin de `pdftotext`.

```sh
npm ci
npm run build
npm test
npm start
```

En développement : serveur local sur le port 8000, données dans `.data/crm.sqlite3`. `PORT` et `CRM_DATA_DIR` permettent de les modifier. Utiliser le checkout existant ; aucun worktree supplémentaire nécessaire. Lancer un seul serveur à la fois.

Pour **crm2.omnidigital.fr**, suivre [HOSTINGER.md](HOSTINGER.md) : import GitHub, paramètres Express, authentification obligatoire en production, HTTPS et stockage persistant hors du déploiement. Une nouvelle publication du code ne transfère pas les données du Codespace. Le déploiement automatique doit être activé dans hPanel.

Les fichiers Python ci-dessous sont conservés comme version locale historique ; ils ne sont pas le point d’entrée Hostinger et n’offrent pas la protection d’accès du serveur Node.

---

# OmniDigital CRM — première version locale

CRM en français, Python 3.12+, SQLite, interface web sans compilation. Aucun paquet Python externe. Dépendance système : `pdftotext` (paquet `poppler-utils`).

## Démarrage

Depuis `/workspace/CRM_GPT` :

```sh
python app.py
```

Serveur local sur le port 8000 ; `PORT` permet de changer le port. Données persistantes dans `.data/crm.sqlite3`, à sauvegarder. `CRM_DATA_DIR` permet de choisir un autre répertoire. Utiliser le checkout existant ; aucun worktree supplémentaire nécessaire.

Pour les audits Google, injecter `PAGESPEED_API_KEY` dans l’environnement du serveur et autoriser `www.googleapis.com` en HTTPS. Activer PageSpeed Insights API sur le projet Google et contrôler ses quotas. Aucune clé dans le code ou Git. Sans clé, les dossiers, PDFs et brouillons restent utilisables. Les audits transmettent l’URL du prospect à Google ; les PDFs sont traités localement et seul leur texte est conservé.

## Disponible

- Création de prospects, notes, site, email et suivi du statut, dont opposition.
- Import PDF (12 Mo max), extraction texte, association au dossier ; détection des documents sans texte. Pas encore d’OCR.
- PageSpeed Insights mobile : scores et opportunités conservés, utilisés pour sélectionner les thèmes des messages.
- Brouillons persistants avec éléments de dossier à vérifier. Modèles déterministes ; aucune IA ni interprétation automatique approfondie des PDFs.
- Dashboard de données réelles. Zéro envoi ; taux indéfinis affichés « — ». Les statistiques de campagne ne sont pas encore alimentées.

## Limites et étapes suivantes

Prototype local : pas d’authentification, séparation des organisations, chiffrement de la base, sauvegarde automatique, suppression/export de dossiers ni protection CSRF. Ne pas exposer sur Internet et ne pas utiliser de vrais dossiers clients sensibles avant durcissement.

L’envoi automatique, les séquences, la réception et le suivi email restent à développer après choix du fournisseur (Gmail, Microsoft 365 ou prestataire transactionnel). Prévoir OAuth, file de tâches durable, limites d’envoi, gestion des rebonds, vérification des signatures des webhooks, déduplication des événements et arrêt des séquences à la réponse/opposition. Définir la base légale, la provenance des données, les durées de conservation et les règles de désinscription adaptées à la prospection B2B. Le tracking d’ouverture peut être faussé par les protections de confidentialité ; les clics par les robots.

## Extensions

Les ressources sont séparées en prospects, messages et événements SQLite. L’API `/api/prospects/:id/audit` constitue le premier connecteur ; `/api/prospects/:id/draft` prépare les messages. Extraire ces fonctions en modules de connecteurs avant extension. Modules prévus : moteur IA (texte PDF traité comme données non fiables), OCR, email OAuth, campagnes/ordonnanceur, webhooks, devis et facturation. L’intégration PageSpeed utilise directement son API officielle ; aucun serveur MCP nécessaire.

## Vérification

```sh
python -m unittest discover -s tests -v
node --check static/app.js
```

## Importer un dossier de prospect PDF

Chargez le PDF dans votre Codespace (glisser-déposer dans l’explorateur de fichiers), puis, depuis le même terminal/répertoire de données que le serveur :

```sh
python import_prospect.py "chemin/rapport.pdf"
```

L’importateur reconnaît les champs `Nom`, `Email`, `Site web`, coordonnées et opportunité des dossiers OmniDigital, conserve le texte complet (100 000 caractères maximum) et crée le prospect au statut Nouveau. Au besoin, fournir `--company`, `--email` et `--website`. Un dossier ayant le même nom d’entreprise normalisé ou le même email n’est pas réimporté. Les observations du rapport ne sont pas une nouvelle mesure Google. Aucun message n’est envoyé. Actualisez l’interface après import.

Les PDFs et la base sont des données locales : ne pas les ajouter à Git. Le GitHub Codespace et l’environnement cloud possèdent des bases distinctes.

## Fiches de contact

Le bouton « Nouveau prospect » ouvre une fiche avec entreprise, secteur, SIREN/SIRET, site, interlocuteur, fonction, email, téléphone, mobile, adresse, complément d’adresse / lieu-dit, code postal, ville, pays, provenance et date de collecte, priorité, prochaine relance, besoins, services à proposer et notes. « Voir / modifier » permet de corriger ces données sans toucher au PDF ni au statut commercial. La prochaine relance est une date de suivi, sans déclenchement automatique d’email. Les nouveaux champs sont ajoutés automatiquement à la base existante au redémarrage du serveur.

Palette bleu nuit/violet provisoire : le site de référence crm.omnidigital.fr a renvoyé HTTP 403 lors de la consultation. L’identité exacte reste à confirmer à partir d’une capture ou des couleurs officielles.

## Dashboard

Structure visuelle inspirée de la capture du CRM précédent : navigation sombre, bandeau bleu/violet, neuf indicateurs, graphique comparatif et pipeline. Interface en français, recherche sur entreprise/contact/email/téléphone/ville, thème clair ou sombre mémorisé dans le navigateur et mise en page mobile. Le logo est une composition typographique provisoire, pas le fichier original.

Les graphiques montrent les créations de contacts ou de brouillons réellement enregistrées, par jour, avec comparaison au mois précédent (dates Europe/Paris). Les statistiques de messagerie non connectées sont indiquées comme indisponibles. Les relances à traiter correspondent aux échéances atteintes, hors dossiers gagnés, perdus ou en opposition ; les contacts prioritaires correspondent à la priorité Haute. Aucun moteur d’envoi n’est lancé. Les sections Séquences et Automatisation annoncent explicitement les connexions restant à réaliser. Les états du pipeline existant sont conservés.


## Suppression et doublons

Dans Contacts, « Supprimer » ouvre une confirmation explicite. La suppression est définitive pour la fiche, le texte PDF, les analyses, les messages et événements associés dans la base active ; elle ne modifie pas les sauvegardes externes. Annuler conserve les données.

La création, l’édition et l’import contrôlent le nom d’entreprise (majuscules, accents, espaces et ponctuation ignorés) et l’email (espaces externes et casse ignorés). Une même entreprise ou un même email bloque une seconde fiche. Le nom de l’interlocuteur seul ne bloque pas les homonymes de sociétés différentes. Les créations concurrentes sont sérialisées pendant la vérification. Les doublons historiques sont signalés dans Contacts et ne sont ni fusionnés ni supprimés automatiquement. Un import en doublon conserve le dossier existant sans l’écraser.

## Audit du site, qualification et historique

L’entrée « Audit du site » et le bouton de chaque contact ouvrent un espace dédié : URL, contrôles HTML/HTTPS, scores mobiles Google si la clé est configurée, arguments de prospection et historique complet des analyses. Les 3 premières conclusions du dernier audit alimentent les nouveaux brouillons. Les contrôles restent indicatifs : page d’accueil uniquement, viewport ≠ rendu mobile, temps au premier octet ≠ temps de chargement, signatures ≠ bon fonctionnement. Les avis Google sont non vérifiés sans connexion Business/Places. Une erreur Google conserve les résultats HTML. Les destinations locales, privées et réservées, redirections comprises, sont refusées. Limites : 2 Mo de HTML, 5 requêtes maximum, délai HTTP global de 18 secondes et PageSpeed 60 secondes. Aucun script du site n’est exécuté.

La fiche propose les étapes commerciales, responsable, rôle décisionnel, budget, échéance, prestataire actuel, prochaine action, objections, refus et date de la dernière réponse. Les scénarios incluent demande d’informations/tarifs/rendez-vous, intérêt, plus tard, pas de budget, prestataire existant, refus de l’offre, mauvaise personne, adresse invalide, fermeture et opposition. Ce sont des options structurées, pas une liste exhaustive de toutes les situations métier.

« Historique » dans chaque ligne ou la fiche affiche un journal daté : création, mises à jour, statut, audits, réponses, séquences, approbations et déclarations d’envoi manuel. L’historique est enrichi à partir de cette version, sans inventer d’événements antérieurs.

## Opposition, restrictions et nouvel accord

Un refus commercial (`Pas intéressé`/`Perdu`) clôture les relances et bloque les nouveaux brouillons ; il ne vaut pas automatiquement opposition générale. Une opposition explicite bloque la prospection, annule les brouillons/approbations et met les séquences en pause. Restrictions séparées pour email, téléphone et SMS ; actuellement seul le canal email a un flux de brouillons, aucun appel/SMS n’est effectué. La provenance publique des données n’est pas présentée comme un accord explicite.

Après suppression d’un contact opposé, des empreintes SHA-256 minimales du nom d’entreprise, de l’email et des numéros sont conservées pour bloquer sa recréation/réimportation. Pas de PDF ni de corps de message dans cette liste. Adapter la durée de conservation à la politique de l’agence. La suppression de la fiche efface ses audits, messages, réponses et historique dans la base active, pas les sauvegardes externes. Un contact encore présent peut faire l’objet d’un « Nouvel accord documenté » explicite : preuve obligatoire, historique conservé, aucune relance automatique. La gestion d’un nouvel accord après suppression complète de la fiche reste une opération d’administration de la liste d’opposition.

## Séquences et validation individuelle — aucun envoi automatique

« Séquences » prépare 4 brouillons : email initial, relance 1, relance 2, dernier message. **7 jours minimum entre deux envois confirmés**, et non 7 jours après la simple création des brouillons. Les dates initiales J+7/J+14/J+21 sont indicatives ; la prochaine échéance n’est fixée qu’après déclaration de l’envoi précédent.

Dans « Emails », chaque texte est modifiable et doit être approuvé individuellement. Une modification du texte ou du destinataire révoque l’approbation. **Approuvé n’est pas Envoyé.** Le fournisseur email n’est pas connecté, aucun worker d’envoi n’existe et aucune action ne transmet d’email. « Déclarer l’envoi manuel effectué » enregistre uniquement un envoi que l’utilisateur confirme avoir réalisé en dehors du CRM ; il nécessite une approbation et respecte le délai de 7 jours. Les statistiques d’envoi incluent ces déclarations manuelles.

Les réponses doivent être copiées dans le formulaire « Enregistrer et analyser une réponse client ». La classification utilise des mots-clés, avec correction manuelle possible ; ce n’est pas une analyse IA. Une opposition explicite détectée est prioritaire. Toute réponse suspend la séquence, annule les messages/approbations en attente, est conservée dans l’historique et prépare si approprié un nouveau brouillon à approuver. Les refus et oppositions ne génèrent aucun nouveau message. La réception automatique et l’analyse sémantique avancée nécessitent encore un fournisseur email et éventuellement un service IA.
