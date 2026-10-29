import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,openDatabase,validateConfig,importText,extractPdf} from '../server.js';

async function fixture(t,overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'omni-node-'));
  const db=openDatabase(join(dir,'crm.sqlite3'));
  const config={production:false,user:'',password:'',publicUrl:'',pagespeedKey:'',...overrides.config};
  const server=createApp({db,config,...overrides}).listen(0,'127.0.0.1');await once(server,'listening');
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
