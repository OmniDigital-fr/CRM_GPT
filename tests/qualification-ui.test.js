import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';
import {once} from 'node:events';
import {openDatabase,createApp} from '../crm-server.js';
import {QualificationService,readQualificationConfig} from '../qualification.js';

// Execute the production renderers against real API fixtures. This deliberately
// does not claim to replace browser layout or accessibility tree verification.
async function ui(t,{configured=false}={}){
  const db=openDatabase(':memory:'),service=new QualificationService({db,config:readQualificationConfig({GEMINI_API_KEY:configured?'unit-test-key':'',GEMINI_BILLING_MODE:'paid',GEMINI_ALLOW_CRM_DATA:'true'})}),app=createApp({db,config:{user:'',password:'',publicUrl:'',pagespeedKey:''},qualificationService:service});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const api=async(path,data)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const json=await r.json();if(!r.ok)throw Error(json.error);return json;};
  t.after(async()=>{await service.close();await app.locals.digitalAudit.close();await new Promise(r=>server.close(r));db.close();});
  const company=await api('/api/companies',{name:'Entreprise UI',country:'France',company_size:'10',industry:'Services'});
  const dialogs=[],listeners={};
  const document={body:{append(d){dialogs.push(d);}},createElement(){return {dataset:{},setAttribute(){},open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;}};},addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
  const state={...(await api('/api/companies')),...(await api('/api/contacts')),entityMeta:await api('/api/entities/meta'),qualificationIndex:(await api('/api/qualification/companies')).companies};
  const ctx=vm.createContext({document,api,state,view:'companies',$:()=>({value:''}),relatedCommercialHtml:()=>'<p>Suivi commercial conservé</p>',esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),notice(){},refresh:async()=>{},Intl,Date,console});
  for(const path of ['static/qualification-ui.js','static/entities-ui.js'])vm.runInContext(readFileSync(new URL('../'+path,import.meta.url),'utf8'),ctx,{filename:path});
  return {db,api,ctx,company,dialogs,listeners};
}
test('company record embeds Qualification IA, disabled API state, manual decisions, evidence and catalogue using actual API data',async t=>{
  const f=await ui(t);await vm.runInContext(`entityOpen('companies','${f.company.id}')`,f.ctx);
  const $=load(f.dialogs[0].innerHTML);
  assert.ok($('[role=tab]').toArray().some(el=>$(el).text()==='Qualification IA'));
  assert.equal($('.qualification-score').length,3);assert.equal($('[data-qual-ai] button[disabled]').length,1);assert.match($('.qualification-root').text(),/Clé Gemini non configurée/);assert.match($('.qualification-root').text(),/Inconnue/);
  assert.equal($('[data-qual-service]').length,12);assert.equal($('[data-qual-priority]').length,1);assert.equal($('[data-qual-signal]').length,1);
});
test('all company list sort and filter modes execute without renderer errors and display independent scores',async t=>{
  const f=await ui(t);
  for(const sort of ['name','created_at','opportunity_score','fit_score','need_score','qualPriority']){
    vm.runInContext(`entityFilters.companies.sort='${sort}'`,f.ctx);const $=load(vm.runInContext('entityRender()',f.ctx));assert.equal($('tbody tr').length,1);assert.match($('tbody').text(),/Fit 100/);assert.equal($('[data-entity-filter=sort] option[selected]').attr('value'),sort==='name'?undefined:sort);
  }
  vm.runInContext("entityFilters.companies.qualPriority='Priorité haute'",f.ctx);assert.match(vm.runInContext('entityRender()',f.ctx),/Aucun résultat/);
  vm.runInContext("entityFilters.companies={minNeed:'30'}",f.ctx);assert.match(vm.runInContext('entityRender()',f.ctx),/Aucun résultat/);
});
test('malicious company/audit/model text is escaped in current and historical renderers',async t=>{
  const f=await ui(t,{configured:true});
  const evil='<img src=x onerror="alert(1)"><script>bad()</script>';
  await f.api(`/api/companies/${f.company.id}/qualification/signals`,{type:'Demande d’informations',evidence:evil,source:evil,observed_at:new Date().toISOString(),confirmed:true});
  const html=await vm.runInContext(`qualificationHtml('${f.company.id}')`,f.ctx),$=load(html);
  assert.equal($('script,img,[onerror]').length,0);assert.match($.text(),/onerror/);assert.equal($('[data-qual-ai] button[disabled]').length,0);
  const malicious={summary:evil,target_fit:evil,needs:[{text:evil,evidence_ids:['fit:Effectif']}],recommended_services:[],objections_hypotheses:[evil],approach:evil,next_action:evil,missing_information:[evil],confidence:'Faible'};
  f.ctx.malicious=malicious;assert.equal(load(vm.runInContext('qualificationAnalysis(malicious)',f.ctx))('script,img,[onerror]').length,0);
});


test('AI settings render connection action, limits and safe integration status',async t=>{
  const f=await ui(t);
  f.ctx.geminiStatus=await f.api('/api/qualification/status');
  const $=load(vm.runInContext('qualificationSettings(geminiStatus)',f.ctx));
  assert.match($('h2').text(),/Intelligence artificielle.*Gemini/);
  assert.match($.text(),/gemini-3.5-flash-lite/);
  assert.match($.text(),/0 \/ 15 aujourd’hui/);
  assert.equal($('[data-gemini-test][disabled]').length,1);
  assert.equal($('input').length,0);
});
