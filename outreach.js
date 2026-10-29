import {randomUUID} from 'node:crypto';
import {assertDraftAllowed,history,suppress,isOpposed,suppressed,SCENARIOS,PolicyError} from './contact-policy.js';
const id=()=>randomUUID().replaceAll('-','');
const date=()=>new Date().toISOString();
const plusWeek=stamp=>new Date(Date.parse(stamp)+7*86400000).toISOString();
export function initOutreach(db){
 const cols=new Set(db.prepare('PRAGMA table_info(messages)').all().map(c=>c.name));
 const additions={sequence_id:"TEXT NOT NULL DEFAULT ''",sequence_stage:'INTEGER NOT NULL DEFAULT -1',due_at:"TEXT NOT NULL DEFAULT ''",forecast_at:"TEXT NOT NULL DEFAULT ''",approved_at:"TEXT NOT NULL DEFAULT ''",sent_at:"TEXT NOT NULL DEFAULT ''",source_reply_id:"TEXT NOT NULL DEFAULT ''",approved_recipient:"TEXT NOT NULL DEFAULT ''"};
 for(const [key,definition]of Object.entries(additions))if(!cols.has(key))db.exec(`ALTER TABLE messages ADD COLUMN ${key} ${definition}`);
 db.exec(`CREATE TABLE IF NOT EXISTS outreach_sequences(id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS prospect_replies(id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL,body TEXT NOT NULL,scenario TEXT NOT NULL,created TEXT NOT NULL);`);
}
export function stopOutreach(db,prospectId,reason='Réponse reçue'){
 db.prepare("UPDATE outreach_sequences SET state='En pause' WHERE prospect_id=? AND state='Active'").run(prospectId);
 db.prepare("UPDATE messages SET status='Annulé',approved_at='' WHERE prospect_id=? AND status IN ('Brouillon','Approuvé')").run(prospectId);
 history(db,prospectId,'Séquence en pause',reason);
}
export function createSequence(db,p,draft){
 assertDraftAllowed(db,p);
 if(db.prepare("SELECT id FROM outreach_sequences WHERE prospect_id=? AND state IN ('Active','En pause')").get(p.id))throw new PolicyError('Une séquence existe déjà pour ce contact. Consultez-la dans Emails.',409);
 const sequenceId=id(),created=date();db.prepare('INSERT INTO outreach_sequences VALUES(?,?,?,?)').run(sequenceId,p.id,'Active',created);
 const first=draft(p),base=`Bonjour${p.contact_name?' '+p.contact_name:''},\n\n`;
 const bodies=[first.body,
  base+`Je me permets de revenir vers vous au sujet de mon message concernant ${p.company}. Souhaitez-vous recevoir les points relevés sur votre présence en ligne ou en discuter lors d’un court échange ?`,
  base+'Je reviens une dernière fois sur les pistes évoquées. Si le sujet est pertinent pour vous, nous pouvons commencer par clarifier votre priorité et les actions utiles à votre activité.',
  base+'Sans retour de votre part, je clôture cette prise de contact et ne prévois plus de relance pour cette démarche. Vous pourrez nous recontacter si le sujet devient pertinent. Bonne continuation.'
 ];
 for(let stage=0;stage<4;stage++){
  const body=stage?bodies[stage]+'\n\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus être contacté, répondez simplement « stop ».':bodies[stage];
  const subject=stage===0?first.subject:stage===3?`Dernier message de ma part — ${p.company}`:`Re : ${first.subject}`;
  db.prepare('INSERT INTO messages(id,prospect_id,subject,body,created,sequence_id,sequence_stage,due_at,forecast_at,internal_context) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(),p.id,subject,body,created,sequenceId,stage,stage===0?created:'',new Date(Date.parse(created)+stage*7*86400000).toISOString(),first.context||'');
 }
 history(db,p.id,'Séquence préparée','Email initial + relances à J+7, J+14 et J+21 à titre indicatif. Chaque relance attend l’envoi confirmé de la précédente et une approbation individuelle.');
 return sequenceId;
}
export function stripQuotedReply(body){
 const lines=String(body||'').replace(/\r/g,'').split('\n'),result=[];
 for(const line of lines){
  if(/^\s*(?:On .+wrote:|Le .+(?:écrit|ecrit)\s*:|[-_]{3,}.*(?:Original|Message)|From:|De\s*:)/i.test(line))break;
  if(/^\s*>/.test(line))continue;
  result.push(line);
 }
 return result.join('\n').trim();
}
export function classifyReply(text){
 const s=stripQuotedReply(text).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 if(/ne pas.*(?:contact|sollicit)|ne (?:souhaite|souhaitons) (?:pas|plus).*contact|cessez.*(?:contact|sollicit)|remove me|ne\s+(?:me\s+|nous\s+)?(?:contactez|contacter|sollicitez|solliciter).*plus|ne plus.*(?:contact|sollicit)|desinscri|unsubscribe|do not contact|\bstop\b|retirez.*(?:liste|coordonnees)|supprim.*(?:donnees|coordonnees)|nao.*(?:contact|contat|prospect)/.test(s))return 'Ne plus être contacté';
 if(/pas interesse|pas interesses|not interested|nao.*interess|refus.*offre/.test(s))return 'Pas intéressé / offre refusée';
 if(/absent|conges|out of office|reponse automatique/.test(s))return 'Autre';
 if(/pas.*budget|aucun.*budget|trop cher|sem orcamento/.test(s))return 'Pas de budget';
 if(/deja.*(?:prestataire|agence)|already.*provider/.test(s))return 'Déjà un prestataire';
 if(/plus tard|pas maintenant|rappel|prochain mois|mais tarde/.test(s))return 'Pas maintenant / rappeler plus tard';
 if(/tarif|devis|prix|combien|orcamento|price/.test(s))return 'Demande de devis / tarifs';
 if(/rendez.vous|creneau|disponib|appointment|reuniao/.test(s))return 'Demande de rendez-vous';
 if(/interess|avec plaisir|oui|yes/.test(s))return 'Réponse positive';
 if(/information|en savoir plus|proposez|details/.test(s))return 'Demande d’informations';
 return 'Autre';
}
const scenarioStatus={'Réponse positive':'Intéressé','Demande d’informations':'Contacté','Demande de rendez-vous':'Rendez-vous','Demande de devis / tarifs':'Intéressé','Pas maintenant / rappeler plus tard':'À recontacter','Pas de budget':'À recontacter','Déjà un prestataire':'À recontacter','Pas intéressé / offre refusée':'Pas intéressé','Ne plus être contacté':'Opposition','Demande de suppression des données':'Opposition','Entreprise fermée':'Perdu','Projet reporté':'À recontacter'};
export function registerReply(db,p,body,scenario,draft,options={}){
 if(typeof body!=='string'||!body.trim()||body.length>20000)throw new PolicyError('Saisissez une réponse client, 20 000 caractères maximum.');
 if(scenario&&!SCENARIOS.includes(scenario))throw new PolicyError('Scénario invalide.');
 const detected=classifyReply(body);
 // An explicit opt-out always wins over a more permissive manual classification.
 const chosen=detected==='Ne plus être contacté'?detected:scenario||detected;
 const replyId=id(),created=date();
 db.prepare('INSERT INTO prospect_replies VALUES(?,?,?,?,?)').run(replyId,p.id,body,chosen,created);
 stopOutreach(db,p.id,'Réponse client enregistrée ; toutes les approbations en attente sont annulées.');
 const stage=isOpposed(p)?'Opposition':scenarioStatus[chosen]||p.status;
 db.prepare('UPDATE prospects SET response_scenario=?,response_details=?,last_response_date=?,status=?,next_followup=? WHERE id=?').run(chosen,body,created.slice(0,10),stage,'',p.id);
 const updated=db.prepare('SELECT * FROM prospects WHERE id=?').get(p.id);
 if(stage==='Opposition')suppress(db,updated);
 history(db,p.id,'Réponse client enregistrée',chosen+'\n'+body);
 let messageId=null;
 if(options.prepareDraft!==false&&!['Opposition','Pas intéressé','Perdu'].includes(stage)&&updated.do_not_email!=='Oui'&&!suppressed(db,updated)){
  assertDraftAllowed(db,updated);
  const reply=draft(updated);
  messageId=id();db.prepare('INSERT INTO messages(id,prospect_id,subject,body,created,source_reply_id,internal_context) VALUES(?,?,?,?,?,?,?)').run(messageId,p.id,'Re : '+reply.subject,reply.body,created,replyId,reply.context||'');
 }
 return {replyId,scenario:chosen,suggested:detected,messageId,classification:'Règles de mots-clés, à vérifier manuellement. Aucun modèle IA ni messagerie connectée.'};
}
export function messageAction(db,p,m,action,data){
 if(action==='update'){
  if(!['Brouillon','Approuvé'].includes(m.status))throw new PolicyError('Ce message n’est plus modifiable.');
  if(typeof data.subject!=='string'||!data.subject.trim()||typeof data.body!=='string'||!data.body.trim()||data.subject.length>500||data.body.length>20000)throw new PolicyError('Objet et texte requis (500 / 20 000 caractères maximum).');
  assertDraftAllowed(db,p);
  db.prepare("UPDATE messages SET subject=?,body=?,status='Brouillon',approved_at='' WHERE id=?").run(data.subject.trim(),data.body.trim(),m.id);
  history(db,p.id,'Brouillon modifié','L’approbation précédente, le cas échéant, est révoquée.');return;
 }
 if(action==='approve'){
  assertDraftAllowed(db,p);
  if(!p.email||!p.email.includes('@'))throw new PolicyError('Renseignez l’adresse email du contact avant d’approuver ce mail.');
  if(m.status!=='Brouillon')throw new PolicyError('Seul un brouillon actif peut être approuvé.');
  if(data.confirm!==m.id)throw new PolicyError('Confirmation individuelle requise.');
  db.prepare("UPDATE messages SET status='Approuvé',approved_at=?,approved_recipient=? WHERE id=?").run(date(),p.email.trim().toLowerCase(),m.id);
  history(db,p.id,'Email approuvé',m.subject+' · Approbation enregistrée, aucun envoi effectué.');return;
 }
 if(action==='record-sent'){
  assertDraftAllowed(db,p);
  if(m.status!=='Approuvé'||data.confirm!==m.id)throw new PolicyError('Approuvez ce mail avant de confirmer son envoi manuel.');
  if(m.approved_recipient!==String(p.email||'').trim().toLowerCase())throw new PolicyError('Le destinataire a changé : une nouvelle approbation est requise.');
  const sentAt=date();
  if(m.sequence_id){
   const seq=db.prepare('SELECT * FROM outreach_sequences WHERE id=?').get(m.sequence_id);
   if(seq?.state!=='Active')throw new PolicyError('Séquence en pause.');
   if(m.sequence_stage>0){
    const previous=db.prepare('SELECT * FROM messages WHERE sequence_id=? AND sequence_stage=?').get(m.sequence_id,m.sequence_stage-1);
    if(!previous?.sent_at||Date.parse(sentAt)<Date.parse(plusWeek(previous.sent_at)))throw new PolicyError('Attendez 7 jours après l’envoi confirmé du message précédent.');
   }
  }
  db.prepare("UPDATE messages SET status='Envoyé',sent_at=? WHERE id=?").run(sentAt,m.id);
  if(m.sequence_id){
   db.prepare('UPDATE messages SET due_at=? WHERE sequence_id=? AND sequence_stage=?').run(plusWeek(sentAt),m.sequence_id,m.sequence_stage+1);
   if(m.sequence_stage===3)db.prepare("UPDATE outreach_sequences SET state='Terminée' WHERE id=?").run(m.sequence_id);
  }
  db.prepare("UPDATE prospects SET last_contact_date=?,status=CASE WHEN status IN ('Nouveau','À qualifier','Qualifié','Sans email') THEN 'Contacté' ELSE status END WHERE id=?").run(sentAt.slice(0,10),p.id);
  history(db,p.id,'Envoi manuel déclaré',m.subject+' · Déclaration utilisateur ; aucun email transmis par le CRM.');return;
 }
 throw new PolicyError('Action inconnue.',404);
}
