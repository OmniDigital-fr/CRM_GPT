# Diagnostic de transformation numérique · CRM2

Omni Digital accompagne les entreprises par les applications web et mobiles sur
mesure, l’automatisation des processus métier, l’intégration raisonnée de l’IA et
le conseil technologique. Les contrôles web, SEO et de performance complètent
ce diagnostic.

## Architecture et parcours

transformation.js construit le diagnostic à partir de la fiche entreprise,
du dernier audit v3 attribuable au domaine (moins de 90 jours) et des besoins
confirmés datés (moins de 180 jours). Il produit cinq sections.

1. Présentation de l’entreprise et origine des informations CRM.
2. Présence et outils numériques, avec observations web sourcées et datées.
3. Opportunités de digitalisation, formulées comme hypothèses par activité.
4. Intelligence artificielle, uniquement recommandée sur besoin documenté.
5. Recommandations, questions pour le rendez-vous et prochaines étapes.

audit-engine-server.js, audit-report.js et les vues de qualification réutilisent
ce diagnostic. Les audits enregistrés restent intacts. Les contrôles techniques
et exports internes restent accessibles. Un score web ne décrit pas les outils
internes de l’entreprise.

qualification-rules.js conserve les calculs Fit, Need et Intent existants.
Le catalogue ajoute les applications web, mobiles et l’intégration IA.
L’automatisation et le conseil existent déjà. Ces services nécessitent un besoin
confirmé associé à leur code avant de devenir admissibles à une recommandation
Gemini. Les services web restent disponibles.

Gemini produit séparément l’adéquation, les besoins avec références de preuves,
le potentiel de projet, le potentiel récurrent, les questions de rendez-vous
et les informations manquantes. Le serveur valide le schéma et les preuves.
Les anciennes réponses enregistrées restent consultables.

## Emails et relances

Les nouveaux brouillons proposent un diagnostic de 20 minutes sans engagement.
Le lien de rendez-vous est https://calendar.app.google/d2Cz8bKbXN6zfxsX6.

Un email ciblé peut reprendre une observation HTML explicitement prise en charge
(titre, paramètre mobile, texte alternatif). Un site récent sans un de ces
constats reçoit une invitation neutre. Sans site renseigné, le CRM propose
également un échange neutre. Si un site est renseigné mais son audit inexploitable,
l’utilisateur doit relancer l’audit ou revoir sa fiche.

Les notes libres ne sont pas recopiées comme des constats. Le contenu d’un PDF
n’est pas une source de diagnostic. Les exemples sectoriels sont des questions.

Les relances partagent le sujet initial et évoluent vers une clôture cordiale.
Le message précédent est conservé dans le contexte interne. À l’approbation,
ce contexte est actualisé avec les messages précédents de la séquence.
La réponse, le refus et l’opposition arrêtent le parcours existant.
Les délais, approbations et confirmations individuelles restent obligatoires.

Les brouillons déjà enregistrés ne sont pas réécrits. Ils doivent être revus
ou annulés manuellement avant de préparer de nouveaux messages.

## Configuration Hostinger

Aucune nouvelle dépendance ni migration destructive.

- OMNI_CONTACT_FORM_URL est facultative. Renseigner l’adresse HTTPS exacte du
  formulaire sur omnidigital.fr ou www.omnidigital.fr. Une valeur vide retire
  cette alternative. Le programme ne devine pas le chemin.
- MAIL_SIGNATURE_HTML est facultative. Le CRM2 utilisait une signature texte.
  Pour réutiliser une signature HTML existante, la renseigner sur le serveur.
  Elle est ajoutée une seule fois. La signature texte standard des anciens
  brouillons est remplacée uniquement dans leur rendu HTML.
- Les paramètres Gemini, le régime de données et les plafonds restent applicables.

Déployer après validation. Tester le rendu d’un email dans une boîte interne
et approuver chaque envoi réel.

## Exemples de résultats attendus

Ces cas sont fictifs et illustrent les règles.

### Entreprise du bâtiment sans site renseigné

Présence web à confirmer. Pistes potentielles sur les demandes, les interventions
et les échanges entre outils. Aucun processus manuel présumé. Aucune solution
IA recommandée. Aucun score web artificiel.

### Commerce avec site performant

Les contrôles satisfaits restent dans le rapport technique. Aucun problème
supplémentaire n’est inventé pour remplir le diagnostic. Les commandes et la
relation client sont des sujets de discussion. Les outils internes et le
périmètre du projet restent à confirmer.

### Services B2B avec besoin documenté de recherche documentaire

Un besoin confirmé, daté et associé au service integration-ia permet une piste IA.
Il faut préciser les documents, les droits, les utilisateurs, le contrôle des
réponses et les alternatives classiques. Aucun gain ou revenu récurrent n’est
annoncé sans données déclarées.

## Vérification et limites

Les tests couvrent les secteurs, l’absence de site, les contrôles satisfaits,
les problèmes web, les données périmées et domaines contradictoires, les besoins
confirmés, le refus, les scores, le contrat Gemini, les emails et la signature.

Le moteur lit un échantillon de pages publiques. Il ne connaît pas les logiciels
internes, les budgets ou les intentions d’achat sans information documentée.
Gemini est testé avec des réponses simulées et dépend du régime configuré.

## Exemple d’email initial

Objet — Entreprise exemple — échange sur vos outils numériques

Bonjour,

Je vous contacte au sujet de votre entreprise. Omni Digital accompagne les
entreprises dans leur transformation numérique, avec des applications sur mesure,
des échanges entre logiciels et des solutions d’IA lorsque leur usage est pertinent.

Je vous propose de faire le point sur vos outils et vos priorités, pour voir si
une amélioration concrète serait utile à votre activité.

Seriez-vous disponible pour un diagnostic de 20 minutes, sans engagement ?
Vous pouvez me répondre ou choisir un créneau :
https://calendar.app.google/d2Cz8bKbXN6zfxsX6

La signature configurée et la mention d’opposition complètent le message.

## Fichiers concernés

| Fichiers | Rôle |
| --- | --- |
| transformation.js | Diagnostic partagé, pistes sectorielles, invitations, emails et options |
| qualification-rules.js, qualification.js | Catalogue complémentaire, instructions Gemini, contrat JSON et vues |
| audit-engine-server.js, audit-report.js | Diagnostic joint aux audits et export PDF |
| crm-server.js, guided-outreach.js | Génération des brouillons aux points d’entrée existants |
| outreach.js, mail-service.js | Relances, contexte d’approbation et signature HTML |
| static/digital-audit-ui.js, static/qualification-ui.js | Diagnostic, recommandations et questions |
| static/app.js, static/entities-ui.js | Libellés et parcours de préparation |
| .env.example, package.json | Options serveur et validation syntaxique |
| tests/transformation.test.js | Scénarios du nouveau positionnement |
| tests/digital-audit.test.js, tests/qualification.test.js, tests/qualification-ui.test.js, tests/prospect-discovery.test.js, tests/server.test.js | Régressions des rapports, Gemini, écrans, imports et emails |
