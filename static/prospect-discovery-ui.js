let discoveryMeta=null;
let discoveryRun=null;
let discoveryPoll;
let discoveryDetail='';
let discoveryShowAll=false;
let discoveryBusy=false;
const discoveryLabels={pending:'À examiner',approved:'Approuvé',rejected:'Rejeté',deferred:'Reporté',imported:'Importé',
  running:'En cours',completed:'Terminée',failed:'Échec',cancelled:'Interrompue',interrupted:'Interrompue'};
const discoveryBase='/api/discovery';
const discoveryDate=value=>value?new Date(value).toLocaleString('fr-FR'):'—';
const discoveryLocations={all:'Toute la France',region:'Région (code INSEE)',department:'Département (code)',city:'Ville (nom)',postal:'Code postal'};
const discoveryChoices=(name,values,selected=[])=>values.map(value=>
  `<label class="discovery-check"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value)?'checked':''}> ${esc(value)}</label>`).join('');

async function openProspectDiscovery(){
  view='discovery';
  clearTimeout(discoveryPoll);
  discoveryMeta=await api(discoveryBase+'/runs');
  if(discoveryRun&&!discoveryMeta.runs.some(run=>run.id===discoveryRun.id))discoveryRun=null;
  render();
}
async function loadDiscoveryRun(id,{history=false}={}){
  const run=await api(discoveryBase+'/runs/'+id);
  if(view!=='discovery')return;
  if(history)discoveryMeta=await api(discoveryBase+'/runs');
  if(view!=='discovery')return;
  discoveryRun=run;
  render();
  clearTimeout(discoveryPoll);
  if(run.state==='running')discoveryPoll=setTimeout(()=>{
    if(view==='discovery')loadDiscoveryRun(id).catch(error=>notice(error.message));
  },1300);
  else if(!history){
    discoveryMeta=await api(discoveryBase+'/runs');
    if(view==='discovery'&&discoveryRun?.id===id)render();
  }
}
function discoveryFilters(criteria){
  return `<div class="form-grid">
    <label>Zone<select name="location">${Object.entries(discoveryLocations).map(([value,label])=>
      `<option value="${value}" ${criteria.location===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label>Code ou nom de la zone<input name="area" maxlength="100" value="${esc(criteria.area)}" placeholder="Ex. 11, 75, Paris ou 75001"></label>
    <label>Mot-clé facultatif<input name="query" maxlength="100" value="${esc(criteria.query)}" placeholder="Nom ou terme recherché"></label>
    <label>Nombre de prospects<input name="limit" type="number" min="1" max="25" required value="${criteria.limit??10}"></label>
  </div>
  <details><summary>Secteurs et effectifs</summary><p>Secteurs</p><div class="discovery-options">${discoveryChoices('sectors',discoveryMeta.sectors,criteria.sectors)}</div>
  <p>Effectifs indicatifs</p><div class="discovery-options">${discoveryChoices('sizes',discoveryMeta.sizes,criteria.sizes)}</div></details>
  <details><summary>Présence digitale et critères commerciaux</summary>
  <p>Filtres de résultats, disponibles après vérification du site</p><div class="discovery-options">${discoveryChoices('digital',discoveryMeta.digital,criteria.digital)}</div>
  <p>Indices à prioriser</p><div class="discovery-options">${discoveryChoices('priorities',discoveryMeta.priorities,criteria.priorities)}</div></details>`;
}
function discoveryCandidate(row){
  const c=row.company,v=row.verification,s=row.scores;
  const match=row.duplicates.map(item=>`<li>${esc(item.name)} · ${item.strong?'Correspondance forte':'Nom similaire'} · <button type="button" data-discovery-company="${esc(item.id)}">Voir la fiche CRM</button></li>`).join('');
  const controls=row.audit?.controls?.slice(0,12).map(control=>
    `<li><strong>${esc(control.label)}</strong> · ${esc(control.status)}<br>${esc(control.evidence)}</li>`).join('');
  const signals=row.signals.map(signal=>`<li><strong>${esc(signal.label)}</strong> · ${esc(signal.reason)} ${signal.url?`<a href="${esc(signal.url)}" target="_blank" rel="noopener noreferrer">Source déclarée</a> · ${esc(discoveryDate(signal.observed_at))}`:''}</li>`).join('');
  const canApprove=!row.restricted&&!row.duplicates.some(item=>item.strong);
  const actions=row.imported_id?`<button data-discovery-company="${esc(row.imported_id)}">Ouvrir la fiche et la qualification</button>`:
    `<div class="discovery-actions">
    ${canApprove?`<button data-discovery-action="approved" data-candidate="${esc(row.id)}">${match?'Confirmer la revue et approuver':'Approuver'}</button>`:''}
    <button data-discovery-action="rejected" data-candidate="${esc(row.id)}">Rejeter</button>
    <button data-discovery-action="deferred" data-candidate="${esc(row.id)}">Reporter</button>
    ${row.decision==='approved'?'<button class="primary" data-discovery-action="import" data-candidate="'+esc(row.id)+'">Importer cette entreprise</button>':''}
  </div>`;
  const verification=row.imported_id?'':`<form data-discovery-verify="${esc(row.id)}">
    <label>Adresse du site à vérifier<input type="url" name="url" maxlength="2048" value="${esc(v.requested||'')}" placeholder="https://…"></label>
    <div class="discovery-actions"><button>Vérifier le site public</button>
    <button type="button" data-discovery-action="unidentified" data-candidate="${esc(row.id)}">Indiquer qu’aucun site n’a été identifié</button>
    ${v.confirmed?'<button type="button" data-discovery-action="audit" data-candidate="'+esc(row.id)+'">Lancer l’audit digital</button>':''}</div>
  </form>
  <form data-discovery-signal="${esc(row.id)}">
    <div class="form-grid"><label>Indice commercial<select name="label">${discoveryMeta.priorities.map(label=>`<option>${esc(label)}</option>`).join('')}</select></label>
    <label>Source publique<input type="url" name="url" required maxlength="2048" placeholder="https://…"></label></div>
    <label>Observation à vérifier, sans coordonnées personnelles<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>
    <button>Documenter un indice</button>
  </form>`;
  return `<div class="panel discovery-record">
    <h3>${esc(c.name)}</h3>
    <p>${esc(c.legal_name)} · SIREN ${esc(c.siren)} · SIRET ${esc(c.siret||'—')} · NAF ${esc(c.naf_code||'—')} · Effectif ${esc(c.company_size||'inconnu')}</p>
    <p>${esc(c.address)} · ${esc(c.postal_code)} ${esc(c.city)} · Région ${esc(c.region||'—')} · Activité déclarée ${esc(c.company_status)}</p>
    <p>Identité et établissement collectés le ${esc(discoveryDate(c.collected_at))}. <a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">${esc(c.source)}</a></p>
    <p>Site : ${esc(row.digital)} ${v.url?`· <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${esc(v.url)}</a>`:''}
    ${v.checked_at?'· '+esc(discoveryDate(v.checked_at)):''} ${esc(v.evidence||'')}
    ${v.proof_url?`<a href="${esc(v.proof_url)}" target="_blank" rel="noopener noreferrer">Page de preuve</a>`:''}</p>
    ${v.channels?.email||v.channels?.phone?`<p>Coordonnées générales publiées sur le site vérifié · ${esc([v.channels.email,v.channels.phone].filter(Boolean).join(' · '))}</p>`:''}
    ${row.restricted?'<p class="duplicate-warning">Opposition détectée. L’import est bloqué.</p>':''}
    ${match?`<h4>Correspondances à vérifier</h4><ul>${match}</ul>`:''}
    <h4>Qualification locale</h4>
    <p>Fit ${s.fit.score??'—'} · Need ${s.need.score??'—'} · Intent ${esc(s.intent.label)} · ${esc(s.priority)}</p>
    <p>${esc(s.priority_reason)}</p>
    <p>Services issus des preuves : ${esc(s.services.map(service=>service.name).join(', ')||'À préciser')}</p>
    <p>Données manquantes : ${esc(s.missing.join(', ')||'—')}</p>
    ${signals?`<h4>Hypothèses et signaux</h4><ul>${signals}</ul>`:''}
    ${row.audit?`<details><summary>Audit digital · ${esc(row.audit.state)} · ${esc(discoveryDate(row.audit_at))}</summary>
      <p>${esc(row.audit.conclusions.join(' · '))}</p><ul>${controls}</ul></details>`:''}
    <p>${discoveryMeta.gemini?'Après import, ouvrez Qualification IA sur la fiche entreprise pour une analyse Gemini individuelle.':'Gemini indisponible pour les données CRM. Les scores locaux restent accessibles.'}</p>
    ${verification}
    <h4>Validation</h4>${actions}
  </div>`;
}
function discoveryResults(run){
  const filters=run.criteria.digital;
  const visible=discoveryShowAll||!filters.length?run.results:run.results.filter(row=>
    filters.includes(row.digital)||(filters.includes('Site web existant')&&row.verification.confirmed));
  const stats=run.stats;
  return `<section class="panel"><div class="panel-heading"><h2>Résultats</h2><span class="badge">${esc(discoveryLabels[run.state]||run.state)}</span></div>
    <p>${stats.found} trouvés · ${stats.verified} sites vérifiés · ${stats.duplicates} doublons possibles · ${stats.approved} approuvés · ${stats.rejected} rejetés · ${stats.imported} importés · ${run.requests} appels source</p>
    ${run.error?`<p role="alert">${esc(run.error)}</p>`:''}
    ${run.state==='running'?'<button data-discovery-action="cancel">Arrêter la recherche</button>':''}
    ${filters.length?`<button data-discovery-action="toggle">${discoveryShowAll?'Appliquer le filtre digital':'Afficher tous les résultats pour vérification'}</button>`:''}
    <form id="discovery-import">
    <div class="table-wrap"><table><thead><tr><th>Import</th><th>Entreprise</th><th>Secteur</th><th>Site / vérification</th><th>Fit</th><th>Need</th><th>Priorité / services</th><th>Décision</th></tr></thead><tbody>
    ${visible.map(row=>`<tr>
      <td>${row.decision==='approved'?`<input type="checkbox" name="ids" value="${esc(row.id)}" aria-label="Sélectionner ${esc(row.company.name)}">`:'—'}</td>
      <td><button type="button" data-discovery-action="detail" data-candidate="${esc(row.id)}">${esc(row.company.name)}</button><br>${esc(row.company.city)} · <a href="${esc(row.company.source_url)}" target="_blank" rel="noopener noreferrer">Annuaire</a></td>
      <td>${esc(row.company.industry||row.company.naf_code||'Inconnu')}</td><td>${esc(row.digital)} ${row.verification.confirmed?`<br><a href="${esc(row.verification.url)}" target="_blank" rel="noopener noreferrer">Site confirmé</a>`:''}</td>
      <td>${row.scores.fit.score??'—'}</td><td>${row.scores.need.score??'—'}</td><td>${esc(row.scores.priority)}<br>${esc(row.scores.services.map(s=>s.name).join(', '))}</td>
      <td>${esc(discoveryLabels[row.decision])}${row.duplicates.length&&!row.imported_id?' · doublon possible':''}</td>
    </tr>`).join('')||'<tr><td colspan="8">Aucun résultat pour ces critères. Les sites inconnus restent consultables.</td></tr>'}
    </tbody></table></div>
    ${visible.some(row=>row.decision==='approved')?'<button class="primary">Importer les entreprises approuvées sélectionnées</button>':''}</form>
  </section>`;
}
function prospectDiscoveryWorkspace(){
  if(!discoveryMeta)return '<div class="panel">Chargement de la recherche…</div>';
  const criteria=discoveryRun?.criteria||{},detail=discoveryRun?.results.find(row=>row.id===discoveryDetail);
  return `<div class="discovery-workspace">
    <section class="panel"><h2>Nouvelle recherche</h2><p>Annuaire des Entreprises · objectif initial de 10 candidats · validation manuelle avant import.</p>
    <form id="discovery-search">${discoveryFilters(criteria)}<button class="primary" ${discoveryRun?.state==='running'?'disabled':''}>Rechercher des entreprises</button></form></section>
    ${discoveryRun?discoveryResults(discoveryRun):''}
    ${detail?discoveryCandidate(detail):''}
    <section class="panel"><h2>Historique</h2><p>Résultats temporaires conservés 30 jours.</p>
    ${discoveryMeta.runs.map(run=>`<p><button data-discovery-action="history" data-run="${esc(run.id)}">${esc(discoveryDate(run.created_at))}</button>
      ${esc(discoveryLabels[run.state]||run.state)} · ${run.found} trouvés · ${run.verified} vérifiés · ${run.duplicates} doublons · ${run.approved} approuvés · ${run.rejected} rejetés · ${run.imported} importés · ${run.requests} appels · ${esc(run.source)}</p>`).join('')||'<p>Aucune recherche enregistrée.</p>'}
    </section></div>`;
}
async function discoveryWork(button,action){
  if(discoveryBusy)return;
  discoveryBusy=true;
  if(button)button.disabled=true;
  try{await action();}catch(error){notice(error.message);}
  finally{discoveryBusy=false;if(button?.isConnected)button.disabled=false;}
}
async function importDiscovery(ids){
  if(!ids.length)throw Error('Sélectionnez au moins une entreprise approuvée.');
  const result=await api(discoveryBase+'/import',{ids});
  await refresh();
  await loadDiscoveryRun(discoveryRun.id,{history:true});
  notice(`${result.imported.length} entreprise(s) importée(s).`);
}
document.addEventListener('submit',event=>{
  const form=event.target;
  if(view!=='discovery'||!form.matches('#discovery-search,#discovery-import,[data-discovery-verify],[data-discovery-signal]'))return;
  event.preventDefault();
  const fields=new FormData(form);
  discoveryWork(event.submitter,async()=>{
    if(form.id==='discovery-search'){
      const selection=Object.fromEntries(['sectors','sizes','digital','priorities'].map(key=>[key,fields.getAll(key)]));
      const started=await api(discoveryBase+'/runs',{...selection,location:fields.get('location'),area:fields.get('area'),query:fields.get('query'),limit:Number(fields.get('limit'))});
      discoveryDetail='';discoveryShowAll=false;await loadDiscoveryRun(started.id);
    }else if(form.id==='discovery-import'){
      await importDiscovery(fields.getAll('ids'));
    }else{
      const id=form.dataset.discoveryVerify||form.dataset.discoverySignal;
      await api(discoveryBase+'/candidates/'+id+(form.dataset.discoveryVerify?'/verify':'/signal'),Object.fromEntries(fields));
      await loadDiscoveryRun(discoveryRun.id,{history:true});
    }
  });
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-prospect-discovery],[data-discovery-action],[data-discovery-company]');
  if(!button)return;
  if(button.hasAttribute('data-prospect-discovery')){openProspectDiscovery().catch(error=>notice(error.message));return;}
  if(view!=='discovery')return;
  if(button.dataset.discoveryCompany){entityOpen('companies',button.dataset.discoveryCompany).catch(error=>notice(error.message));return;}
  const {discoveryAction:action,candidate,run}=button.dataset;
  if(action==='detail'){discoveryDetail=candidate;render();document.querySelector('.discovery-record')?.scrollIntoView({block:'nearest'});return;}
  if(action==='toggle'){discoveryShowAll=!discoveryShowAll;render();return;}
  discoveryWork(button,async()=>{
    if(action==='history'){
      discoveryDetail='';discoveryShowAll=false;await loadDiscoveryRun(run);return;
    }
    if(action==='import'){await importDiscovery([candidate]);return;}
    if(action==='cancel')await api(discoveryBase+'/runs/'+discoveryRun.id+'/cancel',{});
    else if(action==='unidentified')await api(discoveryBase+'/candidates/'+candidate+'/verify',{url:''});
    else if(action==='audit'){notice('Audit en cours…');await api(discoveryBase+'/candidates/'+candidate+'/audit',{});notice('Audit enregistré.');}
    else await api(discoveryBase+'/candidates/'+candidate+'/decision',{decision:action,reviewed:action==='approved'});
    await loadDiscoveryRun(discoveryRun.id,{history:true});
  });
});
