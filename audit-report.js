import {fileURLToPath} from 'node:url';
import PDFDocument from 'pdfkit';
const text=v=>String(v??'').normalize('NFC').replace(/[–—‑]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\x7e\u00a0-\u00ffŒœ€\n]/gu,'?');
export function auditOverview(result){
 const priorities=[],seen=new Set();
 const rank={Haute:0,Moyenne:1,Faible:2};
 const opportunities=[...(result.commercial_opportunities||[])].sort((a,b)=>(rank[a.priority]??3)-(rank[b.priority]??3));
 for(const item of opportunities){
  const topic=item.plain_problem||item.problem;
  if(!topic||seen.has(topic))continue;
  seen.add(topic);
  const control=(result.controls||[]).find(row=>row.label===item.problem&&row.page_url===item.page_url);
  priorities.push({topic,priority:item.priority,observation:item.plain_observation||item.problem,
   impact:item.probable_impact,action:control?.recommendation||item.recommended_service});
  if(priorities.length===3)break;
 }
 const pages=result.pages?.length||0;
 const state=result.execution_status;
 return {
  priorities:pages?priorities:[],
  positives:(result.summary?.business_positives||[]).slice(0,3),
  coverage:pages?pages+' page(s) HTML examinée(s).':'Aucune page HTML exploitable.',
  limits:(result.errors||[]).map(error=>error.scope+': '+error.message),
  next:!pages?'Confirmer l’adresse du site et relancer l’audit quand la page sera accessible.':
   priorities.length?'Vérifier la première piste dans les conditions réelles d’utilisation, puis décider de l’action avec l’entreprise.':
   'Valider le parcours sur téléphone et vérifier les points que l’audit automatique n’a pas pu couvrir.',
  status:!pages?'Audit sans résultat exploitable':state==='partial'?'Audit partiel':'Audit réalisé',
  speed:['mobile','desktop'].map(device=>({device,score:result.pagespeed?.[device]?.scores?.performance??null}))
 };
}
export function digitalAuditPdf(audit,company,{audience='commercial'}={}){
 return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:46,bufferPages:true,info:{Title:audience==='technical'?'Rapport technique interne - Omni Digital':'Synthèse commerciale - Omni Digital',Author:'Omni Digital',Subject:'Audit digital indicatif'}});doc.registerFont('AuditSans',fileURLToPath(new URL('./assets/AuditSans.ttf',import.meta.url)));doc.registerFont('AuditSans-Bold',fileURLToPath(new URL('./assets/AuditSans-Bold.ttf',import.meta.url)));const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const width=doc.page.width-92;const ensure=n=>{if(doc.y+n>doc.page.height-65)doc.addPage()};const title=value=>{ensure(70);doc.moveDown(.7).font('AuditSans-Bold').fontSize(14).fillColor('#163047').text(text(value),{width});doc.moveDown(.4)};const p=(value,{small=false,color='#34445a'}={})=>{ensure(30);doc.font('AuditSans').fontSize(small?8.5:9.5).fillColor(color).text(text(value),{width,lineGap:2});doc.moveDown(.45)};const item=(heading,body)=>{ensure(75);doc.font('AuditSans-Bold').fontSize(10).fillColor('#20334a').text(text(heading),{width});doc.moveDown(.2);p(body)};
 const r=audit.result||{};doc.rect(0,0,doc.page.width,116).fill('#142238');doc.font('AuditSans-Bold').fontSize(21).fillColor('#ffffff').text('OMNI DIGITAL',46,35,{width});doc.font('AuditSans').fontSize(11).fillColor('#cae0ea').text(audience==='technical'?'RAPPORT TECHNIQUE INTERNE':'SYNTHESE COMMERCIALE',46,69,{width});doc.y=139;
 if(audience==='commercial'){
  const overview=auditOverview(r);
  doc.font('AuditSans-Bold').fontSize(20).fillColor('#163047').text(text(company.name||'Entreprise'),{width});
  p(r.url||r.requestedUrl||audit.requested_url||'Adresse non disponible',{small:true});
  const stamp=audit.created_at||r.date;
  const day=Number.isFinite(Date.parse(stamp))?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris'}).format(new Date(stamp)):'Date inconnue';
  p(day+' | '+overview.status+' | '+overview.coverage,{small:true});
  title('Priorités à vérifier');
  if(!overview.priorities.length)p('Aucune piste suffisamment documentée dans les contrôles disponibles.');
  for(const [index,x] of overview.priorities.entries()){
   const lines=[['Constat',x.observation],['Action proposée',x.action],['Effet possible',x.impact]].filter(([,value])=>value);
   doc.font('AuditSans').fontSize(9.5);
   const height=lines.reduce((sum,[label,value])=>sum+doc.heightOfString(text(label+' : '+value),{width,lineGap:2})+6,40);
   ensure(height);
   doc.font('AuditSans-Bold').fontSize(11).fillColor('#163047').text(text((index+1)+'. '+x.topic+' | Priorité '+(x.priority||'à confirmer').toLowerCase()),{width});
   doc.moveDown(.3);
   for(const [label,value] of lines)p(label+' : '+value);
  }
  title('Prochaine étape');
  p(overview.next);
  if(overview.positives.length){
   title('Points positifs observés');
   for(const value of overview.positives)p('- '+value);
  }
  title('Périmètre et limites');
  p('Tests automatisés sur un échantillon de pages. Les effets proposés restent à confirmer. Aucun formulaire n’a été soumis.');
  p('Vitesse (Lighthouse) : '+overview.speed.map(({device,score})=>(device==='mobile'?'mobile':'ordinateur')+' '+(score===null?'non mesurée':score+'/100')).join(' | ')+'.',{small:true});
  if(overview.limits.length)p('Contrôles incomplets : '+(r.errors||[]).map(error=>error.scope).join(', ')+'. Voir le rapport technique pour le détail.',{small:true});
 }else{
  p(company.name||'Entreprise');p('Site demandé : '+(r.requestedUrl||audit.requested_url||'—'),{small:true});p('Page finale : '+(r.url||'Non disponible'),{small:true});p('Audit : '+audit.id+' | Exécution : '+(audit.created_at||r.date||'')+' | État : '+(audit.state||r.execution_status||''),{small:true});
  p('Périmètre : '+(r.pages?.length||0)+' page(s) HTML analysée(s), jusqu’à trois pages et seize requêtes HTTP. Aucun JavaScript du site exécuté sur le serveur CRM.');
  title('Mesures Google : laboratoire et utilisateurs réels');
  for(const strategy of ['mobile','desktop']){
   const psi=r.pagespeed?.[strategy];
   item(strategy==='mobile'?'Mobile':'Ordinateur',psi?.state==='available'?'Source : Google PageSpeed Insights / Lighthouse. Les résultats varient selon les conditions.':psi?.message||'Non mesuré.');
   if(psi?.state!=='available')continue;
   p('Scores de laboratoire : '+Object.entries(psi.scores||{}).map(([k,v])=>k+' '+v+'/100').join(' | '));
   for(const metric of Object.values(psi.lab||{}).filter(metric=>metric.value!=null))p(metric.label+' : '+(metric.value===null?'Non disponible':metric.value+' '+metric.unit)+' (laboratoire)',{small:true});
   const field=Object.entries(psi.field||{}).filter(([,metric])=>metric.value!=null);
   if(!field.length)p('Aucune mesure de visiteurs réels disponible.',{small:true});
   for(const [name,metric]of field)p(name+' : '+(metric.value===null?'Non disponible':metric.value+' '+metric.unit)+' | terrain CrUX, portée '+metric.scope+' (75e percentile)',{small:true});
  }
 }
 if(audience==='technical'){
  title('Points à examiner');
  p('Les preuves complètes et les contrôles individuels sont disponibles dans le CRM, sous Détails et mesures.');
  const groups=new Map();
  for(const control of r.controls||[]){
   if(!groups.has(control.category))groups.set(control.category,[]);
   groups.get(control.category).push(control);
  }
  for(const [category,controls] of groups){
   const attention=controls.filter(c=>['Erreur critique','Problème important','Amélioration recommandée'].includes(c.status));
   const satisfied=controls.filter(c=>c.status==='Conforme au contrôle').length;
   const unknown=controls.filter(c=>c.status==='Non vérifié').length;
   title(category);
   p(attention.length+' à examiner | '+satisfied+' satisfaits | '+unknown+' non vérifiés',{small:true});
   for(const c of attention)item(c.label+' ['+c.status+']',c.evidence+'\nPage : '+c.page_url+' | Source : '+c.source+' | Confiance : '+c.confidence+(c.recommendation?'\nAction : '+c.recommendation:''));
  }
  title('Limites et vérifications restantes');
  p(r.summary?.message||'Aucun résultat ne doit être extrapolé au site entier sans vérification complémentaire.');
  for(const error of r.errors||[])p(error.scope+' : '+error.message,{small:true});
  p('Les liens légaux et signatures de consentement sont des indices. Les formulaires ne sont pas soumis.');
 }
 const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);const savedBottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font('AuditSans').fontSize(8).fillColor('#6b7e91').text('Omni Digital - Audit digital | '+(i+1)+' / '+range.count,46,doc.page.height-29,{width,lineBreak:false,align:'center'});doc.page.margins.bottom=savedBottom;}doc.end();
 });
}
