import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';

function render(preview){
 const form={querySelector:()=>({})},dialog={innerHTML:'',querySelector:()=>form,showModal(){this.open=true;}};
 const source=readFileSync(new URL('../static/app.js',import.meta.url),'utf8');
 const renderer=source.slice(source.indexOf('function showPdfReview('),source.indexOf("\n$('#import-pdf').onclick"));
 const ctx=vm.createContext({pdfReview:dialog,preview,esc:value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))});
 vm.runInContext(renderer+'\nshowPdfReview(preview);',ctx);
 assert.ok(dialog.open);return load(dialog.innerHTML);
}

test('review renders all extracted fields, unchanged values, separate targets and missing channels',()=>{
 const $=render({company:'Atelier',fields:[
  {key:'name',target:'company',label:'Entreprise',value:'Atelier',unchanged:true},
  {key:'general_email',target:'company',label:'Email général',value:'contact@example.fr'},
  {key:'display_name',target:'contact',label:'Dirigeant',value:'Camille'}
 ],missing:[{key:'email',target:'contact',label:'Email du contact'}],supplementary:[{label:'Forme juridique',value:'EURL'}],opportunities:['Portail client à confirmer'],warnings:['Coordonnées générales distinctes.']});
 assert.equal($('fieldset').length,3);
 assert.match($('section').eq(0).text(),/contact@example.fr/);
 assert.doesNotMatch($('section').eq(1).text(),/contact@example.fr/);
 assert.match($('section').eq(1).text(),/Camille/);assert.match($('details').text(),/Email du contact/);
 assert.match($.text(),/Déjà présent/);assert.match($.text(),/EURL/);assert.match($.text(),/hypothèses à confirmer/);
 assert.match($.text(),/Aucun email ne sera envoyé/);
});

test('review requires each conflict decision, never preselects one and escapes PDF content',()=>{
 const evil='<img src=x onerror="bad()"><script>bad()</script>';
 const $=render({company:evil,fields:[{key:'general_email',target:'company',label:'Email',value:evil,current:'original@example.fr',conflict:true}],supplementary:[{label:evil,value:evil}],opportunities:[evil],warnings:[evil]});
 assert.equal($('input[type=radio]').length,2);assert.equal($('input[required]').length,1);assert.equal($('input[checked]').length,0);
 assert.equal($('script,img,[onerror]').length,0);assert.match($.text(),/onerror/);
 assert.deepEqual($('input').map((i,node)=>$(node).attr('value')).get(),['crm','pdf']);
});
