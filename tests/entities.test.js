import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,createApp} from '../crm-server.js';
async function fixture(t,auth=false){const dir=mkdtempSync(join(tmpdir(),'entities-')),db=openDatabase(join(dir,'test.sqlite3'));const config={user:auth?'admin':'',password:'test-only',publicUrl:'https://crm2.omnidigital.fr',pagespeedKey:''};const server=createApp({db,config,inspect:async url=>({url,status:200,ttfbMs:200,bytes:100,contentType:'text/html',html:'<title>Test</title><h1>Entreprise</h1>'})}).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true})});const request=async(path,data,headers={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}};return {db,request}}
async function company(request,name='Entreprise test'){const r=await request('/api/companies',{name});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id}
async function contact(request,company_id,email='paulo@example.fr'){const r=await request('/api/contacts',{company_id,first_name:'Paulo',last_name:'Costa',email});assert.equal(r.status,201,JSON.stringify(r.data));return r.data}
test('company/contact separation, multiple contacts, editing and compatibility projections',async t=>{const {request,db}=await fixture(t);const cid=await company(request);assert.equal((await request(`/api/companies/${cid}`)).data.contacts.length,0);const a=await contact(request,cid),b=await contact(request,cid,'autre@example.fr');assert.notEqual(a.id,b.id);assert.equal((await request(`/api/companies/${cid}`)).data.contacts.length,2);assert.equal((await request(`/api/companies/${cid}/update`,{general_email:'info@example.fr',name:'Entreprise renommée',observed_needs:'Refonte'})).status,200);const record=(await request(`/api/contacts/${a.id}`)).data;assert.equal(record.email,'paulo@example.fr');assert.equal(record.company.general_email,'info@example.fr');const legacy=db.prepare('SELECT * FROM prospects WHERE id=?').get(a.prospect_id);assert.equal(legacy.company,'Entreprise renommée');assert.equal(legacy.needs,'Refonte');assert.equal((await request(`/api/contacts/${a.id}/update`,{job_title:'Directeur'})).status,200);assert.equal((await request('/api/contacts?q=directeur')).data.contacts.length,1);assert.equal((await request(`/api/prospects/${a.prospect_id}/update`,{company:'Bypass'})).status,409);assert.equal((await request(`/api/prospects/${a.prospect_id}/draft`,{})).status,200);assert.equal((await request(`/api/contacts/${a.id}`)).data.communications.length,1)});
test('SIREN/SIRET checks, unique SIREN, optional identifiers and possible duplicates',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/companies',{name:'A',siren:'732829320',siret:'73282932000074'})).status,201);assert.equal((await request('/api/companies',{name:'B',siren:'732829320'})).status,409);for(const data of [{siren:'123'},{siren:'000000000'},{siren:'732829321'},{siret:'73282932000075'},{siren:'356000000',siret:'73282932000074'}])assert.equal((await request('/api/companies',{name:'Invalid',...data})).status,400);await company(request,'Établissement ABC');const dupe=await request('/api/companies',{name:'etablissement-abc'});assert.equal(dupe.status,201);assert.equal(dupe.data.possible_duplicates.length,1);assert.equal((await request('/api/companies',{name:'C',website:'https://www.exemple.fr/a'})).status,201);assert.equal((await request('/api/companies',{name:'D',website:'https://exemple.fr/b'})).data.possible_duplicates.length,1)});
test('validations, required associations, budgets and real dates',async t=>{const {request,db}=await fixture(t);const cid=await company(request);for(const data of [{},{company_id:'missing',first_name:'A'},{company_id:cid},{company_id:cid,email:'bad'},{company_id:cid,email:'a@example.fr',email_opt_out:'false'},{company_id:cid,first_name:'A',collected_at:'2026-02-30'},{company_id:cid,first_name:'A',linkedin_url:'javascript:alert(1)'}])assert.ok((await request('/api/contacts',data)).status>=400);for(const data of [{name:''},{opportunity_score:101},{budget_range:'1000'},{website:'file:///etc/passwd'},{priority:'Critical'}])assert.equal((await request(`/api/companies/${cid}/update`,data)).status,400);const c=await contact(request,cid);assert.throws(()=>db.prepare('DELETE FROM companies WHERE id=?').run(cid),/FOREIGN KEY/);assert.equal((await request(`/api/contacts/${c.id}/update`,{company_id:await company(request,'Deuxième')})).status,400)});
test('email and phone opt-out cannot be undone, drafting blocked and history retained',async t=>{const {request}=await fixture(t);const cid=await company(request),c=await contact(request,cid);await request(`/api/prospects/${c.prospect_id}/draft`,{});let state=(await request('/api/state')).data;await request(`/api/messages/${state.messages[0].id}/approve`,{confirm:state.messages[0].id});assert.equal((await request(`/api/contacts/${c.id}/update`,{email_opt_out:true,opt_out_reason:'Demande reçue par email le 3 novembre.'})).status,200);assert.equal((await request(`/api/contacts/${c.id}/update`,{email_opt_out:false})).status,409);assert.equal((await request(`/api/prospects/${c.prospect_id}/draft`,{})).status,400);assert.equal((await request(`/api/contacts/${c.id}/update`,{contact_status:'Opposition',phone_opt_out:true})).status,200);assert.equal((await request(`/api/contacts/${c.id}/update`,{email:'changed@example.fr',phone:'0102030405'})).status,200);assert.equal((await request(`/api/contacts/${c.id}/update`,{contact_status:'Qualifié'})).status,409);assert.equal((await request('/api/contacts',{company_id:cid,email:'changed@example.fr'})).status,409);assert.equal((await request(`/api/prospects/${c.prospect_id}/delete`,{confirm:c.prospect_id})).status,409);assert.ok((await request(`/api/contacts/${c.id}`)).data.interactions.length>=3)});
test('legacy reply opposition syncs into contact, contact and company audits persist',async t=>{const {request,db}=await fixture(t);const cid=await company(request),c=await contact(request,cid);await request(`/api/companies/${cid}/update`,{website:'https://example.com'});assert.equal((await request(`/api/companies/${cid}/audit`,{})).status,200);assert.equal((await request(`/api/prospects/${c.prospect_id}/audit`,{})).status,200);assert.equal((await request(`/api/companies/${cid}`)).data.audits.length,2);await request(`/api/contacts/${c.id}/update`,{job_title:'Gérant'});assert.equal((await request(`/api/companies/${cid}`)).data.audits.length,2);assert.equal((await request(`/api/prospects/${c.prospect_id}/reply`,{body:'STOP ne me contactez plus'})).status,201);const row=(await request(`/api/contacts/${c.id}`)).data;assert.equal(row.contact_status,'Opposition');assert.equal(row.email_opt_out,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)});
test('manual interactions enforce company association and authorization covers new endpoints',async t=>{const {request}=await fixture(t);const a=await company(request),b=await company(request,'Autre'),c=await contact(request,a);assert.equal((await request('/api/interactions',{company_id:b,contact_id:c.id,detail:'Note'})).status,400);assert.equal((await request('/api/interactions',{company_id:a,contact_id:c.id,detail:'Échange téléphonique, rendez-vous à prévoir.'})).status,201);const secure=await fixture(t,true);for(const path of ['/api/companies','/api/contacts','/api/entities/meta'])assert.equal((await secure.request(path)).status,401);const auth={Authorization:'Basic '+Buffer.from('admin:test-only').toString('base64')};assert.equal((await secure.request('/api/companies',{name:'Autorisée'},auth)).status,201);assert.equal((await secure.request('/api/contacts',{company_id:'x',first_name:'X'},{...auth,Origin:'https://evil.example'})).status,403)});
test('existing data is untouched and entity initialization is idempotent',async t=>{const {request,db}=await fixture(t);const legacy=await request('/api/prospects',{company:'Historique',email:'old@example.fr'});await request(`/api/prospects/${legacy.data.id}/draft`,{});const rows=JSON.stringify(db.prepare('SELECT * FROM prospects').all()),messages=JSON.stringify(db.prepare('SELECT * FROM messages').all());const {initEntities}=await import('../entities.js');initEntities(db);initEntities(db);assert.equal(JSON.stringify(db.prepare('SELECT * FROM prospects').all()),rows);assert.equal(JSON.stringify(db.prepare('SELECT * FROM messages').all()),messages);assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n,0)});
test('channel opposition cannot be bypassed by editing coordinates or using legacy creation',async t=>{const {request}=await fixture(t);const cid=await company(request),c=await contact(request,cid);await request(`/api/contacts/${c.id}/update`,{email_opt_out:true,opt_out_reason:'Refus explicite par email.'});assert.equal((await request(`/api/contacts/${c.id}/update`,{email:'new@example.fr'})).status,409);assert.equal((await request('/api/prospects',{company:'Nouvelle entreprise',email:'paulo@example.fr'})).status,409);const b=await contact(request,cid,'b@example.fr');await request(`/api/contacts/${b.id}/update`,{phone:'01 23 45 67 89'});await request(`/api/contacts/${b.id}/update`,{phone_opt_out:true,opt_out_reason:'Refus explicite des appels.'});assert.equal((await request(`/api/prospects/${b.prospect_id}/draft`,{})).status,200);assert.equal((await request('/api/contacts',{company_id:cid,phone:'0123456789',first_name:'Autre'})).status,409)});
test('existing SQLite is backed up before the first schema extension',async t=>{const {DatabaseSync}=await import('node:sqlite');const {readdirSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'backup-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'crm.sqlite3');const before=new DatabaseSync(file);before.exec("CREATE TABLE prospects(id TEXT PRIMARY KEY,company TEXT NOT NULL,email TEXT,website TEXT,status TEXT NOT NULL DEFAULT 'Nouveau',notes TEXT DEFAULT '',pdf_text TEXT DEFAULT '',audit TEXT DEFAULT '{}',created TEXT NOT NULL); INSERT INTO prospects(id,company,created) VALUES('known','Données présentes','2026-01-01');");before.close();const current=openDatabase(file);current.close();const backups=readdirSync(dir).filter(f=>f.includes('.before-companies-'));assert.equal(backups.length,1);const saved=new DatabaseSync(join(dir,backups[0]),{readOnly:true});assert.equal(saved.prepare('SELECT company FROM prospects').get().company,'Données présentes');assert.equal(saved.prepare("SELECT 1 FROM sqlite_master WHERE name='companies'").get(),undefined);saved.close();const reopened=openDatabase(file);reopened.close();assert.equal(readdirSync(dir).filter(f=>f.includes('.before-companies-')).length,1)});

test('one structured contact opposition does not suppress every contact in the company',async t=>{const {request}=await fixture(t);const cid=await company(request),a=await contact(request,cid);await request(`/api/contacts/${a.id}/update`,{contact_status:'Opposition',opt_out_reason:'Refus de cet interlocuteur uniquement.'});const b=await contact(request,cid,'collegue@example.fr');assert.equal((await request(`/api/prospects/${b.prospect_id}/draft`,{})).status,200);assert.equal((await request('/api/contacts',{company_id:cid,email:'paulo@example.fr'})).status,409)});

test('opposition saves without a separately entered reason and remains enforceable after reload',async t=>{
 const {request}=await fixture(t);const cid=await company(request);
 let index=0;for(const input of [{email_opt_out:true},{phone_opt_out:true},{contact_status:'Opposition'}]){
  const c=await contact(request,cid,`opposition-${index++}@example.fr`);
  const saved=await request(`/api/contacts/${c.id}/update`,input);
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  const row=(await request(`/api/contacts/${c.id}`)).data;
  assert.ok(row.opt_out_at);assert.ok(row.opt_out_reason);
  if(input.email_opt_out||input.contact_status)assert.equal((await request(`/api/prospects/${c.prospect_id}/draft`,{})).status,400);
  assert.equal((await request(`/api/contacts/${c.id}/update`,{job_title:'Gérant'})).status,200);
 }
});

test('guided first email uses the digital audit, stores evidence separately and requires approval',async t=>{
 const {request,db}=await fixture(t);
 const cid=await company(request),c=await contact(request,cid);
 const other=await contact(request,cid,'autre@example.fr');
 await request(`/api/companies/${cid}/update`,{website:'https://example.com',notes:'Note interne confidentielle'});
 const path=`/api/prospects/${c.prospect_id}/guided-draft`;
 assert.equal((await request(path,{})).status,409);
 const job=await request('/api/digital-audits',{company_id:cid});
 assert.equal(job.status,202);
 let audit;
 for(let attempt=0;attempt<50;attempt++){
  const state=(await request(`/api/digital-audits/jobs/${job.data.id}`)).data;
  if(state.audit_id){audit=state.audit_id;break}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.ok(audit);
 const outcomes=await Promise.all([request(path,{}),request(path,{})]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 const messages=db.prepare('SELECT * FROM messages').all();
 assert.equal(messages.length,1);
 const [message]=messages;
 assert.equal(message.status,'Brouillon');
 assert.equal(message.approved_at,'');
 assert.equal(message.sent_at,'');
 assert.match(message.body,/rendu sur mobile/);
 assert.match(message.body,/calendar\.app\.google/);
 assert.match(message.body,/stop/);
 assert.doesNotMatch(message.body,/confidentielle|example\.com|page0-viewport/);
 assert.ok(message.internal_context.includes(audit));
 assert.match(message.internal_context,/page0-viewport/);
 assert.equal((await request(`/api/prospects/${other.prospect_id}/guided-draft`,{})).status,409);
 assert.equal((await request(`/api/messages/${message.id}/record-sent`,{confirm:message.id})).status,400);
});

test('guided email rejects old or unrelated audits, existing contact history and opposition',async t=>{
 const {request,db}=await fixture(t);
 const cid=await company(request),c=await contact(request,cid);
 const url='https://example.com/';
 await request(`/api/companies/${cid}/update`,{website:url});
 const path=`/api/prospects/${c.prospect_id}/guided-draft`;
 const now=new Date().toISOString();
 const result={engine_version:3,execution_status:'completed',date:now,requestedUrl:url,url,
  controls:[{id:'page0-viewport',status:'Amélioration recommandée',source:'HTML reçu',page_url:url}]};
 const insert=db.prepare('INSERT INTO audits VALUES(?,?,NULL,?,?,?)');
 insert.run('old',cid,JSON.stringify({...result,date:'2020-01-01T00:00:00.000Z'}),'Moteur digital v3',now);
 assert.equal((await request(path,{})).status,409);
 insert.run('redirected',cid,JSON.stringify({...result,url:'https://other.example/'}),'Moteur digital v3',now);
 assert.equal((await request(path,{})).status,409);
 insert.run('latest',cid,JSON.stringify(result),'Moteur digital v3',now);
 await request(`/api/contacts/${c.id}/update`,{last_reply_at:now.slice(0,10)});
 assert.match((await request(path,{})).data.error,/historique/);
 await request(`/api/contacts/${c.id}/update`,{email_opt_out:true});
 assert.match((await request(path,{})).data.error,/prospection par email/);
 assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n,0);
});

test('structured contact deletion requires confirmation and preserves company data and opposition',async t=>{
 const {request,db}=await fixture(t);
 const cid=await company(request),c=await contact(request,cid);
 const path=`/api/contacts/${c.id}/delete`;
 assert.equal((await request(path,{})).status,400);
 await request(`/api/prospects/${c.prospect_id}/draft`,{});
 db.prepare("UPDATE messages SET status='À vérifier' WHERE prospect_id=?").run(c.prospect_id);
 assert.equal((await request(path,{confirm:c.id})).status,409);
 db.prepare("UPDATE messages SET status='Brouillon' WHERE prospect_id=?").run(c.prospect_id);
 await request(`/api/contacts/${c.id}/update`,{email_opt_out:true});
 db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?)').run('linked-audit',cid,c.id,'{}','Test',new Date().toISOString());
 assert.equal((await request(path,{confirm:c.id})).status,200);
 assert.equal((await request(`/api/contacts/${c.id}`)).status,404);
 const companyRow=(await request(`/api/companies/${cid}`)).data;
 assert.equal(companyRow.contacts.length,0);
 assert.equal(companyRow.audits[0].contact_id,null);
 assert.equal(db.prepare('SELECT count(*) n FROM prospects WHERE id=?').get(c.prospect_id).n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM messages WHERE prospect_id=?').get(c.prospect_id).n,0);
 assert.equal((await request('/api/contacts',{company_id:cid,email:'paulo@example.fr'})).status,409);
 assert.equal((await request('/api/contacts',{company_id:cid,email:'autre@example.fr'})).status,201);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
