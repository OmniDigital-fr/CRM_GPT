import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOverview,digitalAuditPdf} from '../audit-report.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';

const sample=(score=58)=>({engine_version:3,url:'https://example.fr/?token=not-to-copy',date:'2026-11-05T10:00:00Z',execution_status:'completed',pages:[{url:'https://example.fr'}],
 pagespeed:{mobile:{state:'available',scores:{performance:score,accessibility:90,seo:100,'best-practices':85},lab:{'largest-contentful-paint':{value:3200},'cumulative-layout-shift':{value:0.08}},field:{LCP:{value:1900}}},desktop:{state:'available',scores:{performance:96}}},controls:[{id:'page0-title',category:'SEO technique',label:'Balise title',page_url:'https://example.fr',status:'Conforme au contrôle'}],commercial_opportunities:[],errors:[]});

test('overview shows actual Google notes, mobile lab timings and a proportionate conclusion',()=>{
 const o=auditOverview(sample());
 assert.equal(o.google[0].mobile,58);assert.equal(o.google[0].desktop,96);assert.equal(o.google[0].mobile_label,'À améliorer');
 assert.equal(o.google[3].key,'best-practices');assert.equal(o.google[3].desktop_label,'Non mesuré');
 assert.deepEqual(o.timings,[{label:'Affichage du contenu principal',value:3.2,unit:'s'},{label:'Stabilité de l’affichage',value:0.08,unit:''}]);
 assert.match(o.verdict,/ne suffit pas à justifier une refonte/);assert.match(o.positives.join(' '),/titre/);
 assert.doesNotMatch(o.ai_prompt,/not-to-copy|1900/); // No URL query or substitution of real-user data for lab data.
});
test('missing, failed and invalid PageSpeed results stay unknown, including valid zero scores',()=>{
 const r=sample(0);assert.equal(auditOverview(r).google[0].mobile_label,'Faible');
 assert.match(auditOverview(r).verdict,/vitesse faible/);
 for(const invalid of [NaN,Infinity,101,-1,'58',null,undefined]){r.pagespeed.mobile.scores.performance=invalid;assert.equal(auditOverview(r).google[0].mobile,null);}
 r.pagespeed.mobile={state:'quota',scores:{performance:100}};r.pagespeed.desktop={state:'unconfigured'};
 const o=auditOverview(r);assert.equal(o.google[0].mobile,null);assert.match(o.verdict,/pas été mesurée/);assert.equal(o.timings.length,0);
 r.pages=[];assert.match(auditOverview(r).verdict,/pas pu être lu/);assert.deepEqual(auditOverview(r).priorities,[]);
});
test('excellent performance does not certify the whole site or manufacture digital needs',()=>{
 const o=auditOverview(sample(98));assert.match(o.verdict,/autres aspects/);
 assert.deepEqual(o.priorities,[]);assert.doesNotMatch(o.next,/refonte|automatisation|intelligence artificielle/);
});
test('overview groups a maximum of three priorities and copy prompt excludes private CRM fields',()=>{
 const r=sample();r.contacts=[{email:'private@example.fr'}];r.notes='SECRET CRM';r.html='<script>PRIVATE HTML</script>';
 r.commercial_opportunities=Array.from({length:6},(_,i)=>({plain_problem:i<2?'Prise de contact':'Thème '+i,problem:'Contrôle '+i,plain_observation:'Observation limitée à la page.',page_url:'https://example.fr',priority:'Moyenne'}));
 const o=auditOverview(r);assert.equal(o.priorities.length,3);assert.equal(o.priorities[0].topic,'Confort et rapidité de consultation');
 assert.equal(o.priorities.filter(item=>item.topic==='Prise de contact').length,1);
 assert.doesNotMatch(o.ai_prompt,/private@example|SECRET CRM|PRIVATE HTML/);assert.match(o.ai_prompt,/Ne prétends pas avoir visité/);
});

function renderer(audit){
 const listeners={};const ctx=vm.createContext({document:{addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)},
  esc:value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),auditDate:value=>value});
 vm.runInContext(readFileSync(new URL('../static/digital-audit-ui.js',import.meta.url),'utf8'),ctx);
 ctx.audit=audit;return {ctx,listeners,html:()=>vm.runInContext('digitalSimpleSummary(audit)',ctx)};
}
const diagnostic={title:'Diagnostic approfondi',company:{},presence:{observations:[]},opportunities:[],ai:{opportunities:[],questions:[]},recommendations:[],questions:[],missing:[]};
test('summary renderer exposes four score comparisons, limited actions and collapsed deeper diagnosis',()=>{
 const f=renderer({overview:auditOverview(sample()),diagnostic,created_at:'2026-11-05'}),$=load(f.html());
 assert.equal($('.digital-google-table tbody tr').length,4);assert.equal($('.digital-google-value').length,8);
 assert.match($('.digital-google-table').text(),/58\/100/);assert.match($('.digital-google-table').text(),/Non mesuré/);
 assert.equal($('.digital-transformation-details[open]').length,0);assert.equal($('[data-digital-copy-ai]').length,1);
 assert.match($.text(),/sans IA générative/);assert.match($.text(),/Aucun appel ni envoi/);
 f.ctx.audit.diagnostic={...diagnostic,restricted:true};assert.match(load(f.html())('.digital-next').text(),/restrictions de contact en interne/);
 assert.match(renderer({overview:{},diagnostic}).html(),/Résumé indisponible/);
});
test('report rendering escapes site content and copying the AI summary performs no API call',async()=>{
 const audit={overview:auditOverview(sample()),diagnostic,created_at:'2026-11-05'};audit.overview.verdict='<img src=x onerror="bad()">';
 const f=renderer(audit),$=load(f.html());assert.equal($('img,script,[onerror]').length,0);
 let copied='';f.ctx.navigator={clipboard:{writeText:async value=>copied=value}};f.ctx.notice=()=>{};
 f.ctx.api=()=>{throw Error('Unexpected API request')};
 vm.runInContext('digitalCurrent=audit',f.ctx);
 await f.listeners.click[0]({target:{closest:()=>({hasAttribute:key=>key==='data-digital-copy-ai',dataset:{}})}});
 assert.equal(copied,audit.overview.ai_prompt);
});
test('commercial PDF includes measured notes and the plain conclusion while preserving the technical export',async()=>{
 const r=sample();const bytes=await digitalAuditPdf({id:'simple',result:r,created_at:r.date},{name:'Exemple',website:'https://example.fr'},{audience:'commercial'});
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
 try{const doc=await task.promise;assert.ok(doc.numPages<=2);let content='';for(let i=1;i<=doc.numPages;i++)content+=(await(await doc.getPage(i)).getTextContent()).items.map(item=>item.str||'').join(' ');
 assert.match(content,/notes Google PageSpeed/);assert.match(content,/58\/100/);assert.match(content,/sans IA générative/);assert.doesNotMatch(content,/Opportunité potentielle/);
 }finally{await task.destroy();}
});
