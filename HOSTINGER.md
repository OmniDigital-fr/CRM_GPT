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
