import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp,openDatabase} from '../crm-server.js';
import {inspectWebsite} from '../site-audit.js';
import {runDigitalAudit} from '../digital-audit.js';
import {readQualificationConfig} from '../qualification.js';

const sirens=['732829320','552100554','542107651'];
function establishment(siren,seed='0001'){
  for(let i=0;i<10;i++){
    const siret=siren+seed+i;
    const sum=[...siret].reverse().reduce((n,d,j)=>{const v=Number(d)*(j%2?2:1);return n+(v>9?v-9:v);},0);
    if(sum%10===0)return siret;
  }
}
function registry(siren=sirens[0],patch={}){
  return {siren,nom_complet:'SOCIETE '+siren,nom_raison_sociale:'SOCIETE '+siren,etat_administratif:'A',
    nature_juridique:'5710',activite_principale:'43.21A',tranche_effectif_salarie:'12',
    siege:{siret:establishment(siren),etat_administratif:'A',region:'11',departement:'75',code_postal:'75001',
      libelle_commune:'Paris',adresse:'75001 Paris'},...patch};
}
const registryResponse=results=>Response.json({results,total_pages:1});
const html=(url,body,status=200)=>({url,status,contentType:'text/html',ttfbMs:100,bytes:body.length,html:body,redirects:[]});
const base='/api/discovery';
async function fixture(t,{fetcher=async()=>registryResponse([registry()]),inspect=async url=>html(url,'<h1>SIREN 732 829 320</h1>'),runner,auth=false,qualification,enrichment}={}){
  const db=openDatabase(':memory:');
  const app=createApp({db,fetcher,inspect,config:{user:auth?'admin':'',password:'test-password',publicUrl:'https://crm2.omnidigital.fr',pagespeedKey:'',qualification}});
  const service=app.locals.discovery;
  if(runner)service.runner=runner;
  if(enrichment)service.enrichment=enrichment;
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address='http://127.0.0.1:'+server.address().port;
  const request=async(path,data,headers={})=>{
    const r=await fetch(address+path,{method:data===undefined?'GET':'POST',headers:{
      'Content-Type':'application/json',...(auth?{Authorization:'Basic '+Buffer.from('admin:test-password').toString('base64')}:{}),...headers
    },body:data===undefined?undefined:JSON.stringify(data)});
    const body=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();
    return {status:r.status,data:body};
  };
  async function search(criteria={}){
    const started=await request(base+'/runs',criteria);
    assert.equal(started.status,202,JSON.stringify(started.data));
    await service.searches.get(started.data.id)?.work;
    return (await request(base+'/runs/'+started.data.id)).data;
  }
  t.after(async()=>{
    await service.close();
    await app.locals.digitalAudit.close();
    await app.locals.qualification.close();
    await new Promise(resolve=>server.close(resolve));
    db.close();
  });
  return {db,request,service,search};
}
const act=(f,id,action,data={})=>f.request(base+'/candidates/'+id+'/'+action,data);
const approve=(f,id,reviewed=false)=>act(f,id,'decision',{decision:'approved',reviewed});

test('official search applies geography, sector and workforce filters, preserving unknown sizes and source evidence',async t=>{
  let outgoing;
  const f=await fixture(t,{fetcher:async(url,options)=>{
    outgoing=new URL(url);
    assert.equal(options.redirect,'error');
    return registryResponse([
      registry(),registry(sirens[1],{tranche_effectif_salarie:null}),
      registry(sirens[2],{activite_principale:'56.10A'}),
      registry(sirens[2],{siege:{...registry(sirens[2]).siege,departement:'69'}}),
      registry('000000000')
    ]);
  }});
  const run=await f.search({location:'department',area:'75',sectors:['Bâtiment'],sizes:['11–50 salariés'],limit:10});
  assert.equal(run.state,'completed');
  assert.deepEqual(run.results.map(r=>r.company.siren).sort(),sirens.slice(0,2).sort());
  assert.equal(outgoing.origin,'https://recherche-entreprises.api.gouv.fr');
  assert.equal(outgoing.searchParams.get('departement'),'75');
  assert.equal(outgoing.searchParams.get('section_activite_principale'),'F');
  assert.equal(run.results[0].company.source,'Annuaire des Entreprises');
  assert.match(run.results[0].company.source_url,/annuaire-entreprises/);
  assert.ok(run.results[0].company.collected_at);
  assert.equal(run.results[0].digital,'Présence digitale inconnue');
  assert.equal(run.results[0].scores.intent.score,null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM companies').get().n,0);
  assert.equal((await f.request(base+'/runs',{limit:26})).status,400);
  assert.equal((await f.request(base+'/runs',{location:'postal',area:'Paris'})).status,400);
});
test('invalid SIRET, mismatched SIREN, restricted diffusion and closed establishments are excluded',async t=>{
  const f=await fixture(t,{fetcher:async()=>registryResponse([
    registry(sirens[0],{siege:{...registry().siege,siret:'12345678901234'}}),
    registry(sirens[1],{siege:registry().siege}),
    registry(sirens[2],{statut_diffusion:'P'}),
    registry(sirens[0],{etat_administratif:'C'}),
    registry(sirens[0],{siege:{...registry().siege,etat_administratif:'F'}})
  ])});
  const run=await f.search();
  assert.equal(run.state,'completed');
  assert.equal(run.stats.found,0);
  assert.equal(run.source_count,5);
});
test('empty responses, malformed JSON, network errors and provider quotas have distinct safe outcomes',async t=>{
  let mode=0;
  const f=await fixture(t,{fetcher:async()=>{
    if(mode===0)return registryResponse([]);
    if(mode===1)return new Response('not json');
    if(mode===2)throw Error('secret upstream error');
    return new Response('',{status:429});
  }});
  assert.equal((await f.search()).stats.found,0);
  for(mode of [1,2,3]){
    const run=await f.search();
    assert.equal(run.state,'failed');
    assert.equal(run.requests,1);
    assert.doesNotMatch(run.error,/secret upstream/);
    if(mode===3)assert.match(run.error,/Quota/);
  }
});
test('request budget persists, search cancellation aborts transport and a second search cannot start concurrently',async t=>{
  let signal;
  const f=await fixture(t,{fetcher:async(url,options)=>{
    signal=options.signal;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const started=await f.request(base+'/runs',{});
  assert.equal(started.status,202);
  assert.equal((await f.request(base+'/runs',{})).status,429);
  assert.equal((await f.request(base+'/runs/'+started.data.id+'/cancel',{})).status,200);
  assert.equal(signal.aborted,true);
  assert.equal((await f.request(base+'/runs/'+started.data.id)).data.state,'cancelled');
  const insert=f.db.prepare("INSERT INTO discovery_usage VALUES('registry',?)");
  for(let i=0;i<40;i++)insert.run(new Date().toISOString());
  const run=await f.search();
  assert.equal(run.state,'failed');
  assert.equal(run.requests,0);
  assert.match(run.error,/Limite locale/);
});
test('public website checks find matching legal identifiers and preserve unrelated sites as unconfirmed',async t=>{
  let reads=0;
  const f=await fixture(t,{inspect:async url=>{
    reads++;
    if(url.includes('unrelated'))return html(url,'<h1>SIRET 12345678901234</h1>');
    if(url.includes('mentions'))return html(url,'<p>SIREN 732 829 320</p>');
    return html(url,'<a href="/mentions-legales">Mentions légales</a>');
  }});
  const run=await f.search(),id=run.results[0].id;
  assert.equal((await act(f,id,'verify',{url:'https://unrelated.example.com/'})).data.status,'unconfirmed');
  assert.equal((await act(f,id,'audit')).status,400);
  const verified=await act(f,id,'verify',{url:'https://company.example.com/?secret=never'});
  assert.equal(verified.data.confirmed,true);
  assert.equal(verified.data.proof_url,'https://company.example.com/mentions-legales');
  assert.doesNotMatch(JSON.stringify(verified),/secret=never/);
  await act(f,id,'verify',{url:'https://company.example.com/'});
  assert.equal(reads,3);
});
test('SSRF guard rejects local IPs, custom ports, credentials, and unsafe redirect destinations',async t=>{
  let attempts=0;
  const inspect=(url,options)=>inspectWebsite(url,{...options,request:async target=>{
    attempts++;
    if(target.hostname==='outside.example.com')return {url:target.href,redirect:'http://127.0.0.1/',status:302};
    throw Object.assign(new Error('Les adresses locales, privées et réservées ne peuvent pas être auditées.'),{status:400});
  }});
  const f=await fixture(t,{inspect});
  const id=(await f.search()).results[0].id;
  for(const url of ['http://127.0.0.1','http://[::1]','http://169.254.169.254/','https://foo:pass@example.com','https://example.com:8080','file:///etc/passwd']){
    assert.equal((await act(f,id,'verify',{url})).status,400);
  }
  assert.equal(attempts,0);
  assert.equal((await act(f,id,'verify',{url:'https://outside.example.com'})).status,400);
});
test('audit engine v3 is reused, cached, and attached to the imported company for qualification',async t=>{
  let calls=0;
  const f=await fixture(t,{runner:async(url,options)=>{
    calls++;
    assert.equal(options.pagespeedKey,undefined);
    return runDigitalAudit(url,{...options,inspect:async target=>html(target,'<html lang="fr"><title>Exemple</title><h1>Notre entreprise</h1></html>')});
  }});
  const id=(await f.search()).results[0].id;
  assert.equal((await act(f,id,'verify',{url:'https://company.example.com'})).data.confirmed,true);
  assert.equal((await act(f,id,'audit')).status,200);
  assert.equal((await act(f,id,'audit')).data.cached,true);
  assert.equal(calls,1);
  assert.equal((await approve(f,id)).status,200);
  const result=await f.request(base+'/import',{ids:[id]});
  assert.equal(result.status,201,JSON.stringify(result.data));
  const companyId=result.data.imported[0].company_id;
  const audit=f.db.prepare('SELECT payload FROM audits WHERE company_id=?').get(companyId);
  assert.equal(JSON.parse(audit.payload).engine_version,3);
  const qualification=await f.request('/api/companies/'+companyId+'/qualification');
  assert.equal(qualification.status,200);
  assert.ok(qualification.data.current.need.audit_id);
  assert.equal(qualification.data.status.configured,false);
  assert.equal((await f.request('/api/companies/'+companyId+'/qualification/analyse',{confirm:companyId})).status,503);
  assert.equal((await f.request(base+'/import',{ids:[id]})).data.imported[0].company_id,companyId);
});
test('manual approval and batch import are atomic, deduplicate SIREN and preserve existing companies',async t=>{
  const f=await fixture(t,{fetcher:async()=>registryResponse([registry(),registry(sirens[1]),registry(sirens[2])])});
  const [a,b,c]=(await f.search()).results;
  assert.equal((await approve(f,a.id)).status,200);
  assert.equal((await f.request(base+'/import',{ids:[a.id,b.id]})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM companies').get().n,0);
  assert.equal((await approve(f,b.id)).status,200);
  assert.equal((await f.request(base+'/import',{ids:[a.id,b.id]})).data.imported.length,2);
  const existing=await f.request('/api/companies',{name:c.company.name,siren:c.company.siren});
  assert.equal(existing.status,201);
  assert.equal((await approve(f,c.id)).status,409);
  const history=(await f.request(base+'/runs')).data.runs[0];
  assert.equal(history.imported,2);
  assert.equal(history.duplicates,1);
});
test('ambiguous matches require explicit review and an opposition added after approval blocks import',async t=>{
  const f=await fixture(t);
  const id=(await f.search()).results[0].id;
  const added=await f.request('/api/companies',{name:'SOCIETE '+sirens[0]});
  assert.equal(added.status,201);
  assert.equal((await approve(f,id)).status,409);
  assert.equal((await approve(f,id,true)).status,200);
  f.db.prepare("UPDATE companies SET business_status='Opposition' WHERE id=?").run(added.data.id);
  assert.equal((await f.request(base+'/import',{ids:[id]})).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM companies').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM contacts').get().n,0);
});
test('retention removes old draft results without deleting commercial records',async t=>{
  const f=await fixture(t);
  const run=await f.search(),id=run.results[0].id;
  await approve(f,id);
  await f.request(base+'/import',{ids:[id]});
  f.db.prepare("UPDATE discovery_runs SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(run.id);
  assert.equal((await f.request(base+'/runs')).data.runs.length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM discovery_candidates').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM companies').get().n,1);
});
test('prospect routes inherit authentication and write origin protection',async t=>{
  const f=await fixture(t,{auth:true});
  assert.equal((await f.request(base+'/runs',undefined,{Authorization:''})).status,401);
  assert.equal((await f.request(base+'/runs',{}, {Origin:'https://evil.example'})).status,403);
  const page=await f.request('/');
  assert.match(page.data,/prospect-discovery-ui\.js/);
});


test('an imported company reuses configured Gemini only on explicit qualification, with no contact or company identity in the request',async t=>{
  let requests=0;
  const qualification=readQualificationConfig({GEMINI_API_KEY:'synthetic-key',GEMINI_BILLING_MODE:'paid',GEMINI_ALLOW_CRM_DATA:'true'});
  const f=await fixture(t,{qualification,fetcher:async(url,options)=>{
    if(String(url).startsWith('https://recherche-entreprises.api.gouv.fr/'))return registryResponse([registry()]);
    requests++;
    assert.match(String(url),/^https:\/\/generativelanguage.googleapis.com\//);
    assert.doesNotMatch(options.body,/732829320|SOCIETE|secret@example.com/);
    const payload={summary:'Une fiche publique est disponible.',target_fit:'Une adéquation à vérifier.',needs:[],recommended_services:[],
      objections_hypotheses:[],approach:'Vérifier la situation de l’entreprise.',next_action:'Confirmer les informations publiques.',
      missing_information:['Données du site'],confidence:'Faible'};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(payload)}]}}]});
  }});
  const id=(await f.search()).results[0].id;
  await approve(f,id);
  const imported=await f.request(base+'/import',{ids:[id]});
  assert.equal(requests,0);
  const cid=imported.data.imported[0].company_id;
  const result=await f.request('/api/companies/'+cid+'/qualification/analyse',{confirm:cid});
  assert.equal(result.status,201,JSON.stringify(result.data));
  assert.equal(result.data.provider,'gemini');
  assert.equal(requests,1);
});
test('published generic channels are sourced without importing personal contacts, and suppression survives deletion',async t=>{
  const f=await fixture(t,{inspect:async url=>html(url,`<p>SIREN 732 829 320</p>
    <a href="mailto:contact@company.example.com">Contact</a><a href="mailto:person@company.example.com">Nom</a>
    <a href="tel:+33123456789">Standard</a><a href="tel:0612345678">Mobile</a>`)});
  const id=(await f.search()).results[0].id;
  const verified=await act(f,id,'verify',{url:'https://company.example.com/'});
  assert.deepEqual(verified.data.channels,{email:'contact@company.example.com',phone:'0123456789'});
  await approve(f,id);
  // Tombstone directly represents the hash left behind by the original contact after deletion.
  const {createHash}=await import('node:crypto');
  const fingerprint=createHash('sha256').update('societe732829320').digest('hex');
  f.db.prepare("INSERT INTO contact_suppressions(kind,fingerprint,prospect_id,created) VALUES('company',?,'deleted-prospect',?)").run(fingerprint,new Date().toISOString());
  assert.equal((await f.request(base+'/import',{ids:[id]})).status,409);
  f.db.prepare('DELETE FROM contact_suppressions').run();
  assert.equal((await f.request(base+'/import',{ids:[id]})).status,201);
  assert.deepEqual({...f.db.prepare('SELECT general_email,general_phone FROM companies').get()},
    {general_email:'contact@company.example.com',general_phone:'0123456789'});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM contacts').get().n,0);
});

test('batch enriches verified domain with published general channels and keeps conflicting evidence out of import',async t=>{
 const f=await fixture(t,{
  enrichment:{enabled:true,key:'mock-only',batch:10,monthly:300},
  fetcher:async url=>String(url).includes('brave.com')?Response.json({web:{results:[{url:'https://wrong.example/'},{url:'https://good.example/'}]}}):
    registryResponse([registry(sirens[0],{date_creation:'2001-01-01',dirigeants:[{type_dirigeant:'personne physique',nom:'Exemple',prenoms:'Camille',qualite:'Présidente'}]}),
      registry(sirens[1],{etat_administratif:'C'})]),
  inspect:async url=>html(url,url.includes('wrong')?'Autre entreprise':url.endsWith('/contact')?
    '<a href="mailto:info@good.example">Email</a><a href="tel:+33123456789">Standard</a><form></form>':
    'SIREN 732 829 320 <a href="/contact">Contact</a><a href="mailto:contact@good.example">Email</a>')
 });
 const run=await f.search();
 assert.equal(run.results.length,1);
 const id=run.results[0].id,path=base+'/runs/'+run.id+'/enrich';
 assert.equal((await f.request(path,{ids:[id]})).status,202);
 await f.service.enrichmentJob?.work;
 const result=(await f.request(base+'/runs/'+run.id)).data;
 const [row]=result.results;
 assert.equal(result.enrichment.done,1);
 assert.equal(row.company.creation_date,'2001-01-01');
 assert.equal(row.company.responsible[0].role,'Présidente');
 assert.equal(row.verification.url,'https://good.example/');
 assert.equal(row.verification.channels.phone,'0123456789');
 assert.equal(row.verification.channels.email,undefined);
 assert.equal(row.verification.fields.email.alternatives[0].value,'info@good.example');
 assert.equal(row.verification.fields.form.url,'https://good.example/contact');
 assert.equal(row.enrichment.options.length,2);
 assert.equal((await act(f,id,'assisted',{field:'email',value:'contact@good.example',url:'https://www.pagesjaunes.fr/'})).status,200);
 assert.equal((await approve(f,id)).status,200);
 assert.equal((await f.request(base+'/import',{ids:[id]})).status,201);
 const company=f.db.prepare('SELECT general_email,general_phone FROM companies').get();
 assert.equal(company.general_email,'');
 assert.equal(company.general_phone,'0123456789');
 assert.equal(f.db.prepare('SELECT count(*) n FROM contacts').get().n,0);
});

test('enrichment stops on provider quota, resumes pending work and does not choose between matching domains',async t=>{
 let searches=0;
 const f=await fixture(t,{
  enrichment:{enabled:true,key:'mock-only',batch:10,monthly:300},
  fetcher:async url=>String(url).includes('brave.com')?(++searches===1?new Response('',{status:429}):
    Response.json({web:{results:[{url:'https://first.example/'},{url:'https://second.example/'}]}})):registryResponse([registry()])
 });
 const run=await f.search(),path=base+'/runs/'+run.id+'/enrich';
 await f.request(path,{ids:[run.results[0].id]});
 await f.service.enrichmentJob?.work;
 assert.equal(f.service.enrichmentStatus(run.id).state,'failed');
 assert.match(f.service.enrichmentStatus(run.id).error,/Quota/);
 assert.equal((await f.request(path,{resume:true})).status,202);
 await f.service.enrichmentJob?.work;
 const [row]=f.service.view(run.id).results;
 assert.equal(row.enrichment.status,'review');
 assert.equal(row.enrichment.options.filter(option=>option.confirmed).length,2);
 assert.equal(row.verification.confirmed,undefined);
 assert.equal(f.service.enrichmentStatus(run.id).done,1);
});

test('cancellation preserves pending selection for a later resume',async t=>{
 const f=await fixture(t,{
  enrichment:{enabled:true,key:'mock-only',batch:10,monthly:300},
  fetcher:async (url,options)=>String(url).includes('brave.com')?
    new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})):
    registryResponse([registry()])
 });
 const run=await f.search(),path=base+'/runs/'+run.id+'/enrich';
 await f.request(path,{ids:[run.results[0].id]});
 assert.equal((await f.request(path+'/cancel',{})).status,200);
 await f.service.enrichmentJob?.work;
 assert.equal(f.service.enrichmentStatus(run.id).state,'cancelled');
 assert.equal(f.service.enrichmentStatus(run.id).done,0);
});

test('opt-in search starts enrichment automatically, reuses cached results, and keeps an unverifiable site unconfirmed',async t=>{
 let calls=0;
 const f=await fixture(t,{
  enrichment:{enabled:true,key:'mock-only',batch:1,monthly:300},
  fetcher:async url=>String(url).includes('brave.com')?(calls++,Response.json({web:{results:[{url:'https://wrong.example/'}]}})):
    registryResponse([registry()]),
  inspect:async url=>html(url,'Page sans identifiant')
 });
 const run=await f.search({autoEnrich:true});
 await f.service.enrichmentJob?.work;
 const [row]=f.service.view(run.id).results;
 assert.equal(row.enrichment.status,'review');
 assert.equal(row.verification.confirmed,undefined);
 assert.equal(calls,1);
 assert.equal((await f.request(base+'/runs/'+run.id+'/enrich',{ids:[row.id]})).status,202);
 await f.service.enrichmentJob?.work;
 assert.equal(calls,1);
});

test('official matching establishments without department remain discoverable by commune code',async t=>{
  const row=registry();
  const f=await fixture(t,{fetcher:async url=>{
    const params=new URL(url).searchParams;
    assert.equal(params.has('minimal'),false);
    return registryResponse([{...row,siege:{...row.siege,departement:'69'},matching_etablissements:[
      {siret:establishment(row.siren,'0002'),etat_administratif:'A',commune:'75115',code_postal:'75015',libelle_commune:'Paris 15e Arrondissement',region:'11',statut_diffusion_etablissement:'O'}
    ]}]);
  }});
  const run=await f.search({location:'department',area:'75'});
  assert.equal(run.stats.found,1);
  assert.equal(run.results[0].company.postal_code,'75015');
  assert.equal((await f.search({location:'city',area:'Paris'})).stats.found,1);
});

test('restricted establishments and official commercial opposition are excluded',async t=>{
  const f=await fixture(t,{fetcher:async()=>registryResponse([
    registry(sirens[0],{siege:{...registry().siege,statut_diffusion_etablissement:'P'}}),
    registry(sirens[1],{opposition_diffusion_commerciale:true})
  ])});
  assert.equal((await f.search()).stats.found,0);
});
