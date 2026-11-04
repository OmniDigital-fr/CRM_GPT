import {relatedCommercial} from './commercial.js';
import {randomUUID} from 'node:crypto';
import {CONTACT_STATUSES,PolicyError,suppressed,suppress,history,isOpposed,rememberSuppression} from './contact-policy.js';
import {stopOutreach,deleteProspectData} from './outreach.js';
import {auditWebsite} from './site-audit.js';
export class EntityError extends Error { constructor(message,status=400){super(message);this.status=status} }
const id=()=>randomUUID().replaceAll('-','');
const now=()=>new Date().toISOString();
const normalize=v=>String(v||'').normalize('NFKD').toLowerCase().replace(/ß/g,'ss').replace(/[^\p{L}\p{N}]/gu,'');
export const COMPANY_FIELDS='name legal_name siren siret industry naf_code company_size company_status address postal_code city region country website linkedin_url google_business_url general_email general_phone source source_url collected_at business_status priority opportunity_score score_reason observed_needs recommended_services budget_range budget_kind current_provider next_action next_action_at notes owner_id information_status verification_notes'.split(' ');
export const CONTACT_FIELDS='company_id first_name last_name display_name job_title department decision_role preferred_language email phone mobile linkedin_url preferred_channel email_verified_status contact_status last_contact_at last_reply_at next_followup_at contact_notes contact_owner_id contact_source source_url collected_at lawful_basis email_opt_out phone_opt_out opt_out_at opt_out_reason retention_review_at information_status verification_notes'.split(' ');
export const CHOICES={information_status:['À vérifier','Vérifié','Estimé','Produit par IA'],company_status:['À vérifier','Active','Fermée'],business_status:CONTACT_STATUSES,priority:['Faible','Moyenne','Haute'],budget_kind:['Inconnu','Estimé','Déclaré'],decision_role:['Inconnu','Décideur','Influenceur','Utilisateur'],preferred_channel:['Email','Téléphone','SMS','Aucun'],email_verified_status:['Non vérifié','Valide','Invalide'],contact_status:CONTACT_STATUSES};
export function initEntities(db){
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,${COMPANY_FIELDS.map(f=>f==='opportunity_score'?'opportunity_score INTEGER CHECK(opportunity_score BETWEEN 0 AND 100)':`${f} TEXT NOT NULL DEFAULT ''`).join(',')},audit_status TEXT NOT NULL DEFAULT 'Non réalisé',last_audit_at TEXT NOT NULL DEFAULT '',audit_summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS companies_siren ON companies(siren) WHERE siren<>'';
 CREATE INDEX IF NOT EXISTS companies_name ON companies(name);
 CREATE INDEX IF NOT EXISTS companies_followup ON companies(next_action_at);
 CREATE INDEX IF NOT EXISTS companies_status ON companies(business_status,priority);
 CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE RESTRICT,${CONTACT_FIELDS.map(f=>f==='company_id'?'company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT':['email_opt_out','phone_opt_out'].includes(f)?`${f} INTEGER NOT NULL DEFAULT 0 CHECK(${f} IN (0,1))`:`${f} TEXT NOT NULL DEFAULT ''`).join(',')},created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS contacts_company ON contacts(company_id);
 CREATE INDEX IF NOT EXISTS contacts_email ON contacts(email COLLATE NOCASE);
 CREATE INDEX IF NOT EXISTS contacts_followup ON contacts(next_followup_at);
 CREATE TABLE IF NOT EXISTS audits(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,contact_id TEXT REFERENCES contacts(id) ON DELETE RESTRICT,payload TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS audits_company ON audits(company_id,created_at);
 CREATE TABLE IF NOT EXISTS interactions(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,contact_id TEXT REFERENCES contacts(id) ON DELETE RESTRICT,kind TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS interactions_company ON interactions(company_id,created_at);
 CREATE INDEX IF NOT EXISTS interactions_contact ON interactions(contact_id,created_at);
 CREATE TRIGGER IF NOT EXISTS entity_policy_guard BEFORE UPDATE ON prospects WHEN EXISTS(SELECT 1 FROM contacts c WHERE c.prospect_id=OLD.id AND ((c.email_opt_out=1 AND NEW.do_not_email<>'Oui' AND NEW.status<>'Opposition') OR (c.phone_opt_out=1 AND NEW.do_not_call<>'Oui' AND NEW.status<>'Opposition') OR (c.contact_status='Opposition' AND NEW.status<>'Opposition'))) BEGIN SELECT RAISE(ABORT,'Opposition active'); END;
 CREATE TRIGGER IF NOT EXISTS entity_prospect_sync AFTER UPDATE ON prospects BEGIN
 UPDATE contacts SET contact_status=NEW.status,last_contact_at=NEW.last_contact_date,last_reply_at=NEW.last_response_date,next_followup_at=NEW.next_followup,email_opt_out=CASE WHEN NEW.do_not_email='Oui' OR NEW.status='Opposition' THEN 1 ELSE email_opt_out END,phone_opt_out=CASE WHEN NEW.do_not_call='Oui' OR NEW.status='Opposition' THEN 1 ELSE phone_opt_out END,opt_out_at=CASE WHEN opt_out_at='' THEN NEW.opposition_date ELSE opt_out_at END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE prospect_id=NEW.id;
 END;
 CREATE TRIGGER IF NOT EXISTS entity_history_sync AFTER INSERT ON contact_history BEGIN
 INSERT OR IGNORE INTO interactions SELECT NEW.id,c.company_id,c.id,NEW.kind,NEW.detail,NEW.created FROM contacts c WHERE c.prospect_id=NEW.prospect_id;
 END;
 CREATE TRIGGER IF NOT EXISTS entity_audit_sync AFTER INSERT ON site_audits BEGIN
 INSERT OR IGNORE INTO audits SELECT NEW.id,c.company_id,c.id,NEW.payload,'Contrôle automatisé',NEW.created FROM contacts c WHERE c.prospect_id=NEW.prospect_id;
 UPDATE companies SET audit_status='Réalisé',last_audit_at=NEW.created,audit_summary='Audit du contact disponible dans l’historique',updated_at=NEW.created WHERE id IN(SELECT company_id FROM contacts WHERE prospect_id=NEW.prospect_id);
 END;`);
}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
function get(db,table,key){const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);if(!row)throw new EntityError('Fiche introuvable.',404);return row}
function input(fields,data,before={}){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new EntityError('Données invalides.');
 const v={};for(const f of fields){const raw=Object.hasOwn(data,f)?data[f]:before[f]??'';if(['email_opt_out','phone_opt_out'].includes(f)){if(![true,false,0,1].includes(raw)&&raw!=='')throw new EntityError('Préférence invalide.');v[f]=Number(!!raw)}else if(f==='opportunity_score'){if(raw===''||raw===null)v[f]=null;else{v[f]=Number(raw);if(!Number.isInteger(v[f])||v[f]<0||v[f]>100)throw new EntityError('Le score doit être compris entre 0 et 100.')}}else{if(typeof raw!=='string')throw new EntityError('Champ invalide : '+f);v[f]=raw.trim();if(v[f].length>20000)throw new EntityError('Champ trop long : '+f)}}
 for(const f of ['email','general_email'])if(v[f]){v[f]=v[f].toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v[f]))throw new EntityError('Email invalide.');}
 for(const f of ['website','linkedin_url','google_business_url','source_url'])if(v[f]){try{const u=new URL(v[f]);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error()}catch{throw new EntityError('URL invalide : '+f)}}
 for(const f of fields.filter(f=>f.endsWith('_at')))if(v[f]){if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?$/.test(v[f])||!Number.isFinite(Date.parse(v[f]))||new Date(v[f]).toISOString().slice(0,10)!==v[f].slice(0,10))throw new EntityError('Date invalide : '+f)}
 for(const [f,options]of Object.entries(CHOICES))if(v[f]&&!options.includes(v[f]))throw new EntityError('Valeur invalide : '+f);
 return v;
}
export function validFrenchId(value){let sum=0;for(let i=value.length-1,j=0;i>=0;i--,j++){let n=Number(value[i]);if(j%2)n*=2;sum+=n>9?n-9:n}return sum%10===0}
export function validateFrenchCompanyIds(v){
 for(const [f,len]of [['siren',9],['siret',14]])if(v[f]){v[f]=v[f].replace(/\s/g,'');if(!new RegExp(`^\\d{${len}}$`).test(v[f])||/^0+$/.test(v[f])||!(f==='siret'&&v[f].startsWith('356000000')?[...v[f]].reduce((s,n)=>s+Number(n),0)%5===0:validFrenchId(v[f])))throw new EntityError(f.toUpperCase()+' invalide.');}
 if(v.siret){if(v.siren&&v.siret.slice(0,9)!==v.siren)throw new EntityError('Le SIRET ne correspond pas au SIREN.');v.siren=v.siret.slice(0,9);if(!validFrenchId(v.siren))throw new EntityError('SIREN invalide.');}
}
function write(db,table,fields,v,key,before){const date=now();if(before)db.prepare(`UPDATE ${table} SET ${fields.map(f=>f+'=?').join(',')},updated_at=? WHERE id=?`).run(...fields.map(f=>v[f]),date,key);else db.prepare(`INSERT INTO ${table}(id,${fields.join(',')},created_at,updated_at) VALUES(${Array(fields.length+3).fill('?').join(',')})`).run(key,...fields.map(f=>v[f]),date,date)}
function log(db,company,contact,kind,detail=''){db.prepare('INSERT INTO interactions VALUES(?,?,?,?,?,?)').run(id(),company,contact,kind,detail,now())}
const websiteKey=v=>{try{return new URL(v).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
function possible(db,v,key){return db.prepare('SELECT id,name,website FROM companies WHERE id<>?').all(key).filter(c=>normalize(c.name)===normalize(v.name)||(websiteKey(v.website)&&websiteKey(c.website)===websiteKey(v.website)))}
function projection(company,c){return {company:company.name,email:c.email,website:company.website,contact_name:c.display_name,job_title:c.job_title,phone:c.phone,mobile:c.mobile,address:company.address,postal_code:company.postal_code,city:company.city,country:company.country,siren:company.siren,industry:company.industry,notes:c.contact_notes,source:c.contact_source,source_date:c.collected_at.slice(0,10),priority:company.priority,next_followup:c.next_followup_at,needs:company.observed_needs,services:company.recommended_services,assigned_to:c.contact_owner_id,budget_range:company.budget_range,next_action:company.next_action,competitor:company.current_provider,preferred_channel:c.preferred_channel,decision_role:c.decision_role==='Influenceur'?'Prescripteur':c.decision_role==='Inconnu'?'À identifier':c.decision_role,status:c.contact_status,do_not_email:c.email_opt_out?'Oui':'Non',do_not_call:c.phone_opt_out?'Oui':'Non',last_contact_date:c.last_contact_at,last_response_date:c.last_reply_at};}
function sync(db,company,c){
 const v=projection(company,c);const fields=Object.keys(v);db.prepare(`UPDATE prospects SET ${fields.map(f=>f+'=?').join(',')} WHERE id=?`).run(...Object.values(v),c.prospect_id);
 if(c.contact_status==='Opposition')suppress(db,db.prepare('SELECT * FROM prospects WHERE id=?').get(c.prospect_id));
 if(c.email_opt_out||['Pas intéressé','Perdu'].includes(c.contact_status))stopOutreach(db,c.prospect_id,'Restriction ou clôture du contact.');
 db.prepare("UPDATE messages SET status='Brouillon',approved_at='',approved_recipient='' WHERE prospect_id=? AND status='Approuvé'").run(c.prospect_id);
}
export function restrictedIdentity(db,p,exclude=''){
 const email=String(p.email||'').trim().toLowerCase(),phones=[p.phone,p.mobile].map(v=>String(v||'').replace(/\D/g,'')).filter(Boolean);
 return db.prepare('SELECT * FROM contacts WHERE id<>? AND (email_opt_out=1 OR phone_opt_out=1)').all(exclude).some(c=>(c.email_opt_out&&email&&c.email.toLowerCase()===email)||(c.phone_opt_out&&[c.phone,c.mobile].some(v=>phones.includes(String(v||'').replace(/\D/g,'')))));
}
function deleteEntityContact(db,key,confirm){
 if(confirm!==key)throw new EntityError('Confirmation de suppression requise.');
 const contact=get(db,'contacts',key);
 const prospect=get(db,'prospects',contact.prospect_id);
 if(db.prepare("SELECT 1 FROM messages WHERE prospect_id=? AND status IN ('Envoi en cours','À vérifier')").get(prospect.id))
  throw new EntityError('Attendez la fin de l’envoi ou vérifiez sa livraison avant de supprimer ce contact.',409);
 const opposed=isOpposed(prospect)||contact.contact_status==='Opposition';
 const phoneOpposed=opposed||contact.phone_opt_out||prospect.do_not_call==='Oui'||prospect.do_not_sms==='Oui';
 rememberSuppression(db,{id:prospect.id,email:opposed||contact.email_opt_out||prospect.do_not_email==='Oui'?contact.email:'',
  phone:phoneOpposed?contact.phone:'',mobile:phoneOpposed?contact.mobile:''});
 for(const table of ['audits','opportunities','commercial_tasks','commercial_events'])
  db.prepare(`UPDATE ${table} SET contact_id=NULL WHERE contact_id=?`).run(key);
 db.prepare('DELETE FROM interactions WHERE contact_id=?').run(key);
 db.prepare('DELETE FROM contacts WHERE id=?').run(key);
 deleteProspectData(db,prospect.id);
 log(db,contact.company_id,null,'Contact supprimé');
 return {company_id:contact.company_id};
}
function deleteCompany(db,key,confirm){
 if(confirm!==key)throw new EntityError('Confirmation de suppression requise.');
 const company=get(db,'companies',key);
 if(db.prepare('SELECT 1 FROM contacts WHERE company_id=?').get(key))
  throw new EntityError('Cette entreprise a des contacts. Supprimez-les individuellement avant de supprimer l’entreprise.',409);
 if(db.prepare('SELECT 1 FROM opportunities WHERE company_id=? UNION ALL SELECT 1 FROM commercial_tasks WHERE company_id=? LIMIT 1').get(key,key))
  throw new EntityError('Cette entreprise est liée à des opportunités ou à des tâches. La suppression est bloquée pour préserver le suivi commercial.',409);
 if(db.prepare("SELECT 1 FROM digital_audit_jobs WHERE company_id=? AND state IN ('queued','running') UNION ALL SELECT 1 FROM qualifications WHERE company_id=? AND state='running' LIMIT 1").get(key,key))
  throw new EntityError('Un audit ou une qualification est en cours. Réessayez après sa fin.',409);
 if(company.business_status==='Opposition')rememberSuppression(db,{id:key,company:company.name});
 db.prepare('DELETE FROM qualification_usage WHERE id IN (SELECT id FROM qualifications WHERE company_id=?)').run(key);
 for(const table of ['qualifications','qualification_signals','qualification_manual','qualification_decisions',
  'digital_audit_jobs','audits','interactions','commercial_events'])
  db.prepare(`DELETE FROM ${table} WHERE company_id=?`).run(key);
 db.prepare("UPDATE discovery_candidates SET imported_id=NULL,decision='rejected' WHERE imported_id=?").run(key);
 db.prepare('DELETE FROM companies WHERE id=?').run(key);
 return {ok:true};
}
export function mountEntities(app,db,{config,fetcher,inspect,consumePsi,legacyAudit=fn=>fn()}){
 app.get('/api/entities/meta',(req,res)=>res.json({company_fields:COMPANY_FIELDS,contact_fields:CONTACT_FIELDS,choices:CHOICES}));
 app.get('/api/companies',(req,res)=>{
  const q=String(req.query.q||'').toLowerCase();let rows=db.prepare('SELECT c.*,(SELECT COUNT(*) FROM contacts x WHERE x.company_id=c.id) AS contact_count FROM companies c').all().filter(c=>[c.name,c.siren,c.city,c.industry,c.website].some(v=>v.toLowerCase().includes(q))&&(!req.query.status||c.business_status===req.query.status)&&(!req.query.priority||c.priority===req.query.priority));
  const sort=['name','created_at','opportunity_score'].includes(req.query.sort)?req.query.sort:'name';rows.sort((a,b)=>sort==='opportunity_score'?(b[sort]??-1)-(a[sort]??-1):sort==='created_at'?b[sort].localeCompare(a[sort]):a[sort].localeCompare(b[sort],'fr'));res.json({companies:rows});
 });
 app.post('/api/companies',(req,res)=>res.status(201).json(tx(db,()=>saveCompany(db,req.body))));
 app.post('/api/companies/:id/delete',(req,res)=>res.json(tx(db,()=>deleteCompany(db,req.params.id,req.body?.confirm))));
 app.post('/api/companies/:id/update',(req,res)=>res.json(tx(db,()=>saveCompany(db,req.body,req.params.id))));
 app.get('/api/companies/:id',(req,res)=>{const c=get(db,'companies',req.params.id);res.json({...c,...relatedCommercial(db,{company_id:c.id}),contacts:db.prepare('SELECT * FROM contacts WHERE company_id=?').all(c.id),audits:db.prepare('SELECT * FROM audits WHERE company_id=? ORDER BY created_at DESC').all(c.id),interactions:db.prepare('SELECT * FROM interactions WHERE company_id=? ORDER BY created_at DESC,rowid DESC').all(c.id),possible_duplicates:possible(db,c,c.id)})});
 app.post('/api/companies/:id/audit',async(req,res)=>{
  const c=get(db,'companies',req.params.id);if(!c.website)throw new EntityError('Renseignez le site de l’entreprise.');
  const audit=await legacyAudit(()=>auditWebsite(c.website,{pagespeedKey:config.pagespeedKey,fetcher,inspect,consumePsi}));
  tx(db,()=>{get(db,'companies',c.id);db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?)').run(id(),c.id,null,JSON.stringify(audit),'Contrôle automatisé',now());db.prepare("UPDATE companies SET audit_status='Réalisé',last_audit_at=?,audit_summary=?,updated_at=? WHERE id=?").run(now(),(audit.conclusions||[]).join('\n'),now(),c.id);for(const contact of db.prepare('SELECT prospect_id FROM contacts WHERE company_id=?').all(c.id))db.prepare('UPDATE prospects SET audit=? WHERE id=?').run(JSON.stringify(audit),contact.prospect_id);log(db,c.id,null,'Audit enregistré','Contrôle automatisé, à interpréter.')});res.json({audit});
 });
 app.get('/api/contacts',(req,res)=>{
  const q=String(req.query.q||'').toLowerCase();const contacts=db.prepare('SELECT c.*,p.name AS company_name FROM contacts c JOIN companies p ON p.id=c.company_id ORDER BY c.display_name,c.created_at').all().filter(c=>[c.display_name,c.email,c.company_name,c.job_title].some(v=>v.toLowerCase().includes(q))&&(!req.query.status||c.contact_status===req.query.status)&&(!req.query.role||c.decision_role===req.query.role)&&(!req.query.opposition||(req.query.opposition==='yes'?c.email_opt_out||c.phone_opt_out||c.contact_status==='Opposition':!c.email_opt_out&&!c.phone_opt_out&&c.contact_status!=='Opposition')));res.json({contacts});
 });
 app.get('/api/contacts/:id',(req,res)=>{const c=get(db,'contacts',req.params.id);res.json({...c,...relatedCommercial(db,{contact_id:c.id}),company:get(db,'companies',c.company_id),interactions:db.prepare('SELECT * FROM interactions WHERE contact_id=? ORDER BY created_at DESC,rowid DESC').all(c.id),communications:db.prepare('SELECT id,subject,body,status,created FROM messages WHERE prospect_id=? ORDER BY created DESC').all(c.prospect_id)})});
 app.post('/api/contacts',(req,res)=>res.status(201).json(tx(db,()=>saveEntityContact(db,req.body))));
 app.post('/api/contacts/:id/delete',(req,res)=>res.json(tx(db,()=>deleteEntityContact(db,req.params.id,req.body?.confirm))));
 app.post('/api/contacts/:id/update',(req,res)=>res.json(tx(db,()=>saveEntityContact(db,req.body,req.params.id))));
 app.post('/api/interactions',(req,res)=>res.status(201).json(tx(db,()=>{const d=req.body;if(!d||typeof d.detail!=='string'||!d.detail.trim()||d.detail.length>20000)throw new EntityError('Décrivez l’interaction.');const c=get(db,'companies',d.company_id);if(d.contact_id&&get(db,'contacts',d.contact_id).company_id!==c.id)throw new EntityError('Contact d’une autre entreprise.');log(db,c.id,d.contact_id||null,'Note de suivi',d.detail.trim());return {ok:true}})));
}
export function saveCompany(db,data,key){const before=key?get(db,'companies',key):null;const v=input(COMPANY_FIELDS,data,before||{});if(!v.name)throw new EntityError('Nom d’entreprise obligatoire.');validateFrenchCompanyIds(v);if(!before){v.information_status||='À vérifier';v.country||='France';v.company_status||='À vérifier';v.business_status||='Nouveau';v.priority||='Moyenne';v.budget_kind||='Inconnu'}if(v.budget_range&&!['Estimé','Déclaré'].includes(v.budget_kind))throw new EntityError('Précisez si le budget est estimé ou déclaré.');if(v.siren&&db.prepare('SELECT id FROM companies WHERE siren=? AND id<>?').get(v.siren,key||''))throw new EntityError('Une entreprise possède déjà ce SIREN.',409);key||=id();const duplicates=possible(db,v,key);write(db,'companies',COMPANY_FIELDS,v,key,before);if(before)for(const contact of db.prepare('SELECT * FROM contacts WHERE company_id=?').all(key))sync(db,v,contact);log(db,key,null,before?'Entreprise modifiée':'Entreprise créée');return {id:key,possible_duplicates:duplicates};}
export function saveEntityContact(db,data,key,legacyId){
 const before=key?get(db,'contacts',key):null;const v=input(CONTACT_FIELDS,data,before||{});if(!v.company_id)throw new EntityError('Entreprise obligatoire.');const company=get(db,'companies',v.company_id);if(before&&before.company_id!==v.company_id)throw new EntityError('Le transfert de dossier nécessite une opération dédiée.');v.display_name||=[v.first_name,v.last_name].filter(Boolean).join(' ');if(!v.display_name&&!v.email&&!v.phone&&!v.mobile)throw new EntityError('Indiquez un nom ou un moyen de contact.');if(!before){v.information_status||='À vérifier';v.preferred_language||='fr';v.decision_role||='Inconnu';v.email_verified_status||='Non vérifié';v.contact_status||='Nouveau'}
 if(before&&((before.email_opt_out&&!v.email_opt_out)||(before.phone_opt_out&&!v.phone_opt_out)||(before.contact_status==='Opposition'&&v.contact_status!=='Opposition')))throw new PolicyError('Une opposition ne peut pas être levée par une modification de fiche.',409);
 if(v.contact_status==='Opposition'){v.email_opt_out=1;v.phone_opt_out=1;v.next_followup_at=''}
 if(v.email_opt_out||v.phone_opt_out){v.opt_out_at||=now();v.opt_out_reason||='Opposition enregistrée dans le CRM ; motif détaillé non renseigné.';}
 if(before&&before.contact_status!=='Opposition'&&((before.email_opt_out&&v.email!==before.email)||(before.phone_opt_out&&(v.phone!==before.phone||v.mobile!==before.mobile))))throw new PolicyError('Les coordonnées opposées sont conservées pour empêcher leur réintroduction.',409);
 const p=projection(company,v);if(restrictedIdentity(db,p,key||''))throw new PolicyError('Ces coordonnées font déjà l’objet d’une opposition.',409);if(suppressed(db,p)&&!(v.email_opt_out&&v.phone_opt_out&&v.contact_status==='Opposition'))throw new PolicyError('Identifiant en liste d’opposition.',409);
 if(v.email&&db.prepare('SELECT id FROM contacts WHERE lower(email)=? AND id<>?').get(v.email,key||''))throw new EntityError('Un contact possède déjà cet email.',409);
 key||=id();let prospectId=before?.prospect_id||legacyId;
 if(!prospectId){prospectId=id();db.prepare('INSERT INTO prospects(id,company,email,website,created) VALUES(?,?,?,?,?)').run(prospectId,company.name,v.email,company.website,now());}
 write(db,'contacts',[...CONTACT_FIELDS,'prospect_id'],{...v,prospect_id:prospectId},key,before);
 sync(db,company,{...v,id:key,prospect_id:prospectId});history(db,prospectId,before?'Contact modifié':'Contact créé','Fiche structurée entreprises / contacts.');return {id:key,prospect_id:prospectId};
}
