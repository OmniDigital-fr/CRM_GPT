let digitalCompanyId=null,digitalAuditList=[],digitalJobs=[],digitalCurrent=null,digitalTab='summary',digitalCompare=null,digitalCompareLeft='',digitalCompareRight='',digitalLoadVersion=0,digitalPolling=null;
const DIGITAL_STATE_LABELS={queued:'En attente',running:'En cours',completed:'Terminé',partial:'Terminé - contrôles partiels',failed:'Échec',interrupted:'Interrompu',historical:'Audit historique'};
async function openDigitalAudit(companyId){digitalCompanyId=companyId||state.companies?.[0]?.id||null;digitalCurrent=null;digitalAuditList=[];digitalJobs=[];digitalCompare=null;digitalCompareLeft='';digitalCompareRight='';digitalTab='summary';view='digitalAudits';render();if(digitalCompanyId)await loadDigitalAudits();}
async function loadDigitalAudits(preferred){const companyId=digitalCompanyId,version=++digitalLoadVersion;const data=await api('/api/digital-audits?company_id='+encodeURIComponent(companyId));if(version!==digitalLoadVersion||companyId!==digitalCompanyId)return;digitalAuditList=data.audits;digitalJobs=data.jobs;const selected=preferred||digitalCurrent?.id||digitalAuditList[0]?.id;if(selected){const result=await api('/api/digital-audits/'+selected);if(version!==digitalLoadVersion||companyId!==digitalCompanyId)return;digitalCurrent=result;}if(view==='digitalAudits')render();scheduleDigitalPoll();}
function scheduleDigitalPoll(){clearTimeout(digitalPolling);if(view!=='digitalAudits'||!digitalJobs.some(j=>['queued','running'].includes(j.state)))return;const companyId=digitalCompanyId;digitalPolling=setTimeout(async()=>{if(view!=='digitalAudits'||companyId!==digitalCompanyId)return;try{const previous=new Set(digitalAuditList.map(a=>a.id));await loadDigitalAudits();const newest=digitalAuditList.find(a=>!previous.has(a.id));if(newest)await loadDigitalAudits(newest.id)}catch(error){notice(error.message)}},2000);}
const digitalAttention=new Set(['Erreur critique','Problème important','Amélioration recommandée']);
function digitalControls(items){
 return items.map(c=>`<details class="digital-check"><summary><b>${esc(c.label)}</b> · ${esc(c.status)}</summary>
  <p>${esc(c.evidence)}</p>${c.recommendation?`<p><b>Action proposée</b> · ${esc(c.recommendation)}</p>`:''}
  <small>${esc(c.page_url)} · ${esc(c.source)} · Confiance ${esc(c.confidence)} · ${esc(auditDate(c.observed_at))}</small></details>`).join('');
}
function digitalTechnical(result){
 const groups=new Map();
 for(const control of result.controls||[]){
  if(!groups.has(control.category))groups.set(control.category,[]);
  groups.get(control.category).push(control);
 }
 return `<section class="panel"><h3>Contrôles par thème</h3><p>Ouvrez un thème, puis un contrôle pour voir sa preuve et l’action proposée.</p>
  ${[...groups].map(([category,items])=>{
   const attention=items.filter(c=>digitalAttention.has(c.status));
   const other=items.filter(c=>!digitalAttention.has(c.status));
   const unknown=other.filter(c=>c.status==='Non vérifié').length;
   return `<details class="digital-check-group"><summary><b>${esc(category)}</b> · ${attention.length} à examiner · ${unknown} non vérifié(s)</summary>
    ${digitalControls(attention)||'<p>Aucun point à examiner dans les contrôles disponibles.</p>'}
    ${other.length?`<details><summary>Contrôles satisfaits et non vérifiés (${other.length})</summary>${digitalControls(other)}</details>`:''}</details>`;
  }).join('')}
 </section>`;
}
const digitalScoreLabels={performance:'Vitesse',accessibility:'Accessibilité',seo:'Référencement',best_practices:'Bonnes pratiques','best-practices':'Bonnes pratiques'};
function digitalSimpleSummary(a){
 const o=a.overview;
 if(!Array.isArray(o?.google))return '<section class="panel"><p>Résumé indisponible pour cet ancien format. Les détails restent accessibles.</p></section>';
 const score=(value,label)=>`<span class="digital-google-value ${value===null?'unmeasured':value>=90?'good':value>=50?'average':'poor'}"><strong>${value===null?'—':esc(value)+'/100'}</strong><span>${esc(label)}</span></span>`;
 return `<section class="panel digital-simple"><span class="eyebrow">L’ESSENTIEL EN UNE MINUTE</span><h3>Que retenir de ce site ?</h3><p class="digital-verdict">${esc(o.verdict)}</p>
 <h4>Les notes Google PageSpeed</h4><div class="table-wrap"><table class="digital-google-table"><thead><tr><th>Critère</th><th>Téléphone</th><th>Ordinateur</th></tr></thead><tbody>${o.google.map(row=>`<tr><th scope="row">${esc(row.label)}</th><td>${score(row.mobile,row.mobile_label)}</td><td>${score(row.desktop,row.desktop_label)}</td></tr>`).join('')}</tbody></table></div>
 <p class="muted">90–100 : bon · 50–89 : à améliorer · 0–49 : faible. Tests Google en laboratoire ; les notes peuvent varier. Elles ne certifient ni le site ni ses résultats commerciaux.</p>
 ${o.timings.length?`<details><summary>Deux repères de chargement sur téléphone</summary>${o.timings.map(metric=>`<p>${esc(metric.label)} : <b>${esc(metric.value)} ${esc(metric.unit)}</b></p>`).join('')}<p>Mesures de laboratoire, distinctes des données de visiteurs réels consultables dans Détails et mesures.</p></details>`:''}
 <div class="digital-simple-columns"><section><h4>Ce qui fonctionne dans les contrôles</h4>${o.positives.length?`<ul>${o.positives.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'<p>Aucun point positif synthétique établi dans les contrôles disponibles.</p>'}</section>
 <section><h4>Les priorités à vérifier</h4>${o.priorities.length?`<ol>${o.priorities.map(item=>`<li><strong>${esc(item.topic)}</strong><p>${esc(item.observation)}</p><p><b>Action</b> · ${esc(item.plain_action)}</p></li>`).join('')}</ol>`:'<p>Aucun problème prioritaire établi dans les contrôles disponibles. Cela ne garantit pas l’absence de problème.</p>'}</section></div>
 <section class="digital-next"><h4>Prochaine action</h4><p>${esc(a.diagnostic?.restricted?'Vérifier les restrictions de contact en interne avant toute action commerciale.':o.next)}</p></section>
 <p class="muted">${esc(o.coverage)} Observation du ${esc(auditDate(a.created_at))}. Les besoins internes et les opportunités commerciales restent à confirmer.</p>
 ${o.limits.length?`<details><summary>Ce qui n’a pas pu être vérifié</summary><ul>${o.limits.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}</section>
 <section class="panel digital-simple"><h3>Analyse IA du site</h3><p>La synthèse ci-dessus est calculée par le CRM, sans IA générative. Cette vue n’effectue aucun appel à Gemini.</p>
 <p>Vous pouvez copier les mesures et observations dans l’outil IA de votre choix. Aucun appel ni envoi à une IA n’est effectué par ce bouton.</p><button data-digital-copy-ai>Copier le résumé pour une analyse IA</button>
 <details><summary>Voir exactement le texte à copier</summary><pre>${esc(o.ai_prompt)}</pre></details></section>
 <details class="panel digital-transformation-details"><summary>Approfondir le diagnostic de transformation numérique</summary>${transformationDiagnosticHtml(a.diagnostic)}</details>`;
}
function digitalMetrics(psi){
 return ['mobile','desktop'].map(device=>{
  const measure=psi?.[device];
  const label=device==='mobile'?'Téléphone':'Ordinateur';
  if(measure?.state!=='available')return `<p><b>${label}</b> · Non mesuré. ${esc(measure?.message||'')}</p>`;
  const field=Object.entries(measure.field||{}).filter(([,metric])=>metric.value!=null);
  const metrics=Object.values(measure.lab||{}).filter(metric=>metric.value!=null);
  const scores=Object.entries(measure.scores||{}).filter(([key])=>key!=='performance');
  return `<details class="digital-check-group"><summary><b>${label}</b> · Vitesse (test Google) ${measure.scores?.performance==null?'non mesurée':esc(measure.scores.performance)+'/100'}</summary>
   <p>${scores.map(([key,value])=>esc(digitalScoreLabels[key]||key)+' '+esc(value)+'/100').join(' · ')}</p>
   ${metrics.length?`<h4>Test simulé</h4><ul>${metrics.map(m=>`<li>${esc(m.label)} · ${esc(m.value)} ${esc(m.unit)}</li>`).join('')}</ul>`:''}
   <h4>Données des visiteurs réels</h4>${field.length?`<ul>${field.map(([name,m])=>`<li>${esc(name)} · ${esc(m.value)} ${esc(m.unit)} · ${esc(m.scope)}</li>`).join('')}</ul>`:'<p>Aucune mesure disponible pour cet appareil.</p>'}
   <details><summary>Diagnostics Google</summary>${[...(measure.opportunities||[]),...(measure.failedAudits||[])].map(item=>`<p><b>${esc(item.title)}</b><br>${esc(item.description)}</p>`).join('')||'<p>Aucun diagnostic fourni.</p>'}</details></details>`;
 }).join('');
}
function digitalOtherPistes(items){
 return items.map(item=>`<details class="digital-check"><summary>${esc(item.plain_problem||item.problem)} · ${esc(item.problem)}</summary>
  <p>${esc(item.plain_observation||item.problem)}</p><p><b>Action à envisager</b> · ${esc(item.recommended_service)}</p>
  <p>${esc(item.probable_impact)}</p><small>${esc(item.page_url)} · ${esc(item.evidence)}</small></details>`).join('');
}
function transformationDiagnosticHtml(d){
 const opportunities=items=>items.map(item=>`<article class="digital-control"><h4>${esc(item.domain)}</h4>
  <span class="badge">${esc(item.classification)}</span><p>${esc(item.justification)}</p>
  <p><b>Solution envisageable</b> · ${esc(item.solution)}</p>
  <p><b>Question à poser</b> · ${esc(item.questions.join(' '))}</p>
  <small>${esc(item.source)} · ${esc(item.date||'Date à confirmer')} · Confiance ${esc(item.confidence)}</small></article>`).join('');
 return `<section class="panel"><h3>${esc(d.title)}</h3>
  <h4>1. Présentation de l’entreprise</h4><p>${esc(d.company.name)} · ${esc(d.company.activity)} · ${esc(d.company.size)} · ${esc(d.company.location)}</p>
  <small>${esc(d.company.source)} · ${esc(d.company.status)} · ${esc(d.company.date||'Date à confirmer')}</small>
  <h4>2. Présence et outils numériques</h4><p>${esc(d.presence.status)}</p><p>${esc(d.presence.tools)}</p>
  <details><summary>Constats vérifiés dans le périmètre web (${d.presence.observations.length})</summary>
  ${d.presence.observations.map(item=>`<p><b>${esc(item.text)}</b> · ${esc(item.evidence)}<br><small>${esc(item.source)} · ${esc(item.url)} · ${esc(item.date)} · Confiance ${esc(item.confidence)}</small></p>`).join('')||'<p>Aucun constat web récent attribuable au site enregistré.</p>'}</details>
  <h4>3. Opportunités de digitalisation</h4><p>Ces pistes demandent un échange avec l’entreprise.</p>${opportunities(d.opportunities.filter(item=>item.code!=='ia'))}
  <h4>4. Intelligence artificielle</h4><p>${esc(d.ai.message)}</p>${opportunities(d.ai.opportunities)}
  <details><summary>Questions sur un éventuel usage IA</summary><ul>${d.ai.questions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>
  <h4>5. Recommandations et prochaines étapes</h4><p>${esc(d.next)}</p>
  <p><b>Services recommandés sur besoin documenté</b> · ${esc(d.recommendations.map(item=>item.domain).join(', ')||'Aucun service confirmé à ce stade.')}</p>
  <p>${esc(d.project)}. ${esc(d.recurring)}</p>
  <h4>Questions pour le rendez-vous</h4><ul>${d.questions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>
  <details><summary>Points à confirmer</summary><ul>${d.missing.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>
  ${d.proposed_email?`<details><summary>Email commercial proposé · à personnaliser et valider</summary><p><b>${esc(d.proposed_email.subject)}</b></p><pre>${esc(d.proposed_email.body)}</pre><p>Ouvrez le contact pour préparer et approuver son email.</p></details>`:''}
 </section>`;
}
function digitalAuditWorkspace(){const c=state.companies.find(c=>c.id===digitalCompanyId),live=digitalJobs.find(j=>['queued','running'].includes(j.state)),a=digitalCurrent,r=a?.result;const head=`<div class="panel"><div class="panel-heading"><div><span class="eyebrow">DIAGNOSTIC DOCUMENTÉ</span><h2>Diagnostic de transformation numérique</h2></div><label>Entreprise<select id="digital-company"><option value="">Choisir une entreprise</option>${state.companies.map(x=>`<option value="${x.id}" ${x.id===digitalCompanyId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div>${c?`<form id="digital-audit-form" class="digital-url-form"><label>URL à analyser<input type="url" name="url" required value="${esc(live?.requested_url||r?.requestedUrl||c.website||'')}" placeholder="https://exemple.fr" ${live?'disabled':''}></label><button class="primary" ${live?'disabled':''}>${live?'Analyse en cours…':'Lancer un audit'}</button></form><p>Google PageSpeed ${state.integrations.pagespeed?'configuré pour téléphone et ordinateur':'non configuré : les notes Google ne pourront pas être mesurées'}. Le rapport commence par une synthèse courte ; les détails restent disponibles.</p>${live?`<p class="digital-progress" role="status">${esc(DIGITAL_STATE_LABELS[live.state])} : ${esc(live.progress)} <button data-digital-refresh>Actualiser l’état</button></p>`:''}${digitalJobs[0]?.error?`<p role="status">${esc(digitalJobs[0].error)}</p>`:''}`:'<p>Créez ou sélectionnez une entreprise avant de lancer une analyse. Aucun contact obligatoire.</p>'}</div>`;
 if(!c)return head;if(!a&&!digitalAuditList.length)return head+'<div class="panel empty">Aucun audit enregistré pour cette entreprise.</div>';
 const tabs=[['summary','Diagnostic'],['technical','Détails et mesures'],['history','Historique']];let body='';
 if(a&&a.engine_version!==3&&digitalTab!=='history')body='<div class="panel"><h3>Audit historique conservé</h3><p>Ce résultat utilise l’ancien format. Lancez un nouvel audit pour obtenir les catégories détaillées, la comparaison et les exports PDF.</p><details><summary>Données de l’ancien audit</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details></div>';
 else if(digitalTab==='history')body=`<div class="panel"><h3>Historique de l’entreprise</h3>${digitalAuditList.map(item=>`<button class="digital-history-row" data-digital-select="${item.id}"><span>${esc(auditDate(item.created_at))} · ${esc(DIGITAL_STATE_LABELS[item.state]||item.state)}<br><small>${esc(item.requested_url||item.source)}</small></span><span>Consulter →</span></button>`).join('')}<h3>Comparer deux audits du nouveau moteur</h3><div class="digital-compare-form"><label>Avant<select id="digital-left">${digitalAuditOptions(digitalCompareLeft)}</select></label><label>Après<select id="digital-right">${digitalAuditOptions(digitalCompareRight)}</select></label><button data-digital-compare>Comparer</button></div>${digitalCompare?`<p>${esc(digitalCompare.warning)}${digitalCompare.same_url?'':' Les URL demandées diffèrent : comparaison à interpréter avec prudence.'}</p><div class="table-wrap"><table><thead><tr><th>Mesure</th><th>Avant</th><th>Après</th><th>Écart</th></tr></thead><tbody>${digitalCompare.metrics.map(m=>`<tr><td>${esc(m.strategy)} · ${esc(digitalScoreLabels[m.metric]||m.metric)}</td><td>${m.before??'—'}</td><td>${m.after??'—'}</td><td>${m.delta===null?'Non comparable':(m.delta>0?'+':'')+m.delta}</td></tr>`).join('')}</tbody></table></div><details><summary>Évolutions des constats (${digitalCompare.changes.length})</summary>${digitalCompare.changes.map(ch=>`<details><summary>${esc(ch.label)} : ${esc(ch.before)} → ${esc(ch.after)}</summary><p>${esc(ch.page_url)}<br>Avant : ${esc(ch.evidence_before)}<br>Après : ${esc(ch.evidence_after)}</p></details>`).join('')||'<p>Aucune évolution détectée dans les contrôles comparables.</p>'}</details>`:''}</div>`;
 else if(r&&digitalTab==='summary')body=digitalSimpleSummary(a);
 else if(r&&digitalTab==='technical')body=digitalTechnical(r)+
  `<section class="panel"><h3>Mesures Google</h3><p>Les tests simulés et les données des visiteurs réels sont séparés.</p>${digitalMetrics(r.pagespeed)}</section>`+
  `<section class="panel"><details><summary>Toutes les pistes à examiner (${r.commercial_opportunities?.length||0})</summary>
   ${digitalOtherPistes(r.commercial_opportunities||[])||'<p>Aucune piste documentée.</p>'}</details></section>`;
 return head+(a?`<div class="panel"><p><b>${esc(DIGITAL_STATE_LABELS[a.state]||a.state)}</b> · ${esc(auditDate(a.created_at))} · ${esc(r.url||a.requested_url)}</p>${a.engine_version===3?`<div class="commercial-toolbar"><a class="digital-pdf-link" href="/api/digital-audits/${a.id}/report.pdf?audience=commercial" download>Télécharger le diagnostic PDF</a><a class="digital-pdf-link" href="/api/digital-audits/${a.id}/report.pdf?audience=technical" download>Télécharger le rapport technique PDF</a></div>`:''}</div>`:'')+`<div class="digital-tabs" role="group" aria-label="Contenu de l’audit">${tabs.map(([key,label])=>`<button data-digital-tab="${key}" aria-pressed="${digitalTab===key}">${label}</button>`).join('')}</div>`+body;
}
function digitalAuditOptions(value){return '<option value="">Choisir un audit</option>'+digitalAuditList.filter(a=>a.source==='Moteur digital v3').map(a=>`<option value="${a.id}" ${a.id===value?'selected':''}>${esc(auditDate(a.created_at))} · ${esc(a.requested_url)}</option>`).join('')}
document.addEventListener('change',async e=>{try{if(e.target.id==='digital-company')await openDigitalAudit(e.target.value);if(e.target.id==='digital-left')digitalCompareLeft=e.target.value;if(e.target.id==='digital-right')digitalCompareRight=e.target.value}catch(error){notice(error.message)}});
document.addEventListener('submit',async e=>{if(e.target.id!=='digital-audit-form')return;e.preventDefault();const button=e.submitter;button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));const started=await api('/api/digital-audits',{company_id:digitalCompanyId,url:data.url});const job=await api('/api/digital-audits/jobs/'+started.id);await loadDigitalAudits(job.audit_id||undefined);notice('Audit demandé. Les résultats seront conservés dans l’historique.')}catch(error){notice(error.message)}finally{button.disabled=false}});
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.hasAttribute('data-digital-copy-ai')){const prompt=digitalCurrent?.overview?.ai_prompt;if(!prompt)throw Error('Aucun résumé disponible.');await navigator.clipboard.writeText(prompt);notice('Résumé copié. Collez-le dans votre outil IA. Aucune donnée envoyée par le CRM.');}if(b.dataset.digitalCompany){if(entityDialog.open)entityDialog.close();await openDigitalAudit(b.dataset.digitalCompany)}if(b.hasAttribute('data-digital-refresh'))await loadDigitalAudits();if(b.dataset.digitalSelect){digitalCurrent=await api('/api/digital-audits/'+b.dataset.digitalSelect);digitalTab='summary';render()}if(b.dataset.digitalTab){digitalTab=b.dataset.digitalTab;render()}if(b.hasAttribute('data-digital-compare')){if(!digitalCompareLeft||!digitalCompareRight||digitalCompareLeft===digitalCompareRight)throw Error('Choisissez deux audits différents.');digitalCompare=await api('/api/digital-audits/compare?left='+encodeURIComponent(digitalCompareLeft)+'&right='+encodeURIComponent(digitalCompareRight));render()}}catch(error){notice(error.message)}});
