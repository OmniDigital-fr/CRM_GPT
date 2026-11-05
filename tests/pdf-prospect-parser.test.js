import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {parseProspectPdf} from '../pdf-prospect-parser.js';
import {pdfPageText} from '../pdf-layout.js';
import {extractPdf} from '../crm-server.js';

test('exact supplied GME PDF is text-readable and retains both table cells',async()=>{
 const bytes=readFileSync(new URL('./fixtures/Prospect_001_GME_France_FR.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'5c5cce20d59508fe8e766a281a8b04ddca4e240b051051856fa8f6b262eb4cb4');
 const text=await extractPdf(bytes);
 assert.match(text,/1\. Identification et coordonnées/);
 assert.match(text,/E-mail professionnel\tcontact@gme-france.fr/);
 assert.match(text,/SIREN \/ SIRET\t982 902 884 \/ 982 902 884 00013/);
 const {fields,supplementary,opportunities,warnings}=parseProspectPdf(text);
 assert.deepEqual(fields,{
  legal_name:'GAETAN MARCU ENTREPRISE – G.M.E.',name:'GAETAN MARCU ENTREPRISE – G.M.E.',
  siren:'982902884',siret:'98290288400013',industry:'Travaux d’installation électrique (APE 43.21A)',naf_code:'43.21A',
  address:'1 Route de Maurion',postal_code:'47180',city:'Jusix',country:'France',
  display_name:'Gaëtan Marcu',job_title:'gérant',general_phone:'06 58 85 70 63',general_email:'contact@gme-france.fr',website:'https://gme-france.fr',
  company_size:'Au moins 1 salarié (source commerciale) ; tranche 1 à 4 NON confirmée'
 });
 assert.ok(supplementary.some(item=>item.label==='Situation juridique'&&item.value.includes('confirmation officielle')));
 assert.match(opportunities.join('\n'),/si ces fonctions ne sont pas déjà en place/);
 assert.ok(warnings.length);
 assert.equal(fields.email,undefined);assert.equal(fields.phone,undefined);
 assert.equal(fields.company_status,undefined);assert.equal(fields.opportunity_score,undefined);
});

test('visual row reconstruction ignores drawing order and does not split a fragmented label',()=>{
 const item=(str,x,y,width=40)=>({str,transform:[10,0,0,10,x,y],width,height:10,hasEOL:true});
 const items=[item('contact@test.fr',220,380,90),item('Atelier Test',220,400,80),item('mail',58,380,20),item('Raison sociale',40,400,80),item('E-',40,380,17)];
 assert.equal(pdfPageText(items),'Raison sociale\tAtelier Test\nE-mail\tcontact@test.fr');
 assert.equal(parseProspectPdf(pdfPageText(items)).fields.general_email,'contact@test.fr');
 assert.equal(pdfPageText([item('Nom  Atelier',40,400,100)]),'Nom  Atelier');
});

test('numbered sections, multiline values and contact sections keep general and personal channels apart',()=>{
 const result=parseProspectPdf([
  'I. Identification et coordonnées','Nom commercial : Atelier Test','Raison sociale : ATELIER TEST SAS',
  'Adresse du siège :','10 rue Exemple,','75001 Paris, France','E-mail général : accueil@example.fr',
  'Téléphone général : 0102030405','II. Contact du dirigeant','Prénom : Camille','Nom de famille : Dupont',
  'Fonction : Gérante','Email professionnel : camille@example.fr','Téléphone : 0601020304',
  '3. Opportunités potentielles','Un portail client pourrait être pertinent, à confirmer.',
  '4. Évaluation préliminaire','Score total : 90/100','Email : nepasimporter@example.fr',
  '5. Premier contact','Entreprise : FAUX NOM'
 ].join('\n'));
 assert.equal(result.fields.name,'Atelier Test');assert.equal(result.fields.legal_name,'ATELIER TEST SAS');
 assert.equal(result.fields.general_email,'accueil@example.fr');assert.equal(result.fields.email,'camille@example.fr');
 assert.equal(result.fields.phone,'0601020304');assert.equal(result.fields.general_phone,'0102030405');
 assert.equal(result.fields.display_name,'Camille Dupont');assert.equal(result.fields.city,'Paris');
 assert.deepEqual(result.opportunities,['Un portail client pourrait être pertinent, à confirmer.']);
});

test('labels above values, tabs, narrow variants and direct contact labels are supported',()=>{
 const {fields}=parseProspectPdf('1) Identification\nSociété\nAtelier Test\nSIREN/SIRET :\n982 902 884 / 982 902 884 00013\nSite internet\nwww.example.fr\nDirigeant\nCamille Test — Gérante\nEmail du dirigeant\ncamille@example.fr');
 assert.equal(fields.siret,'98290288400013');assert.equal(fields.website,'https://www.example.fr');
 assert.equal(fields.email,'camille@example.fr');assert.equal(fields.job_title,'Gérante');
});

test('ambiguous values and malformed emails fail before any save; empty labels do not consume another field',()=>{
 for(const text of ['Entreprise : A\nEntreprise : B','Entreprise : A\nEmail du contact : pas-un-email',
  'Entreprise : A\nSIREN : 732829320\nSIREN/SIRET : 982902884 / 98290288400013'])assert.throws(()=>parseProspectPdf(text));
 const {fields}=parseProspectPdf('Entreprise : Atelier\nDirigeant :\nEmail : non trouvé\nTéléphone : inconnu\nSite internet : non disponible');
 assert.deepEqual(fields,{name:'Atelier'});
});

test('generic contact is explicit when only company channels are supplied',()=>{
 const parsed=parseProspectPdf('Entreprise : Atelier\nE-mail professionnel : accueil@example.fr\nTéléphone : 0102030405');
 assert.equal(parsed.fields.general_email,'accueil@example.fr');assert.equal(parsed.fields.email,'accueil@example.fr');
 assert.equal(parsed.fields.display_name,undefined);assert.match(parsed.warnings[0],/contact générique/);
});

test('real column-first PDF and wrapped table values are reconstructed in visual reading order',async()=>{
 const {default:PDFDocument}=await import('pdfkit');const doc=new PDFDocument(),chunks=[];
 doc.on('data',chunk=>chunks.push(chunk));const done=once(doc,'end');
 const labels=['1. Identification et coordonnées','Raison sociale','Adresse','E-mail professionnel','Dirigeant','2. Opportunités potentielles'];
 const positions=[50,85,120,175,210,245];
 labels.forEach((label,index)=>doc.fontSize(10).text(label,40,positions[index]));
 doc.text('Atelier Exemple',260,85);
 doc.text('10 rue Exemple,\n75001 Paris, France',260,120);
 doc.text('contact@example.fr',260,175);doc.text('Camille Test (Gérante)',260,210);
 doc.text('Un espace client pourrait être utile, à confirmer en entretien.',40,275);
 doc.end();await done;
 const parsed=parseProspectPdf(await extractPdf(Buffer.concat(chunks)));
 assert.equal(parsed.fields.name,'Atelier Exemple');assert.equal(parsed.fields.address,'10 rue Exemple');
 assert.equal(parsed.fields.city,'Paris');assert.equal(parsed.fields.general_email,'contact@example.fr');
 assert.equal(parsed.fields.display_name,'Camille Test');assert.equal(parsed.fields.job_title,'Gérante');
 assert.equal(parsed.opportunities.length,1);
});

test('inline opportunities are preserved as hypotheses and cannot override identity fields',()=>{
 const parsed=parseProspectPdf('Entreprise : Atelier\nOpportunité : Portail client à confirmer\nEmail : hypothese@example.fr\n3. Relances\nEntreprise : Autre');
 assert.deepEqual(parsed.fields,{name:'Atelier'});
 assert.match(parsed.opportunities.join('\n'),/Portail client/);
});

test('a plain Nom label in the Contact section cannot overwrite the company identity',()=>{
 const parsed=parseProspectPdf('Entreprise : Atelier\n2. Contact\nNom : Dupont\nPrénom : Camille\nEmail : camille@example.fr');
 assert.equal(parsed.fields.name,'Atelier');assert.equal(parsed.fields.display_name,'Camille Dupont');
 assert.equal(parsed.fields.last_name,'Dupont');assert.equal(parsed.fields.email,'camille@example.fr');
 assert.equal(parseProspectPdf('Entreprise : Atelier\nNom du dirigeant : Camille Dupont').fields.display_name,'Camille Dupont');
 const unnumbered=parseProspectPdf('Entreprise : Atelier\nContact\nNom : Dupont\nPrénom : Camille\nEmail : camille@example.fr');
 assert.equal(unnumbered.fields.name,'Atelier');assert.equal(unnumbered.fields.display_name,'Camille Dupont');
});
