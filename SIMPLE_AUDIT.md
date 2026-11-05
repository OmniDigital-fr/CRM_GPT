# Audit lisible en une minute

## Lecture principale

Le diagnostic commence désormais par les notes Google PageSpeed, une conclusion
courte, trois priorités au maximum et une prochaine action. Les critères affichés
pour téléphone et ordinateur sont : vitesse, accessibilité, référencement et
bonnes pratiques. Les notes sont celles reçues de Google, sans score global inventé.

Les catégories 0–49, 50–89 et 90–100 suivent les repères Lighthouse :
https://developer.chrome.com/docs/lighthouse/performance/performance-scoring/
Ces tests de laboratoire varient et ne certifient ni le site, ni son référencement,
ni sa sécurité ou sa rentabilité. Une mesure absente reste « Non mesuré », y
compris si un ancien champ contient un score avec un état d’échec.

Exemple fictif : vitesse téléphone 58/100 et ordinateur 96/100. Le résumé indique
que le chargement mobile mérite une vérification, sans recommander une refonte.
Les éventuels points critiques observés conservent la priorité sur cette piste.
Un résultat de 98/100 ne devient pas une déclaration de conformité du site entier.

Les deux repères de chargement facultatifs sont le temps d’affichage du contenu
principal (LCP en secondes) et la stabilité visuelle (CLS). Ils proviennent du test
mobile de laboratoire. Les mesures des visiteurs réels restent séparées dans les
détails. Le temps de réponse du serveur CRM ne remplace aucune de ces mesures.

## Diagnostic approfondi et historique

Le diagnostic de transformation numérique reste consultable dans un volet fermé
par défaut. Les mesures détaillées, contrôles, preuves, pistes et comparaisons
restent accessibles via Détails et mesures / Historique. Les audits historiques
conservent leur contenu ; aucune migration de données ni nouvelle analyse réseau
n’est nécessaire pour lire la nouvelle synthèse d’un audit du moteur v3.

Le PDF commercial utilise la même synthèse. Le PDF technique reste détaillé.
Les règles Fit / Need / Intent, les restrictions et le pipeline ne changent pas.
La prochaine action respecte les restrictions de contact connues.

## Analyse IA et absence de facturation

La synthèse affichée est calculée par le CRM ; elle n’est pas présentée comme une
analyse générative. Le mode Gemini `free-test` et le blocage des analyses réelles
restent inchangés. Aucun compte de facturation n’est activé et aucun appel IA
n’est ajouté au chargement ou à la lecture de l’audit.

Le bouton « Copier le résumé pour une analyse IA » copie un prompt visible dans
le presse-papiers, avec les mesures et les observations synthétiques. L’utilisateur
choisit lui-même de le coller dans son outil IA. Le CRM ne transmet rien à cet
outil et ne garantit pas les conditions tarifaires de l’outil choisi.

Ce texte exclut contacts, emails, téléphones, notes internes, historique des
communications, HTML brut et paramètres de l’URL. Le site est identifié par son
nom d’hôte. Les instructions exigent une réponse courte, distinguent mesures et
hypothèses et interdisent de prétendre avoir visité le site. Le résultat obtenu
hors CRM n’est pas automatiquement enregistré ni utilisé pour contacter un prospect.

Limite explicite : il s’agit d’une aide manuelle à l’analyse IA. L’analyse Gemini
automatique de données réelles sans facturation n’est pas activée par ce changement.

## Vérification

- `npm run build` et suite de tests existante.
- Tests des scores présents, absents, invalides et nuls, des unités, des sites
  rapides et illisibles et du regroupement des priorités.
- Tests des renderers de production : comparaison des appareils, diagnostic
  approfondi fermé, contenu échappé et copie sans requête API.
- Export PDF vérifié par extraction de texte et contrôle visuel d’un exemple
  fictif. Aucune donnée réelle ni quota Google/Gemini consommé par les tests.

La vérification visuelle de l’interface dans le navigateur local reste limitée
par les restrictions de l’environnement ; le renderer est testé automatiquement.
