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
