# Import des fiches prospects PDF

## Cause reproduite

Le PDF fourni `Prospect_001_GME_France_FR.pdf` est valide et contient du texte.
L’ancienne prévisualisation renvoyait HTTP 200 mais perdait l’email professionnel
et le siège, conservait « (gérant) » dans le nom et attribuait le téléphone général
au dirigeant. Ce n’était donc pas un PDF scanné nécessitant un OCR.

Le fichier exact est conservé dans `tests/fixtures/` avec le SHA-256 :
`5c5cce20d59508fe8e766a281a8b04ddca4e240b051051856fa8f6b262eb4cb4`.

## Extraction et validation

- `pdf-layout.js` reconstruit les lignes par coordonnées Y et les cellules par X,
  indépendamment de l’ordre de dessin du PDF. Les fragments d’un même libellé
  restent joints ; les vrais espaces de colonne deviennent des tabulations.
- `pdf-prospect-parser.js` reconnaît les libellés et suit les sections : entreprise,
  contact, opportunités, sources ou analyse ignorée. Il accepte les titres numérotés,
  les valeurs sous leur libellé, les tableaux à deux colonnes et les valeurs repliées.
- SIREN/SIRET combinés ou séparés, cohérence des identifiants, emails et URL sont
  contrôlés avant la prévisualisation. Les valeurs contradictoires sont rejetées.
- Le nom commercial et la raison sociale sont conservés séparément s’ils figurent
  tous deux dans le PDF. Le CRM ne déduit pas arbitrairement prénom et nom à partir
  d’un nom complet.

Extrait réel de pdfjs-dist après reconstruction (séparateur de colonne : TAB) :

```text
Raison sociale<TAB>GAETAN MARCU ENTREPRISE – G.M.E.
SIREN / SIRET<TAB>982 902 884 / 982 902 884 00013
Siège<TAB>1 Route de Maurion, 47180 Jusix, France
Dirigeant<TAB>Gaëtan Marcu (gérant)
E-mail professionnel<TAB>contact@gme-france.fr
```

## Destination et fiabilité

| Élément du document exact | Destination |
| --- | --- |
| Raison sociale, SIREN/SIRET, activité, APE, siège, site, effectif avec ses réserves | Entreprise |
| Email professionnel général et téléphone sans attribution personnelle | Entreprise : email et téléphone généraux |
| Gaëtan Marcu, gérant | Contact : nom affiché et fonction ; email et téléphone directs vides |
| Forme juridique, situation juridique assortie de réserves, sources | Historique entreprise : « Informations PDF à vérifier » |
| Automatisation, IA, conseil envisagés | Historique entreprise : « Hypothèses PDF à confirmer » |
| Audit, score préliminaire, premier email et relances du PDF | Ignorés pour la qualification et les communications du CRM |

Un libellé explicitement personnel ou une section Contact permet d’importer les
coordonnées du dirigeant. Si seul un canal général est fourni sans personne
identifiée, un contact générique est créé et signalé dans l’aperçu. Avec un
dirigeant identifié, les coordonnées générales ne lui sont pas attribuées :
utiliser le canal général nécessite un contact générique distinct ou une
attribution personnelle documentée.

La validation de l’import ne prouve pas que les informations sont exactes.
La situation juridique n’est pas automatiquement marquée Active. Les hypothèses
ne sont ni des besoins observés, ni des signaux d’intention, ni des recommandations
validées et ne sont pas envoyées à Gemini. Le diagnostic du CRM reste autonome.

## Aperçu et répétition

L’aperçu affiche tous les champs, même inchangés, leur destination, les champs
absents, les informations complémentaires et les hypothèses. Chaque conflit
exige de choisir la valeur CRM ou PDF. Un aperçu périmé ou devenu incohérent après
une modification du CRM est refusé. Aucun enregistrement avant confirmation.

Le rapprochement utilise SIREN, nom d’entreprise et identité/contact existant.
Les oppositions restent bloquantes, y compris celles sur un canal général.
La réimportation du fichier exact ne crée aucun doublon dans les entreprises,
contacts, prospects ou historiques ; un jeton confirmé ne peut pas être réutilisé.
Les analyses et anciens audits restent inchangés. Aucun envoi automatique.

## Vérification et limites

`npm run build` et `npm test` vérifient les modules et les parcours existants.
Les nouveaux tests utilisent le PDF exact et des PDF de test avec colonnes dessinées
dans un ordre différent, fragments de libellés et valeurs sur plusieurs lignes.
Le rendu de l’aperçu est testé avec les fonctions de production et contrôle de
l’échappement HTML. Pas de vérification visuelle dans le navigateur local :
l’environnement refuse l’ouverture des fichiers locaux.

Pas d’OCR ajouté : les scans sans texte nécessitent toujours un OCR externe.
Une fiche doit décrire une seule entreprise et un seul contact nommé ; plusieurs
valeurs incompatibles sont refusées. Les mises en page fortement graphiques,
rotations ou colonnes imbriquées peuvent nécessiter une fiche plus simple.
L’ancien endpoint `/api/import-pdf` est conservé pour compatibilité ; le parcours
de l’interface utilise `/api/pdf-contacts/preview` puis `/confirm`.

Aucune dépendance ajoutée, aucune migration destructive. Aucun changement du CRM
historique, aucune fusion ni mise en production dans cette correction.
