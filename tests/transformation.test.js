import {outgoingHtml} from '../mail-service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransformationDiagnostic,transformationEmail,readOutreachConfig} from '../transformation.js';
import {computeQualification,DEFAULT_SERVICES} from '../qualification-rules.js';
import {AI_INSTRUCTIONS,QUALIFICATION_SCHEMA,buildAiInput,validateAiResult} from '../qualification.js';

const now=Date.parse('2026-11-05T12:00:00Z');
const date='2026-11-05T10:00:00Z';
const company={name:'Entreprise test',industry:'Immobilier',country:'France',company_size:'10',website:'https://example.fr',updated_at:date};
const audit={id:'audit',created_at:date,result:{requestedUrl:'https://example.fr',url:'https://example.fr',execution_status:'completed',controls:[
 {id:'page0-title',label:'Titre de la page',category:'SEO technique',status:'Problème important',evidence:'Titre non détecté.',page_url:'https://example.fr',source:'HTML reçu',observed_at:date}
]}};
test('sector hypotheses never become verified needs and AI is not recommended by default',()=>{
 for(const industry of ['Bâtiment','Commerce','Services aux entreprises','Immobilier','Industrie']){
  const d=buildTransformationDiagnostic({company:{...company,industry},now});
  assert.equal(d.opportunities.length,3);
  assert.ok(d.opportunities.every(item=>item.classification==='Opportunité potentielle'&&item.confidence==='Faible'&&item.questions.length&&item.solution));
  assert.equal(d.recommendations.length,0);
  assert.equal(d.ai.opportunities.length,0);
 }
});
test('missing website, excellent website, problems and old snapshots keep their actual evidence',()=>{
 const none=buildTransformationDiagnostic({company:{name:'Inconnu'},now});
 assert.equal(none.presence.observations.length,0);
 assert.match(none.presence.status,/à confirmer/);
 assert.equal(none.opportunities.length,1);
 const good=buildTransformationDiagnostic({company,audit:{...audit,result:{...audit.result,controls:audit.result.controls.map(row=>({...row,status:'Conforme au contrôle'}))}},now});
 assert.equal(good.presence.observations.length,0);
 const bad=buildTransformationDiagnostic({company,audit,now});
 assert.equal(bad.presence.observations[0].source,'HTML reçu');
 assert.equal(bad.presence.observations[0].date,date);
 assert.equal(bad.recommendations.length,0);
 for(const modified of [{...audit,created_at:'2020-01-01'},{...audit,result:{...audit.result,url:'https://wrong.fr'}}]){
  assert.equal(buildTransformationDiagnostic({company,audit:modified,now}).presence.observations.length,0);
 }
});
test('only a recent documented need can support an IA recommendation, and refusal suppresses outreach',()=>{
 const signal={type:'Besoin confirmé',service_code:'integration-ia',source:'Entretien documenté',evidence:'Besoin de recherche documentaire à étudier.',observed_at:date};
 const d=buildTransformationDiagnostic({company,signals:[signal],now});
 assert.equal(d.ai.opportunities.length,1);
 assert.equal(d.recommendations[0].service_code,'integration-ia');
 const refused=buildTransformationDiagnostic({company,signals:[signal,{type:'Refus explicite',observed_at:'2026-11-05T11:00:00Z'}],now});
 assert.equal(refused.proposed_email,null);
});
test('commercial email uses the new positioning, exact configured form and one signature',()=>{
 const config=readOutreachConfig({OMNI_CONTACT_FORM_URL:'https://omnidigital.fr/contact/'});
 const draft=transformationEmail({company:'Entreprise test',pdf_text:'invented internal process',notes:'fabrication'},{config});
 assert.match(draft.body,/diagnostic de 20 minutes/);
 assert.match(draft.body,/sans engagement/);
 assert.match(draft.body,/transformation numérique/);
 assert.match(draft.body,/https:\/\/omnidigital.fr\/contact\//);
 assert.doesNotMatch(draft.body,/invented|fabrication|refonte/);
 assert.equal((draft.body.match(/\nOmniDigital\n/g)||[]).length,1);
 assert.doesNotMatch(transformationEmail({company:'Test'},{config:{signatureProvided:true}}).body,/\nOmniDigital\n/);
 assert.throws(()=>readOutreachConfig({OMNI_CONTACT_FORM_URL:'https://evil.example/'}));
});
test('Gemini contract separates project and recurring potential without changing deterministic scores',()=>{
 const context={company,audit,catalog:DEFAULT_SERVICES.map(([code,name,description])=>({code,name,description,active:1}))};
 const scores=computeQualification({...context,now});
 const before=JSON.stringify(scores);
 const input=buildAiInput(context,scores);
 assert.ok(QUALIFICATION_SCHEMA.required.includes('project_potential'));
 assert.ok(QUALIFICATION_SCHEMA.required.includes('recurring_potential'));
 assert.match(AI_INSTRUCTIONS,/processus manuel sans preuve/);
 assert.equal(JSON.stringify(scores),before);
 assert.equal(input.scores.fit,scores.fit.score);
 assert.equal(input.scores.need,scores.need.score);
 assert.equal(input.scores.intent,scores.intent.score);
 assert.throws(()=>validateAiResult({summary:'Analyse incomplète'},input));
});


test('configured HTML signature is appended once and legacy default signature is replaced in HTML only',()=>{
 const signature='<p>Signature existante</p>';
 const html=outgoingHtml('Bonjour <script>\n\nOmniDigital\nhttps://omnidigital.fr\n\nStop',signature);
 assert.equal((html.match(/Signature existante/g)||[]).length,1);
 assert.doesNotMatch(html,/OmniDigital|<script>/);
 assert.match(html,/&lt;script&gt;/);
 assert.equal(outgoingHtml('Bonjour',''),undefined);
});

test('reply drafting respects a postponed project instead of asking for an immediate meeting',()=>{
 const reply=transformationEmail({company:'Test',response_scenario:'Projet reporté'},{reply:true});
 assert.match(reply.body,/reprendre le sujet/);
 assert.doesNotMatch(reply.body,/choisir un créneau/);
});
