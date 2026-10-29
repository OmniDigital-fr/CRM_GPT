import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MailService,readMailConfig} from '../mail-service.js';
import {auditWebsite,publicAddress,resolvePublic,siteUrl,analyzePage,AuditError} from '../site-audit.js';
import {createApp,openDatabase,validateConfig,importText,extractPdf} from '../crm-server.js';

function samplePage(url='https://example.com'){
  return {url,status:200,ttfbMs:280,bytes:46000,contentType:'text/html',certificate:{validTo:'2027-01-01T00:00:00.000Z',daysRemaining:60},html:'<html><head><title>Exemple</title><meta name="description" content="Entreprise locale"><meta name="viewport" content="width=device-width"></head><body><h1>Exemple</h1><a href="tel:0102030405">Appeler</a></body></html>'};
}

async function fixture(t,overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'omni-node-'));
  const db=openDatabase(join(dir,'crm.sqlite3'));
  const config={production:false,user:'',password:'',publicUrl:'',pagespeedKey:'',...overrides.config};
  const mailService=overrides.serviceFactory?.(db);
  const server=createApp({db,config,mailService,inspect:async url=>samplePage(url),...overrides}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true})});
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,data,headers={})=>{
    const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json()};
  };
  return {db,base,request};
}

test('contact CRUD preserves profile, report and status; duplicates blocked; delete confirmed',async t=>{
  const {request,db}=await fixture(t);
  const input={company:'AB Électricien',email:'David@example.com',address2:'Lieu-dit Les Chênes',postal_code:'91400',city:'Orsay',needs:'SEO local'};
  const created=await request('/api/prospects',input);assert.equal(created.status,201);const id=created.data.id;
  assert.equal((await request('/api/prospects',{company:'ab-electricien'})).status,409);
  assert.equal((await request('/api/prospects',{company:'Autre',email:'david@EXAMPLE.com'})).status,409);
  db.prepare('UPDATE prospects SET pdf_text=? WHERE id=?').run('Rapport conservé',id);
  await request(`/api/prospects/${id}/status`,{status:'Qualifié'});
  assert.equal((await request(`/api/prospects/${id}/update`,{...input,phone:'0123456789'})).status,200);
  let p=(await request('/api/state')).data.prospects[0];assert.equal(p.pdf_text,'Rapport conservé');assert.equal(p.status,'Qualifié');assert.equal(p.address2,'Lieu-dit Les Chênes');
  await request(`/api/prospects/${id}/draft`,{});
  let state=(await request('/api/state')).data;assert.match(state.messages[0].body,/SEO local/);assert.equal(state.metrics.sent,0);
  db.prepare('INSERT INTO events VALUES(?,?,?,?)').run('e',state.messages[0].id,'open',new Date().toISOString());
  await request(`/api/prospects/${id}/status`,{status:'Opposition'});
  assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,400);
  assert.equal((await request(`/api/prospects/${id}/delete`,{})).status,400);
  assert.equal((await request(`/api/prospects/${id}/delete`,{confirm:id})).status,200);
  state=(await request('/api/state')).data;assert.equal(state.prospects.length,0);assert.equal(state.messages.length,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n,0);
});

test('existing Python schema and data are preserved on Node migration',async t=>{
  const {db}=await fixture(t);
  db.prepare('INSERT INTO prospects(id,company,created) VALUES(?,?,?)').run('legacy','Entreprise existante','2026-10-19T00:00:00+00:00');
  assert.equal(db.prepare('SELECT status FROM prospects WHERE id=?').get('legacy').status,'Nouveau');
  const result=importText(db,'Nom  ENTREPRISE EXISTANTE\nEmail  autre@example.com');
  assert.equal(result.created,false);assert.equal(result.id,'legacy');
});

test('PDF import uses same duplicate checks; invalid contact data rejected',async t=>{
  const text='Nom  Client PDF\nEmail  pdf@example.com\nSite web  https://example.com\nTéléphone  0102030405';
  const {base,request}=await fixture(t,{parsePdf:async()=>text});
  const upload=()=>fetch(base+'/api/import-pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:Buffer.from('%PDF-test')});
  assert.equal((await upload()).status,201);assert.equal((await upload()).status,200);
  const state=(await request('/api/state')).data;assert.equal(state.prospects.length,1);assert.match(state.prospects[0].pdf_text,/Client PDF/);assert.equal(state.prospects[0].phone,'0102030405');
  assert.equal((await request('/api/prospects',{company:'Bad date',next_followup:'2026-02-30'})).status,400);
  assert.equal((await request('/api/prospects',{company:'Bad site',website:'javascript:alert(1)'})).status,400);
  assert.equal((await request('/api/prospects',null)).status,400);
});

test('auth protects pages and APIs; cross-origin and form writes rejected; no data files served',async t=>{
  const {base,request}=await fixture(t,{config:{user:'admin',password:'test-password-123456',publicUrl:'https://crm2.omnidigital.fr'}});
  const headers={Authorization:'Basic '+Buffer.from('admin:test-password-123456').toString('base64')};
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await fetch(base)).status,401);
  assert.equal((await request('/api/state',undefined,headers)).status,200);
  assert.equal((await request('/api/prospects',{company:'Test'},{...headers,Origin:'https://foreign.example'})).status,403);
  assert.equal((await fetch(base+'/api/prospects',{method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:'company=Test'})).status,415);
  assert.equal((await fetch(base+'/.data/crm.sqlite3',{headers})).status,404);
  assert.equal((await fetch(base+'/server.js',{headers})).status,404);
  assert.equal((await fetch(base+'/dashboard.js',{headers})).status,200);
});

test('PageSpeed integration converts scores and reports unavailable key honestly',async t=>{
  const {request}=await fixture(t,{config:{pagespeedKey:'test-only'},fetcher:async(url)=>{
    assert.equal(new URL(url).hostname,'www.googleapis.com');
    return {ok:true,json:async()=>({lighthouseResult:{categories:{performance:{score:.42},seo:{score:.9}},audits:{}}})};
  }});
  const id=(await request('/api/prospects',{company:'Audit',website:'https://example.com'})).data.id;
  assert.equal((await request(`/api/prospects/${id}/audit`,{})).status,200);
  assert.equal(JSON.parse((await request('/api/state')).data.prospects[0].audit).scores.performance,42);
});

test('production refuses missing login and nonpersistent data location',()=>{
  assert.throws(()=>validateConfig({NODE_ENV:'production'}),/CRM_AUTH/);
  assert.throws(()=>validateConfig({NODE_ENV:'production',CRM_AUTH_USER:'admin',CRM_AUTH_PASSWORD:'long-test-password',CRM_DATA_DIR:'.data'}),/CRM_DATA_DIR/);
  assert.throws(()=>validateConfig({NODE_ENV:'production',CRM_AUTH_USER:'admin',CRM_AUTH_PASSWORD:'long-test-password',CRM_DATA_DIR:process.cwd()+'/.data',CRM_PUBLIC_URL:'https://crm2.omnidigital.fr'}),/hors du répertoire/);
  assert.doesNotThrow(()=>validateConfig({NODE_ENV:'production',CRM_AUTH_USER:'admin',CRM_AUTH_PASSWORD:'long-test-password',CRM_DATA_DIR:join(tmpdir(),'omni-persistent'),CRM_PUBLIC_URL:'https://crm2.omnidigital.fr'}));
});

function pdfFixture(text) {
  const stream=text?`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`:'';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`});
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
test('real JavaScript PDF extraction and empty-document handling',async()=>{
  const text=await extractPdf(pdfFixture('Nom  Example PDF'));
  assert.match(text,/Example PDF/);
  await assert.rejects(()=>extractPdf(pdfFixture('')),/OCR/);
  await assert.rejects(()=>extractPdf(Buffer.from('not a PDF')),/PDF/);
});

test('Hostinger-style imported entry listens within three seconds with production auth', {timeout:6000}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'omni-entry-'));
  const child=spawn(process.execPath,['--input-type=module','--eval',"await import('./server.js')"],{
    cwd:new URL('..',import.meta.url),
    env:{...process.env,NODE_ENV:'production',PORT:'0',CRM_DATA_DIR:dir,CRM_PUBLIC_URL:'https://crm2.omnidigital.fr',CRM_AUTH_USER:'entry-test',CRM_AUTH_PASSWORD:'test-entry-password-only'}
  });
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  t.after(async()=>{
    if(child.exitCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}
    rmSync(dir,{recursive:true,force:true});
  });
  const port=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(new Error('Entry did not listen within 3 seconds. '+errors)),3000);
    child.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/port=(\d+)/);
      if(match){clearTimeout(timer);resolve(Number(match[1]));}
    });
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Entry exited: '+code+' '+errors))});
  });
  assert.equal((await fetch('http://127.0.0.1:'+port+'/api/state')).status,401);
  const response=await fetch('http://127.0.0.1:'+port+'/api/state',{headers:{Authorization:'Basic '+Buffer.from('entry-test:test-entry-password-only').toString('base64')}});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).prospects,[]);
});

test('audit history persists without Google key, feeds drafts and is deleted with contact',async t=>{
  const {request,db}=await fixture(t);
  const id=(await request('/api/prospects',{company:'Audit complet',website:'https://example.com'})).data.id;
  for(let i=0;i<2;i++)assert.equal((await request(`/api/prospects/${id}/audit`,{})).status,200);
  const history=(await request(`/api/prospects/${id}/audits`)).data.audits;
  assert.equal(history.length,2);assert.notEqual(history[0].id,history[1].id);
  assert.equal(history[0].pagespeed.state,'unconfigured');
  assert.equal(history[0].checks.find(c=>c.key==='reviews').state,'unknown');
  assert.equal(history[0].checks.find(c=>c.key==='performance').value,'Non mesurée');
  assert.match(history[0].checks.find(c=>c.key==='response').detail,/pas le chargement complet/);
  assert.ok(history[0].arguments.length>0);
  await request(`/api/prospects/${id}/draft`,{});
  assert.match((await request('/api/state')).data.messages[0].body,/Balisage local/);
  await request(`/api/prospects/${id}/delete`,{confirm:id});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_audits').get().n,0);
});

test('Google failure preserves HTML results and does not fabricate mobile scores',async()=>{
  const result=await auditWebsite('https://example.com',{pagespeedKey:'test-only',inspect:async()=>samplePage(),fetcher:async()=>({ok:false,status:403})});
  assert.equal(result.pagespeed.state,'unavailable');assert.deepEqual(result.scores,{});
  assert.equal(result.checks.find(c=>c.key==='mobile').state,'pass');
  assert.match(result.checks.find(c=>c.key==='mobile').detail,/rendu réel/);
});

test('HTML detectors recognize evidence and distinguish blocked pages from missing features',()=>{
  const page=samplePage();page.html+='<script type="application/ld+json">{"@type":"Electrician"}</script><script src="https://www.googletagmanager.com/gtm.js"></script><a href="https://www.instagram.com/exemple">Instagram</a><form></form>';
  const result=analyzePage(page);
  assert.equal(result.checks.find(c=>c.key==='schema').state,'pass');
  assert.equal(result.checks.find(c=>c.key==='social').value,'Instagram');
  assert.match(result.checks.find(c=>c.key==='conversion').value,/formulaire/);
  const blocked=analyzePage({...page,status:403});
  assert.equal(blocked.checks.find(c=>c.key==='site').state,'fail');
  assert.equal(blocked.checks.find(c=>c.key==='seo').state,'unknown');
  assert.equal(blocked.arguments.length,1);
});

test('audit network validation rejects private, reserved and mixed DNS destinations',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1','0.0.0.0','100.64.0.1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.throws(()=>siteUrl('file:///etc/passwd'),AuditError);
  assert.throws(()=>siteUrl('https://user:pass@example.com'),AuditError);
  assert.throws(()=>siteUrl('http://example.com:8000'),AuditError);
  await assert.rejects(()=>resolvePublic('127.0.0.1'),/privées/);
  await assert.rejects(()=>resolvePublic('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]),/privées/);
});

test('opt-out blocks drafts, clears followups, survives deletion and prevents reimport',async t=>{
 const {request,db}=await fixture(t);
 const input={company:'Prospect protégé',email:'stop@example.com',next_followup:'2026-11-05'};
 const id=(await request('/api/prospects',input)).data.id;
 await request(`/api/prospects/${id}/sequence`,{});
 await request(`/api/prospects/${id}/status`,{status:'Opposition'});
 const p=(await request('/api/state')).data.prospects[0];assert.equal(p.next_followup,'');assert.equal(p.contact_permission,'Opposition');
 assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,400);
 assert.equal((await request(`/api/prospects/${id}/status`,{status:'Contacté'})).status,400);
 assert.ok((await request(`/api/prospects/${id}/history`)).data.history.some(h=>h.kind==='Changement de statut'));
 await request(`/api/prospects/${id}/delete`,{confirm:id});
 assert.equal((await request('/api/prospects',input)).status,409);
 assert.equal((await request('/api/prospects',{company:'Autre nom',email:'STOP@example.com'})).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM prospects').get().n,0);
});

test('commercial refusal and channel restrictions differ from global opposition',async t=>{
 const {request}=await fixture(t);
 const input={company:'Refus commercial',email:'refus@example.com',status:'Pas intéressé',response_scenario:'Pas intéressé / offre refusée',contact_permission:'À vérifier',next_followup:'2026-11-10'};
 const id=(await request('/api/prospects',input)).data.id;
 let p=(await request('/api/state')).data.prospects[0];assert.equal(p.next_followup,'');assert.notEqual(p.contact_permission,'Opposition');
 assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,400);
 await request(`/api/prospects/${id}/update`,{...input,status:'À recontacter',do_not_email:'Oui'});
 assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,400);
 await request(`/api/prospects/${id}/update`,{...input,status:'À recontacter',do_not_email:'Non'});
 assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,200);
});

test('new documented consent is explicit and preserves a dated history',async t=>{
 const {request}=await fixture(t);
 const id=(await request('/api/prospects',{company:'Accord nouveau',email:'accord@example.com',contact_permission:'Opposition'})).data.id;
 assert.equal((await request(`/api/prospects/${id}/reconsent`,{confirm:id,evidence:''})).status,400);
 assert.equal((await request(`/api/prospects/${id}/reconsent`,{confirm:id,evidence:'Accord reçu par email le 29 octobre 2026, demande de devis.'})).status,200);
 const p=(await request('/api/state')).data.prospects[0];assert.equal(p.contact_permission,'Accord explicite');assert.equal(p.next_followup,'');
 assert.equal((await request(`/api/prospects/${id}/draft`,{})).status,200);
 assert.ok((await request(`/api/prospects/${id}/history`)).data.history.some(h=>h.kind==='Nouvel accord documenté'));
});

test('sequence has 4 individual approvals and schedules followup 7 days after actual recorded send',async t=>{
 const {request,db}=await fixture(t);
 const id=(await request('/api/prospects',{company:'Séquence sept jours',email:'sequence@example.com'})).data.id;
 assert.equal((await request(`/api/prospects/${id}/sequence`,{})).status,201);
 assert.equal((await request(`/api/prospects/${id}/sequence`,{})).status,409);
 let messages=(await request('/api/state')).data.messages.sort((a,b)=>a.sequence_stage-b.sequence_stage);
 assert.equal(messages.length,4);assert.equal(messages[1].due_at,'');
 const first=messages[0];assert.equal((await request(`/api/messages/${first.id}/record-sent`,{confirm:first.id})).status,400);
 assert.equal((await request(`/api/messages/${first.id}/approve`,{confirm:first.id})).status,200);
 assert.equal((await request('/api/state')).data.metrics.sent,0);
 assert.equal((await request(`/api/messages/${first.id}/record-sent`,{confirm:first.id})).status,200);
 messages=(await request('/api/state')).data.messages.sort((a,b)=>a.sequence_stage-b.sequence_stage);
 assert.equal(Date.parse(messages[1].due_at)-Date.parse(messages[0].sent_at),7*86400000);
 await request(`/api/messages/${messages[1].id}/approve`,{confirm:messages[1].id});
 assert.equal((await request(`/api/messages/${messages[1].id}/record-sent`,{confirm:messages[1].id})).status,400);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE status='Envoyé'").get().n,1);
});

test('editing an approved message or recipient revokes approval',async t=>{
 const {request}=await fixture(t);
 const input={company:'Approbation',email:'initial@example.com'};
 const id=(await request('/api/prospects',input)).data.id;
 await request(`/api/prospects/${id}/draft`,{});
 const m=(await request('/api/state')).data.messages[0];
 await request(`/api/messages/${m.id}/approve`,{confirm:m.id});
 await request(`/api/messages/${m.id}/update`,{subject:'Nouvel objet',body:'Nouveau texte à approuver.'});
 assert.equal((await request('/api/state')).data.messages[0].status,'Brouillon');
 await request(`/api/messages/${m.id}/approve`,{confirm:m.id});
 await request(`/api/prospects/${id}/update`,{...input,email:'nouveau@example.com'});
 assert.equal((await request('/api/state')).data.messages[0].status,'Brouillon');
});

test('incoming response pauses sequence, cancels approvals and proposes a reviewed reply',async t=>{
 const {request}=await fixture(t);
 const id=(await request('/api/prospects',{company:'Client répond',email:'reply@example.com'})).data.id;
 await request(`/api/prospects/${id}/sequence`,{});
 const m=(await request('/api/state')).data.messages[0];await request(`/api/messages/${m.id}/approve`,{confirm:m.id});
 const response=await request(`/api/prospects/${id}/reply`,{body:'Bonjour, pouvez-vous me donner vos tarifs ?'});
 assert.equal(response.status,201);assert.equal(response.data.scenario,'Demande de devis / tarifs');assert.ok(response.data.messageId);
 const state=(await request('/api/state')).data;
 assert.equal(state.sequences[0].state,'En pause');assert.equal(state.messages.filter(m=>m.status==='Annulé').length,4);
 assert.equal(state.messages.find(m=>m.id===response.data.messageId).status,'Brouillon');
 assert.equal(state.metrics.sent,0);
});

test('explicit stop overrides permissive classification and never prepares a reply',async t=>{
 const {request}=await fixture(t);
 const id=(await request('/api/prospects',{company:'Opposition réponse',email:'optout@example.com'})).data.id;
 await request(`/api/prospects/${id}/sequence`,{});
 const response=await request(`/api/prospects/${id}/reply`,{body:'Merci de ne plus me contacter. Retirez mes coordonnées de votre liste.',scenario:'Réponse positive'});
 assert.equal(response.status,201);assert.equal(response.data.messageId,null);
 const state=(await request('/api/state')).data;assert.equal(state.prospects[0].status,'Opposition');assert.equal(state.messages.filter(m=>m.status==='Brouillon'||m.status==='Approuvé').length,0);
});

function fakeMailSetup(db,options={}){
 const inbox=[],sent=[];
 const transport={verify:async()=>true,sendMail:async message=>{sent.push(message);if(options.fail)throw Error('simulated failure');if(options.wait)await options.wait;return {accepted:[message.envelope.to[0]],messageId:message.messageId}},close(){}};
 const clientFactory=()=>({
  mailbox:null,connect:async()=>{},
  async getMailboxLock(){this.mailbox={uidValidity:1n,uidNext:inbox.length+1};return {release(){}}},
  async *fetch(range){const [start,end]=range.split(':').map(Number);for(let i=start-1;i<Math.min(end,inbox.length);i++){yield {uid:i+1,envelope:{from:[{address:inbox[i].from}],messageId:inbox[i].messageId},size:Buffer.byteLength(inbox[i].raw)};if(options.failFetchOnce){options.failFetchOnce=false;throw Error('simulated interrupted IMAP batch')}}},
  async fetchOne(uid){return {source:Buffer.from(inbox[uid-1].raw)}},logout:async()=>{},close(){}
 });
 const service=new MailService({db,config:readMailConfig({MAIL_PROVIDER:'hostinger',MAIL_USER:'contact@omnidigital.fr',MAIL_PASSWORD:'test-only-never-real'}),draft:p=>({subject:'Réponse proposée',body:'Merci pour votre demande.',context:p.notes}),transport,clientFactory});
 return {service,inbox,sent};
}
async function approvedMail(request,company='SMTP test'){
 const p=(await request('/api/prospects',{company,email:'recipient@example.com'})).data;
 await request(`/api/prospects/${p.id}/draft`,{});
 let m=(await request('/api/state')).data.messages.find(m=>m.prospect_id===p.id);
 await request(`/api/messages/${m.id}/update`,{subject:'Texte vérifié',body:'Bonjour, ceci est le texte approuvé par le responsable.'});
 await request(`/api/messages/${m.id}/approve`,{confirm:m.id});
 const messageId=m.id;m=(await request('/api/state')).data.messages.find(item=>item.id===messageId);
 return {p,m};
}
test('SMTP requires individual current approval; sends only the frozen recipient and never internal notes',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 const {p,m}=await approvedMail(request);
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id})).status,409);assert.equal(fake.sent.length,0);
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at})).status,200);
 assert.equal(fake.sent.length,1);assert.deepEqual(fake.sent[0].envelope.to,['recipient@example.com']);
 assert.equal(fake.sent[0].from.address,'contact@omnidigital.fr');assert.equal(fake.sent[0].html,undefined);
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at})).status,409);
 assert.equal(fake.sent.length,1);
 const state=(await request('/api/state')).data;assert.equal(state.messages[0].status,'Envoyé');assert.equal(state.metrics.sent,1);
});

test('concurrent sends claim the message only once',async t=>{
 let release;const wait=new Promise(r=>release=r);let fake;
 const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db,{wait})).service});
 const {m}=await approvedMail(request);
 const first=request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at});
 while(!fake.sent.length)await new Promise(r=>setTimeout(r,5));
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at})).status,409);
 release();assert.equal((await first).status,200);assert.equal(fake.sent.length,1);
});

test('uncertain SMTP delivery cannot be automatically retried and requires documented resolution',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db,{fail:true})).service});
 const {m}=await approvedMail(request);
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at})).status,502);
 assert.equal((await request('/api/state')).data.messages[0].status,'À vérifier');
 assert.equal((await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at})).status,409);
 assert.equal(fake.sent.length,1);
 assert.equal((await request(`/api/messages/${m.id}/resolve-delivery`,{confirm:m.id,outcome:'not-sent',evidence:'Vérification manuelle du journal fournisseur : refus avant livraison.'})).status,200);
 assert.equal((await request('/api/state')).data.messages[0].status,'Brouillon');
});

test('IMAP imports matching replies once, ignores quoted opt-out footer and pauses outreach',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 const {p,m}=await approvedMail(request);
 await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at});
 const original=fake.sent[0].messageId;
 fake.inbox.push({from:'recipient@example.com',messageId:'<reply-one@example.com>',raw:`From: recipient@example.com\r\nTo: contact@omnidigital.fr\r\nMessage-ID: <reply-one@example.com>\r\nIn-Reply-To: ${original}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBonjour, pouvez-vous préciser vos tarifs ?\r\n\r\nLe jeudi 29 octobre, OmniDigital a écrit :\r\n> Répondez stop pour ne plus être contacté.`});
 assert.equal((await request('/api/mail/sync',{})).data.imported,1);
 const state=(await request('/api/state')).data;assert.equal(state.replies.length,1);assert.equal(state.prospects[0].response_scenario,'Demande de devis / tarifs');assert.notEqual(state.prospects[0].status,'Opposition');assert.equal(state.metrics.replied,1);
 assert.equal((await request('/api/mail/sync',{})).data.imported,0);
 assert.equal((await request('/api/state')).data.replies.length,1);
});

test('IMAP stop received before sending cancels approval and blocks SMTP',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 const {p,m}=await approvedMail(request);
 await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at});
 await request(`/api/prospects/${p.id}/draft`,{});
 let pending=(await request('/api/state')).data.messages.find(x=>x.status==='Brouillon');
 await request(`/api/messages/${pending.id}/approve`,{confirm:pending.id});pending=(await request('/api/state')).data.messages.find(x=>x.id===pending.id);
 const original=fake.sent[0].messageId;
 fake.inbox.push({from:'recipient@example.com',messageId:'<stop@example.com>',raw:`From: recipient@example.com\r\nTo: contact@omnidigital.fr\r\nMessage-ID: <stop@example.com>\r\nIn-Reply-To: ${original}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNe me contactez plus. STOP.`});
 assert.equal((await request(`/api/messages/${pending.id}/send`,{confirm:pending.id,approvedAt:pending.approved_at})).status,400);
 assert.equal(fake.sent.length,1);assert.equal((await request('/api/state')).data.prospects[0].status,'Opposition');
});

test('mail config is optional, never exposes the password, and connection checks send nothing',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 assert.equal((await request('/api/mail/verify',{})).status,200);assert.equal(fake.sent.length,0);
 const state=(await request('/api/state')).data;assert.equal(state.integrations.mail.smtpHost,'smtp.hostinger.com');assert.equal(state.integrations.mail.password,undefined);
 assert.equal(readMailConfig({}).configured,false);
 assert.equal(readMailConfig({MAIL_PROVIDER:'other',MAIL_USER:'a@b.fr',MAIL_PASSWORD:'test'}).configured,false);
});

test('private dossier and PDF context never enter generated outgoing body',async t=>{
 const {request,db}=await fixture(t);
 const id=(await request('/api/prospects',{company:'Contexte privé',email:'context@example.com',notes:'NOTE INTERNE CONFIDENTIELLE',needs:'SEO local'})).data.id;
 db.prepare('UPDATE prospects SET pdf_text=? WHERE id=?').run('CONTENU PDF INTERNE',id);
 await request(`/api/prospects/${id}/sequence`,{});
 for(const m of (await request('/api/state')).data.messages){assert.doesNotMatch(m.body,/NOTE INTERNE CONFIDENTIELLE|CONTENU PDF INTERNE/);assert.match(m.internal_context,/NOTE INTERNE CONFIDENTIELLE/)}
});

test('SMTP followup must wait seven days even when already approved',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 const id=(await request('/api/prospects',{company:'SMTP intervalle',email:'recipient@example.com'})).data.id;
 await request(`/api/prospects/${id}/sequence`,{});
 let messages=(await request('/api/state')).data.messages.sort((a,b)=>a.sequence_stage-b.sequence_stage);
 await request(`/api/messages/${messages[0].id}/approve`,{confirm:messages[0].id});
 messages=(await request('/api/state')).data.messages.sort((a,b)=>a.sequence_stage-b.sequence_stage);
 await request(`/api/messages/${messages[0].id}/send`,{confirm:messages[0].id,approvedAt:messages[0].approved_at});
 await request(`/api/messages/${messages[1].id}/approve`,{confirm:messages[1].id});
 messages=(await request('/api/state')).data.messages.sort((a,b)=>a.sequence_stage-b.sequence_stage);
 assert.equal((await request(`/api/messages/${messages[1].id}/send`,{confirm:messages[1].id,approvedAt:messages[1].approved_at})).status,400);
 assert.equal(fake.sent.length,1);
});

test('large incoming mail from a known recipient pauses prospecting for manual review',async t=>{
 let fake;const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db)).service});
 const {p,m}=await approvedMail(request);
 await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at});
 await request(`/api/prospects/${p.id}/draft`,{});
 fake.inbox.push({from:'recipient@example.com',messageId:'<large@example.com>',raw:'x'.repeat(513*1024)});
 const result=(await request('/api/mail/sync',{})).data;assert.equal(result.reviewRequired,1);
 const state=(await request('/api/state')).data;assert.equal(state.messages.filter(m=>m.status==='Brouillon'||m.status==='Approuvé').length,0);
});

test('interrupted IMAP batch retries safely without losing or duplicating replies',async t=>{
 let fake;const options={};const {request}=await fixture(t,{serviceFactory:db=>(fake=fakeMailSetup(db,options)).service});
 const {m}=await approvedMail(request);await request(`/api/messages/${m.id}/send`,{confirm:m.id,approvedAt:m.approved_at});
 for(let i=0;i<2;i++)fake.inbox.push({from:'recipient@example.com',messageId:`<batch-${i}@example.com>`,raw:`From: recipient@example.com\r\nMessage-ID: <batch-${i}@example.com>\r\nIn-Reply-To: ${fake.sent[0].messageId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPouvez-vous préciser les informations ?`});
 options.failFetchOnce=true;
 assert.equal((await request('/api/mail/sync',{})).status,502);
 assert.equal((await request('/api/state')).data.replies.length,1);
 assert.equal((await request('/api/mail/sync',{})).status,200);
 assert.equal((await request('/api/state')).data.replies.length,2);
});
