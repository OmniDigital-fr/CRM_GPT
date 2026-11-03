# Entreprises et contacts — phase 1

## Périmètre et diagnostic initial

Dépôt exclusivement concerné : **OmniDigital-fr/CRM_GPT**, application cible **crm2.omnidigital.fr**. Ne jamais intervenir sur le dépôt CRM ou crm.omnidigital.fr. Publication et fusion dans main soumises à l’accord de Paulo.

Version de référence : `5e16dd51a8bf7e6633d23c66c7243f3b9b273b49`. Le dépôt initial comprend Express 5, SQLite natif Node 22.16+, frontend HTML/JS/CSS sans compilation, un prototype Python historique et 29 tests Node. Tables initiales : prospects, messages, events, site_audits, contact_history, contact_suppressions, outreach_sequences, prospect_replies, mail_state, mail_received. Les dossiers prospects combinent entreprise et interlocuteur ; leur déduplication par entreprise empêche plusieurs interlocuteurs. Les APIs sont protégées par l’authentification Basic en production, une origine contrôlée et des types de contenu imposés. La messagerie SMTP/IMAP, les séquences avec approbation individuelle et les audits ont des références vers prospects.

Hostinger utilise server.js, npm ci, npm run build et npm start ; données SQLite persistantes hors déploiement. La documentation décrit un déploiement depuis main ; la configuration réelle de hPanel n’a pas été inspectée. Le workflow GitHub ne déploie rien. Aucune connexion à Hostinger, aucun changement de domaine, aucun envoi réel ni accès à la base de production n’a été effectué. L’absence de données commerciales en production est une information fournie par l’utilisateur, pas un constat réalisé ici.

## Architecture retenue

Nouvelles tables :

| Table | Contenu et intégrité |
| --- | --- |
| companies | Tous les champs entreprise du cahier des charges, plus budget_kind, information_status, verification_notes, métadonnées du dernier audit et dates. SIREN unique s’il est renseigné, score entier nullable de 0 à 100. |
| contacts | Tous les champs contact, information_status, verification_notes, dates ; company_id obligatoire et prospect_id unique vers la projection de compatibilité. |
| audits | id, company_id, contact_id nullable, payload JSON, source, created_at. Historique conservé. |
| interactions | id, company_id, contact_id nullable, kind, detail, created_at. Historique conservé. |

Chaque contact structuré dispose d’une projection interne dans prospects pour réutiliser les modules existants. L’email général de l’entreprise n’est jamais utilisé comme email personnel. Les modifications passent par les nouvelles fiches ; update/delete/reconsent historiques sont bloqués pour les projections. Les interactions et audits produits dans les modules historiques sont répercutés par triggers. Statuts, réponses et restrictions sont synchronisés vers contacts. Les modifications d’entreprise actualisent les projections et révoquent les approbations ; aucune approbation n’est transformée en envoi.

Les nouvelles entreprises et les nouveaux contacts ont des formulaires distincts. Les entreprises ont les six onglets demandés ; les contacts ont des sections professionnelles, coordonnées, suivi, communications, RGPD et historique. Dossiers & outils conserve les fonctionnalités historiques. Les anciens dossiers ne sont pas convertis automatiquement et restent accessibles. Une entreprise peut exister sans contact.

Déduplication : SIREN identique bloqué ; nom normalisé et domaine web identiques signalés pour vérification sans fusion automatique. Email personnel déjà utilisé bloqué. SIREN/SIRET vérifiés par longueur et Luhn, exception SIRET La Poste ; cohérence du préfixe vérifiée. Cela ne certifie pas l’existence de l’entreprise dans un registre. Email et URL : validation syntaxique, pas de vérification de délivrabilité. Dates et valeurs structurées validées côté serveur. Information inconnue laissée vide ; score manuel. Budget qualifié comme estimé ou déclaré. Fiabilité globale et réserves documentables, sans provenance indépendante pour chaque champ.

Oppositions : restrictions email et téléphone séparées ; aucune levée par édition. Les coordonnées d’un canal opposé restent réservées pour empêcher une réintroduction dans les nouveaux formulaires ou les anciens. Une opposition globale conserve aussi les empreintes antérieures à un changement de coordonnées. Les refus commerciaux et l’opposition générale restent distincts. Aucun nouveau moteur d’envoi, de recherche IA ou de relance automatique.

## Installation de développement

```sh
git switch feature/companies-contacts
npm ci
npm run build
npm test
CRM_DATA_DIR=/chemin/absolu/vers/donnees-de-test npm start
```

Utiliser des données de test et ne pas configurer MAIL_PASSWORD pour les essais. Les tests utilisent des bases temporaires et des services mail simulés. Aucun secret réel n’est requis.

## Sauvegarde et récupération

Aucune table existante n’est supprimée et aucune migration du CRM ancien n’est incluse. Lorsqu’un fichier SQLite existant contient prospects et ne contient pas encore companies, openDatabase réalise d’abord une copie SQLite cohérente par VACUUM INTO, nommée `crm.sqlite3.before-companies-<date>-<uuid>.sqlite3`, avec permissions 0600, dans le même dossier privé. En cas d’échec de sauvegarde, le démarrage s’arrête avant extension. Une base neuve ne nécessite pas cette copie. Les tests vérifient le contenu de la sauvegarde et l’absence de nouvelle sauvegarde au redémarrage.

Après approbation de déploiement seulement : arrêter l’application CRM2, confirmer son chemin persistant et compter les dossiers, réaliser une sauvegarde externe vérifiée de la base et des éventuels fichiers WAL/SHM selon la procédure SQLite. Ne pas copier un fichier SQLite ouvert comme simple sauvegarde. Vérifier la cible crm2 et CRM_GPT ; ne pas toucher CRM. Déployer la version approuvée puis tester authentification, formulaires, intégrité et opposition avant usage réel.

Pour revenir en arrière : arrêter CRM2, conserver séparément la base courante pour ne pas perdre de nouvelles opérations, remettre le code au commit de référence, restaurer la copie cohérente antérieure à l’extension dans CRM_DATA_DIR/crm.sqlite3, avec permissions et propriétaire adaptés. Ne pas réutiliser les fichiers WAL/SHM d’une autre version de base. Redémarrer et vérifier les comptes de dossiers, messages et audits. Cette procédure restaure un état antérieur et ne conserve pas les opérations enregistrées après la sauvegarde.

## Fichiers concernés

- entities.js : schéma, validation, règles, projections et nouvelles APIs.
- contact-policy.js : opposition d’un interlocuteur structuré sans opposition implicite de toute son entreprise.
- crm-server.js : sauvegarde avant extension, montage des APIs et protection des projections.
- static/entities-ui.js : listes, filtres, création, édition et fiches.
- static/app.js, static/index.html, static/style.css : navigation, chargement et style.
- tests/entities.test.js : tests de séparation, intégrité, opposition, compatibilité et sauvegarde.
- package.json : vérification des nouveaux fichiers et exécution de tous les tests Node.
- README.md, DEVELOPMENT.md : périmètre, fonctionnement, installation et récupération.

## Vérifications réalisées

- Base de référence : 29 tests Node réussis avant modification.
- Version livrée : npm run build réussi et 40 tests Node réussis (29 existants + 11 nouveaux).
- Parcours DOM avec jsdom : création d’entreprise, ajout d’un contact depuis sa fiche, affichage des six sections du contact ; aucune erreur JavaScript remontée. Ce contrôle ne mesure pas le rendu visuel.
- Tests SQLite : association obligatoire, clés étrangères, conservation des audits, initialisation répétable et sauvegarde avant extension vérifiées.
- Aucune vérification SMTP/IMAP réelle, aucun déploiement et aucune inspection de base Hostinger.

## Limites et suite

Pas de migration de l’ancien CRM, pas de suppression ou de transfert de contacts structurés, pas de levée d’opposition sur ces contacts dans cette phase. owner_id et contact_owner_id sont des références textuelles : l’application reste mono-administrateur, sans annuaire utilisateur ni rôles multiples. La provenance est documentée par fiche, pas par champ. Les audits sur une entreprise sans contact restent dans son historique ; les nouveaux contacts peuvent consulter cet historique depuis l’entreprise. Les scores et statuts de vérification email sont renseignés manuellement. L’import PDF historique crée encore des dossiers historiques ; il ne crée pas automatiquement des entreprises et contacts structurés.

Le contrôle visuel réel dans Chromium reste à effectuer : le navigateur n’était pas installé et le téléchargement a renvoyé une archive invalide dans l’environnement. Les contrôles syntaxiques et tests API ne remplacent pas une validation visuelle mobile et desktop.

Prochaine étape : validation visuelle avec Paulo, puis unification du dashboard et de l’import PDF autour des entités structurées, gestion documentée des suppressions/nouveaux accords, et seulement ensuite moteurs de prospection assistée. Ne pas fusionner ou publier automatiquement.

## Correction : enregistrement des oppositions

La saisie du motif détaillé ne bloque plus la sauvegarde d’une opposition email, téléphone ou globale. Si le champ est vide, une note factuelle indique que le motif détaillé est non renseigné ; aucune preuve client n’est inventée. La date est conservée et les protections restent actives. Le formulaire précise ce comportement et place le focus sur les erreurs de sauvegarde. Un test de régression reproduit les trois cas sans motif, recharge les fiches et vérifie le blocage des brouillons email.
