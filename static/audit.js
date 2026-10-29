let auditContactId=null,auditHistory=[],auditSelectedId=null,auditTab='audit',auditLoading=false,auditBusyId=null,auditLoadVersion=0;
function auditDate(value){return value?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(value)):'Date inconnue'}
async function openAudit(id){
 const p=state.prospects.find(p=>p.id===id)||state.prospects[0];
 auditContactId=p?.id||null;auditHistory=[];auditSelectedId=null;auditTab='audit';view='audits';auditLoading=!!p;render();
 const version=++auditLoadVersion;if(!p)return;
 try{const data=await api(`/api/prospects/${p.id}/audits`);if(version!==auditLoadVersion)return;auditHistory=data.audits;auditSelectedId=auditHistory[0]?.id||null}
 catch(e){if(version===auditLoadVersion)notice(e.message)}
 finally{if(version===auditLoadVersion){auditLoading=false;if(view==='audits')render()}}
}
function auditWorkspace(){
 const p=state.prospects.find(p=>p.id===auditContactId);
 if(!p)return `<div class="panel audit-empty"><span class="module-symbol">⌕</span><h2>Votre espace d’audit de site</h2><p>Associez chaque analyse à un contact pour conserver ses résultats et préparer une approche personnalisée.</p><button data-go="prospects" class="primary">Choisir ou créer un contact</button></div>`;
 const current=auditHistory.find(a=>a.id===auditSelectedId)||auditHistory[0];
 const busy=auditBusyId===p.id;
 const issues=current?.arguments?.length||0,unknown=current?.checks?.filter(c=>c.state==='unknown').length||0;
 const head=`<div class="audit-contact-bar"><div><span class="eyebrow">DOSSIER DE PROSPECTION</span><h2>${esc(p.company)}</h2><span class="muted">${esc(p.contact_name||p.email||'Contact à compléter')}</span></div><label>Contact<select id="audit-contact-select" ${busy?'disabled':''}>${state.prospects.map(p=>`<option value="${p.id}" ${p.id===auditContactId?'selected':''}>${esc(p.company)}</option>`).join('')}</select></label></div>`;
 const tabs=`<div class="audit-tabs" role="tablist" aria-label="Vues de l’audit"><button role="tab" aria-selected="${auditTab==='audit'}" data-audit-tab="audit" class="${auditTab==='audit'?'active':''}">Audit du site <span>${current?.checks?.length||0}</span></button><button role="tab" aria-selected="${auditTab==='history'}" data-audit-tab="history" class="${auditTab==='history'?'active':''}">Historique des audits <span>${auditHistory.length}</span></button></div>`;
 const form=`<form id="audit-form" class="audit-url-form"><label class="sr-only" for="audit-url">URL du site à auditer</label><input id="audit-url" type="url" required placeholder="https://example.fr" value="${esc(current?.requestedUrl||p.website||'')}" ${busy?'disabled':''}><button class="primary" ${auditBusyId||auditLoading?'disabled':''}>${busy?'Analyse en cours…':current?'⌕ Auditer à nouveau':'⌕ Lancer l’audit'}</button></form><p class="audit-disclosure">Analyse de la page d’accueil · lecture HTML et HTTPS · PageSpeed mobile ${state.integrations.pagespeed?'connecté':'facultatif, clé à configurer'}. Aucun email envoyé.</p>`;
 let body='';
 if(auditLoading)body='<div class="empty" role="status">Chargement des audits enregistrés…</div>';
 else if(auditTab==='history')body=auditHistory.length?`<div class="audit-history">${auditHistory.map(a=>`<button data-audit-history="${a.id}" class="audit-history-row"><span><b>${esc(auditDate(a.date))}</b><span class="muted">${esc(a.url)}</span></span><span class="badge">${a.arguments?.length||0} piste(s)</span><span>Consulter →</span></button>`).join('')}</div>`:'<div class="empty">Aucun audit enregistré pour ce contact.</div>';
 else if(!current)body=`<div class="audit-empty"><span class="module-symbol">⌕</span><h2>Identifiez les pistes d’amélioration</h2><p>Indiquez l’URL du site pour vérifier sa présence en ligne et conserver un premier diagnostic dans ce dossier.</p><div class="audit-empty-tags"><span>HTTPS</span><span>SEO</span><span>Conversion</span><span>PageSpeed</span></div></div>`;
 else{
  const cards=(current.checks||[]).map(c=>`<article class="audit-check"><span class="audit-check-icon ${esc(c.state)}" aria-label="${({pass:'Détecté',warning:'À vérifier',fail:'Problème',unknown:'Non vérifié'})[c.state]||'Information'}">${({pass:'✓',warning:'!',fail:'×',unknown:'i'})[c.state]||'i'}</span><div><span class="audit-check-label">${esc(c.label)}</span><strong>${esc(c.value)}</strong><p>${esc(c.detail)}</p><small>${esc(c.source)}</small></div></article>`).join('');
  const scores=Object.entries(current.scores||{}).map(([k,v])=>`<div class="audit-score"><span>${esc(({performance:'Performance',seo:'SEO',accessibility:'Accessibilité','best-practices':'Bonnes pratiques'})[k]||k)}</span><strong class="${v>=90?'score-good':v>=50?'score-medium':'score-poor'}">${v}<small>/100</small></strong></div>`).join('');
  body=`<div class="audit-summary"><div class="audit-ring"><strong>${issues}</strong><small>PISTES</small></div><div><h3>${issues?'Des pistes à explorer':'Aucun point prioritaire identifié'}</h3><p>${issues} piste(s) · ${unknown} contrôle(s) non vérifié(s) · ${esc(auditDate(current.date))}</p><p class="muted">${esc(current.url)}</p><span class="muted">Les nouveaux brouillons utilisent les trois premières conclusions du dernier audit enregistré. Vérifiez-les avant toute proposition.</span></div></div>${scores?`<div class="audit-scores">${scores}</div>`:''}<div class="audit-checks">${cards}</div><div class="audit-arguments-heading"><h3>Arguments pour la prospection</h3><button data-action="draft" data-id="${p.id}" ${contactBlocked(p)||p.do_not_email==='Oui'?'disabled title="Prospection bloquée"':''}>Préparer un email</button></div><div class="audit-arguments">${(current.arguments||[]).map(a=>`<article class="audit-argument"><span class="audit-severity">${esc(a.severity)}</span><div><strong>${esc(a.title)}</strong><span class="muted"> · ${esc(a.service)}</span><p>« ${esc(a.argument)} »</p><small>${esc(a.evidence)}</small></div></article>`).join('')||'<p class="muted">Aucune piste automatique. Ce résultat ne remplace pas une analyse humaine.</p>'}</div><div class="audit-method"><strong>Périmètre de l’analyse</strong><p>Lecture de la page d’accueil uniquement. Les fonctionnalités, le rendu mobile, les pages internes, le consentement et les avis clients ne sont pas validés. Un élément « non détecté » peut être chargé par JavaScript ou après consentement. Les résultats techniques restent des observations à confirmer.</p></div>`;
 }
 return `${head}<section class="panel audit-panel">${tabs}${form}${busy?'<div class="audit-progress" role="status">Vérification du site en cours. Google PageSpeed peut prendre environ une minute…</div>':''}${body}</section>`;
}
document.addEventListener('change',e=>{if(e.target.id==='audit-contact-select')openAudit(e.target.value)});
document.addEventListener('click',e=>{
 const tab=e.target.closest('[data-audit-tab]');if(tab){auditTab=tab.dataset.auditTab;render()}
 const item=e.target.closest('[data-audit-history]');if(item){auditSelectedId=item.dataset.auditHistory;auditTab='audit';render()}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='audit-form')return;e.preventDefault();
 const id=auditContactId,url=$('#audit-url').value;
 if(auditBusyId)return;
 auditBusyId=id;render();notice('');
 try{
  const result=await api(`/api/prospects/${id}/audit`,{website:url});
  state=await api('/api/state');
  if(auditContactId===id){auditHistory=[result.audit,...auditHistory];auditSelectedId=result.audit.id;auditTab='audit'}
  notice('Audit enregistré dans le dossier du contact. Aucun email envoyé.');
 }catch(e){notice(e.message)}
 finally{auditBusyId=null;render()}
});
