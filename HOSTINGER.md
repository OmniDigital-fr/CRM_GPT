# Déploiement sur crm2.omnidigital.fr

Le serveur principal est maintenant Node.js/Express avec SQLite. Ne pas choisir « Déployer en statique » : les contacts et les APIs nécessitent le serveur. Aucun déploiement Hostinger ni configuration DNS n’a encore été vérifié depuis cet environnement.

## Import GitHub dans hPanel

1. Créer/ouvrir l’application Node.js destinée à **crm2.omnidigital.fr**, puis importer **OmniDigital-fr/CRM_GPT**, branche **main**, répertoire racine du dépôt.
2. Actualiser la liste des dépôts si `package.json` n’est pas détecté. Il doit se trouver à la racine.
3. Choisir **Express**, **Node.js 22.16+** (22 récent ou 24), fichier d’entrée **server.js**. Installation : `npm ci` ; vérification/build : `npm run build` ; démarrage : `npm start`. Il n’y a pas de répertoire de sortie statique `dist` : le serveur sert les fichiers de `static/` et ses propres APIs.
4. Dans les variables d’environnement de l’application, renseigner les champs ci-dessous **avant le premier démarrage**. `PORT` est fourni par Hostinger et le serveur l’utilise tel quel.
5. Activer le déploiement automatique du dépôt dans hPanel. Les prochains pushes sur main déclenchent le build Hostinger. La configuration effective doit être confirmée dans hPanel ; le code seul ne l’active pas. Le workflow GitHub Actions effectue des contrôles, mais ne déploie rien lui-même.
6. Associer le sous-domaine, configurer son DNS et SSL dans hPanel. Préserver les autres sites et tous les enregistrements mail. Ne jamais écraser un site existant sans avoir vérifié son contenu et sauvegardé les données.

## Variables serveur

| Nom | Valeur / rôle |
| --- | --- |
| `NODE_ENV` | `production` |
| `CRM_PUBLIC_URL` | `https://crm2.omnidigital.fr` |
| `CRM_AUTH_USER` | Identifiant administrateur de votre choix, sans caractère `:` |
| `CRM_AUTH_PASSWORD` | Mot de passe unique et robuste, au moins 16 caractères, saisi uniquement dans hPanel |
| `CRM_DATA_DIR` | Chemin absolu d’un dossier **persistant, inscriptible et hors du dossier de déploiement**, sur le même serveur |
| `PAGESPEED_API_KEY` | Facultatif, nécessaire aux audits Google |

Ne pas coller les mots de passe dans le chat ni dans le dépôt. `.env.example` est uniquement une liste de noms : le serveur ne charge pas de fichier `.env` automatiquement. Utiliser les variables Hostinger.

Le chemin persistant dépend du compte. Relever le chemin réel dans le gestionnaire de fichiers/SSH hPanel et créer un dossier de données privé, en dehors de la zone supprimée à chaque build. **Ne pas deviner le chemin ni utiliser `.data/` dans les sources en production.** Si le produit Node.js ne fournit aucun stockage local réellement persistant entre builds, ne pas déployer avec SQLite : il faudra migrer vers MySQL ou utiliser un autre stockage persistant. Le contrôle du chemin par l’application ne peut pas garantir la politique de rétention du fournisseur : celle-ci doit être vérifiée dans hPanel et par un redéploiement test.

## Connexion et données

Le navigateur demande l’identifiant et le mot de passe (authentification HTTP Basic sur HTTPS). Il s’agit d’un accès administrateur unique ; pas de comptes multiples, de récupération de mot de passe ni de gestion de rôles. Les requêtes de modification nécessitent JSON/PDF et une origine autorisée. Les fichiers de base de données, sources et variables ne sont jamais servis comme fichiers statiques.

Le fichier `crm.sqlite3` reste compatible avec l’ancienne version Python. Pour transférer les données d’un Codespace : arrêter le serveur, sauvegarder le fichier `.data/crm.sqlite3`, le copier dans `CRM_DATA_DIR/crm.sqlite3` avant le premier démarrage. S’il existe une base cible, la sauvegarder et planifier la migration ; ne pas l’écraser. Les données ignorées par Git ne sont pas copiées par le déploiement automatique. Prévoir des sauvegardes régulières via l’API SQLite de sauvegarde ou pendant un arrêt du serveur.

Le lecteur PDF fonctionne en JavaScript sans commande système `pdftotext`. PDF texte uniquement, 12 Mo maximum, 100 pages maximum ; pas d’OCR. Aucun email envoyé automatiquement : le fournisseur de messagerie reste à connecter.

## Vérification après installation

- Sans identifiants, `/` et `/api/state` doivent répondre **401**.
- Se connecter dans le navigateur et retrouver la dashboard et les contacts.
- Créer un contact de test, l’éditer, vérifier le refus d’un doublon.
- Importer un rapport PDF texte et vérifier les champs extraits.
- Redéployer depuis GitHub et confirmer que le contact de test est conservé : c’est le contrôle indispensable de la persistance.
- Supprimer uniquement le contact de test après validation.

Ne pas déclarer l’installation prête tant que HTTPS, authentification et persistance après redéploiement ne sont pas validés.


## Lanceur Hostinger

`server.js` est un point d’entrée qui appelle toujours `startServer()`, y compris quand Hostinger l’importe depuis son lanceur. Les fonctions réutilisables et testables sont dans `crm-server.js`. Ne pas ajouter de condition `require.main` ou de comparaison avec `process.argv` autour du démarrage. Le test d’entrée reproduit l’import par un lanceur et vérifie une réponse HTTP en moins de trois secondes.

## Mise à jour audit et suivi commercial

Les nouveaux champs et tables SQLite sont ajoutés automatiquement au démarrage, sans suppression des contacts existants. Les dossiers et audits restent dans le même `CRM_DATA_DIR`. Faire une sauvegarde avant mise à jour importante.

Pour analyser des sites publics, le serveur doit pouvoir résoudre leurs domaines et accéder à HTTP/HTTPS. La vérification HTTPS maintient la validation des certificats. `www.googleapis.com` doit être accessible si `PAGESPEED_API_KEY` est configurée. Sans clé, les audits HTML fonctionnent ; les performances Google restent non mesurées.

Les séquences n’envoient rien : approbations individuelles, déclaration d’envoi manuel et saisie des réponses uniquement tant que le fournisseur email n’est pas connecté. Le système n’active pas de tâche planifiée d’envoi.

## Messagerie contact@omnidigital.fr (Hostinger)

Dans les variables de l’application existante, **ajouter sans effacer les autres valeurs** :

| Variable | Valeur |
| --- | --- |
| `MAIL_PROVIDER` | `hostinger` |
| `MAIL_USER` | `contact@omnidigital.fr` |
| `MAIL_PASSWORD` | Password de la boîte email, saisie uniquement dans hPanel |
| `MAIL_FROM_NAME` | `OmniDigital` (facultatif) |

Il s’agit du mot de passe de la boîte, pas celui du CRM ou de la connexion hPanel. Ne jamais transmettre ce secret dans le chat ou GitHub. Les serveurs confirmés sont `smtp.hostinger.com:465` et `imap.hostinger.com:993`, TLS avec vérification des certificats. Aucun changement DNS n’est effectué par le code. Conserver les enregistrements de messagerie existants.

Après enregistrement des variables et redémarrage, ouvrir **Automatisation → Messagerie → Vérifier la connexion sans envoyer**. Ce bouton teste SMTP et IMAP sans transmettre d’email. « Configuration présente » ne garantit pas l’authentification : la vérification doit réussir. Cet environnement de développement ne dispose pas de la password et n’a pas vérifié la connexion réelle de la boîte.

Le serveur relève INBOX toutes les 60 secondes en lecture seule, sans déplacer, marquer comme lus ou supprimer les emails. La première synchronisation initialise un repère au courrier actuel : aucun historique de boîte n’est importé. Seules les nouvelles réponses dont le fil (`In-Reply-To` / `References`) et l’expéditeur correspondent à un message SMTP envoyé par le CRM sont associées à un contact. Une réponse à un ancien envoi manuel sans identifiant connu doit toujours être enregistrée manuellement. Pièces jointes ignorées ; messages de plus de 512 Ko non importés automatiquement ; si l’expéditeur correspond à un destinataire connu, ses relances sont mises en pause pour une vérification manuelle. Relever la boîte à partir d’un seul processus applicatif et sauvegarder SQLite normalement.

Pour envoyer : relire/modifier le texte, enregistrer, **Approuver ce mail**, puis **Envoyer maintenant** et confirmer le destinataire/objet. Les notes et le texte PDF restent dans « Contexte interne » et ne sont pas transmis. Les anciens brouillons qui contiennent encore le bloc « Éléments du dossier à vérifier… » doivent être nettoyés avant envoi.

Avant chaque envoi, une synchronisation IMAP est exigée : une erreur de synchronisation bloque l’envoi, et une réponse/opposition annule les approbations en attente. Aucune tâche planifiée n’envoie de mails. Une réponse peut arriver après la synchronisation, alors qu’un envoi confirmé est déjà en cours : un message déjà transmis au serveur SMTP ne peut pas être rappelé par le CRM.

SMTP ne garantit ni la livraison finale ni un envoi exactement une fois après une coupure. En cas d’erreur ambiguë, le statut devient **À vérifier**, sans tentative automatique. Vérifier auprès du fournisseur puis utiliser la résolution documentée : envoi confirmé, ou non-envoi confirmé avec nouvelle approbation obligatoire. L’acceptation SMTP n’est pas une preuve d’arrivée dans la boîte du destinataire. La connexion SMTP ne garantit pas une copie dans le dossier « Envoyés » ; le CRM conserve son propre historique. Les messages d’erreur de distribution non rattachés automatiquement restent à examiner dans la boîte. Aucune mesure d’ouverture ou de clic n’est activée.
