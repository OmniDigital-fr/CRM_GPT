const CONTACT_STATUSES=["Nouveau", "À qualifier", "Sans email", "Qualifié", "Contacté", "Intéressé", "Rendez-vous", "Proposition envoyée", "Négociation", "À recontacter", "Pas intéressé", "Injoignable", "Gagné", "Perdu", "Opposition"];
function contactBlocked(p){return p.status==='Opposition'||p.contact_permission==='Opposition'}
let state, view='dashboard', editingId=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,data,raw=false){const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':raw?'application/pdf':'application/json'},body:raw?data:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error);return v}
function notice(s){$('#notice').textContent=s}
async function refresh(){state=await api('/api/state');render()}
function metric(label,n,detail){return `<article class="metric"><span class="label">${label}</span><strong>${n}</strong><small>${detail}</small></article>`}
function duplicateIds(){return new Set((state.duplicate_groups||[]).flatMap(g=>g.ids))}
function table(items=state.prospects){const q=($('#search').value||'').toLocaleLowerCase('fr');items=items.filter(p=>[p.company,p.contact_name,p.email,p.phone,p.city].some(v=>String(v||'').toLocaleLowerCase('fr').includes(q)));return items.length?`<div class="table-wrap"><table><thead><tr><th>ENTREPRISE</th><th>CONTACT</th><th>STATUT</th><th>DOSSIER & ANALYSE</th><th>ACTIONS</th></tr></thead><tbody>${items.map(p=>{let audit=JSON.parse(p.audit);return `<tr><td><b>${esc(p.company)}</b> ${contactBlocked(p)?'<span class="blocked-badge">Ne pas contacter</span>':''} ${duplicateIds().has(p.id)?'<span class="duplicate-badge">Doublon à vérifier</span>':''}<br><span class="muted">${esc(p.email||'Email non renseigné')}</span><br><span class="muted">${esc(p.website)}</span><br><span class="muted">${esc([p.city,p.industry].filter(Boolean).join(' · '))}</span></td><td>${esc(p.contact_name||'À renseigner')}<br><span class="muted">${esc(p.phone||p.mobile||'')}</span><br><span class="muted">${p.priority?'Priorité : '+esc(p.priority):''}${p.next_followup?' · Relance : '+esc(p.next_followup):''}</span></td><td><select data-status="${p.id}" aria-label="Statut de ${esc(p.company)}">${CONTACT_STATUSES.map(x=>`<option ${p.status===x?'selected':''}>${x}</option>`).join('')}</select></td><td><span class="muted">${p.pdf_text?'PDF importé · '+p.pdf_text.length+' caractères':'Aucun PDF'}</span><br><span class="muted">${audit.scores?esc(Object.entries(audit.scores).map(([k,v])=>`${k}: ${v}/100`).join(' · ')):'Aucun audit Google'}</span></td><td><button data-edit="${p.id}">Voir / modifier</button><button data-history="${p.id}">Historique</button><button class="danger-button" data-delete="${p.id}">Supprimer</button><button data-pdf="${p.id}">Importer PDF</button><button data-audit="${p.id}">Audit du site</button><button data-reply-contact="${p.id}">Regist. réponse</button><button data-action="draft" data-id="${p.id}" ${contactBlocked(p)||p.do_not_email==='Oui'?'disabled title="Prospection bloquée pour ce contact"':''}>Préparer un email</button></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">Votre prochain client commence ici.<br>Ajoutez un prospect pour constituer son dossier.</div>'}
function render(){
 const titles={dashboard:'Dashboard',prospects:'Contacts',research:'Prospection',audits:'Audit du site',followups:'Relances',campaigns:'Emails',sequences:'Séquences',templates:'Modèles',integrations:'Automatisation & intégrations'};
 $('#title').textContent=titles[view]||'Dashboard';
 $('#subtitle').textContent=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date());
 document.querySelectorAll('nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('#followup-count').textContent=dueContacts().length+dueSequenceMessages().length;
 $('#workspace-context').textContent=view==='dashboard'?'Votre activité en un coup d’œil':view==='prospects'?`${state.prospects.length} contacts dans votre portefeuille`:'Votre espace de développement commercial';
 let html='';
 if(view==='dashboard')html=dashboard();
 if(view==='audits')html=auditWorkspace();
 if(view==='prospects')html=`<div class="panel"><div class="panel-heading"><h2>Votre carnet de contacts</h2><span class="badge">${state.prospects.length} contacts</span></div>${duplicateIds().size?`<p class="duplicate-warning">${duplicateIds().size} fiches présentent un nom d’entreprise ou un email identique. Elles sont signalées ci-dessous ; aucune suppression automatique.</p>`:''}${table()}</div>`;
 if(view==='research')html=`<div class="panel"><div class="panel-heading"><h2>Dossiers & analyses de prospection</h2><span class="badge">PDF · PageSpeed Insights</span></div><p>Retrouvez vos rapports, analysez les sites et préparez votre approche commerciale.</p>${table()}</div>`;
 if(view==='followups')html=sequenceDuePanel()+`<div class="panel"><div class="panel-heading"><h2>Relances à traiter</h2><span class="badge">${dueContacts().length} à échéance</span></div><p>Contacts dont la date de relance est aujourd’hui ou dépassée. Aucun envoi automatique n’est activé.</p>${dueContacts().length?table(dueContacts()):'<div class="empty">Vous êtes à jour.<br>Planifiez votre prochaine relance dans une fiche contact.</div>'}</div>`;
 if(view==='sequences')html=sequenceWorkspace();
 if(view==='templates')html=`<div class="panel"><div class="panel-heading"><h2>Modèle de premier contact</h2><span class="badge">Disponible</span></div><p>Le modèle actuel adapte le brouillon aux besoins renseignés, au dossier PDF et aux scores PageSpeed. Préparez un message depuis une fiche prospect, puis retrouvez-le dans Emails.</p><div class="template-preview"><span class="eyebrow">OBJET</span><h3>[Entreprise] — pistes pour votre présence digitale</h3><p>Présentation OmniDigital · points du dossier à vérifier · proposition d’échange · possibilité de s’opposer au contact.</p></div><button data-go="prospects" class="primary">Choisir un contact</button></div>`;
 if(view==='campaigns')html=campaignWorkspace();
 if(view==='integrations')html=`<div class="panel integration"><h2>Google PageSpeed Insights <span class="badge">${state.integrations.pagespeed?'Clé configurée':'À configurer'}</span></h2><p>Analyse mobile : performance, SEO, accessibilité et bonnes pratiques. Les résultats alimentent les brouillons de prospection.</p><code>Variable serveur : PAGESPEED_API_KEY</code></div><div class="panel integration"><h2>Messagerie & automatisations <span class="badge">Non connecté</span></h2><p>Prochaine étape : connecter le fournisseur email, les séquences, les désinscriptions, les webhooks de livraison et les réponses. Aucun email n’est envoyé par cette version.</p></div><div class="panel integration"><h2>Rapports PDF <span class="badge">Disponible</span></h2><p>Extraction locale du texte des rapports, associé au prospect. Les PDF scannés nécessitent un futur module OCR.</p></div><div class="panel integration"><h2>Modules futurs</h2><p>Calendrier, devis, facturation, enrichissement et IA : points d’extension décrits dans la documentation du projet.</p></div>`;
 $('#content').innerHTML=html;
}
document.querySelectorAll('nav [data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;notice('');if(view==='audits'){openAudit(auditContactId||state.prospects[0]?.id);return}render()});function openContact(prospect=null){
 editingId=prospect?.id||null;$('#contact-error').textContent='';
 const form=$('#create');form.reset();
 if(prospect)for(const [key,value] of Object.entries(prospect)){const field=form.elements.namedItem(key);if(field){if(field.tagName==='SELECT'&&![...field.options].some(o=>o.value===(value??'')))continue;field.value=value??''}}
 $('#form-title').textContent=prospect?'Fiche prospect · '+prospect.company:'Ajouter un prospect';
 updatePermissionWarning(prospect);
 $('#contact-history').hidden=!prospect;
 $('#contact-history-list').textContent='Chargement…';
 if(prospect)api(`/api/prospects/${prospect.id}/history`).then(data=>{
   if(editingId!==prospect.id)return;
   $('#contact-history-list').innerHTML=data.history.map(h=>`<article class="contact-event"><b>${esc(h.kind)}</b><small>${esc(new Date(h.created).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}))}</small><p>${esc(h.detail)}</p></article>`).join('')||'<p>Aucun événement enregistré.</p>';
 }).catch(e=>{$('#contact-history-list').textContent=e.message});
 $('#modal').showModal();
}
$('#add').onclick=()=>openContact();$('#cancel').onclick=()=>$('#modal').close();$('#create').onsubmit=async e=>{e.preventDefault();try{await api(editingId?`/api/prospects/${editingId}/update`:'/api/prospects',{...Object.fromEntries(new FormData(e.target)),country:editingId?(state.prospects.find(p=>p.id===editingId)?.country||''):''});e.target.reset();$('#modal').close();await refresh();notice('Prospect enregistré.')}catch(e){$('#contact-error').textContent=e.message}};
$('#content').addEventListener('change',async e=>{if(e.target.dataset.status){try{await api(`/api/prospects/${e.target.dataset.status}/status`,{status:e.target.value});await refresh()}catch(e){notice(e.message);await refresh()}}});
$('#content').addEventListener('click',async e=>{let b=e.target.closest('button');if(!b)return;try{if(b.dataset.history){openContact(state.prospects.find(p=>p.id===b.dataset.history));$('#contact-history').open=true;$('#contact-history').scrollIntoView({block:'start'});return}if(b.dataset.audit){await openAudit(b.dataset.audit);return}if(b.dataset.delete){await requestDelete(b.dataset.delete);return}if(b.dataset.go){view=b.dataset.go;render();return}if(b.dataset.chart){chartMode=b.dataset.chart;render();return}if(b.dataset.edit){openContact(state.prospects.find(p=>p.id===b.dataset.edit));return}if(b.dataset.action){b.disabled=true;notice(b.dataset.action==='audit'?'Analyse Google en cours…':'Préparation du brouillon…');await api(`/api/prospects/${b.dataset.id}/${b.dataset.action}`,{});if(b.dataset.action==='draft')view='campaigns';await refresh();notice('Opération terminée.')}if(b.dataset.pdf){let input=document.createElement('input');input.type='file';input.accept='application/pdf';input.onchange=async()=>{if(!input.files[0])return;try{await api(`/api/prospects/${b.dataset.pdf}/pdf`,input.files[0],true);await refresh();notice('Texte du PDF ajouté au dossier.')}catch(e){notice(e.message)}};input.click()}if(b.dataset.copy){await navigator.clipboard.writeText(state.messages.find(x=>x.id===b.dataset.copy).body);notice('Texte copié.')}}catch(e){notice(e.message)}finally{b.disabled=false}});refresh().catch(e=>notice(e.message));

$('#import-pdf').onclick=()=>{
 const input=document.createElement('input');input.type='file';input.accept='application/pdf';
 input.onchange=async()=>{
  if(!input.files[0])return;
  const button=$('#import-pdf');button.disabled=true;
  notice('Import du dossier PDF en cours…');
  try{
   const result=await api('/api/import-pdf',input.files[0],true);
   view='prospects';await refresh();
   notice(result.created?'Prospect créé avec le texte du rapport PDF. Aucun email envoyé.':'Ce prospect existe déjà. Aucun doublon créé.');
  }catch(e){notice(e.message)}finally{button.disabled=false}
 };input.click();
};

$('#search').addEventListener('input',()=>{if($('#search').value.trim())view='prospects';render()});
try{document.documentElement.dataset.theme=localStorage.getItem('omni-theme')||'light'}catch(e){}
function updateThemeLabel(){const dark=document.documentElement.dataset.theme==='dark';$('#theme-toggle').textContent=dark?'☀':'☾';$('#theme-toggle').setAttribute('aria-label',dark?'Activer le thème clair':'Activer le thème sombre')}
updateThemeLabel();
$('#theme-toggle').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('omni-theme',document.documentElement.dataset.theme)}catch(e){}updateThemeLabel()};

async function requestDelete(id){
 const p=state.prospects.find(p=>p.id===id);if(!p)return;
 $('#delete-name').textContent=p.company;
 const dialog=$('#delete-modal');dialog.dataset.id=id;dialog.showModal();
}
$('#cancel-delete').onclick=()=>$('#delete-modal').close();
$('#confirm-delete').onclick=async()=>{
 const button=$('#confirm-delete'),dialog=$('#delete-modal'),id=dialog.dataset.id;
 button.disabled=true;
 try{await api(`/api/prospects/${id}/delete`,{confirm:id});dialog.close();await refresh();notice('Contact et dossier associé supprimés.')}catch(e){$('#delete-error').textContent=e.message}finally{button.disabled=false}
};
$('#delete-modal').addEventListener('close',()=>{$('#delete-error').textContent=''});

function updatePermissionWarning(prospect=null){
 const form=$('#create'),opposed=form.elements.contact_permission.value==='Opposition'||form.elements.status.value==='Opposition';
 $('#permission-warning').textContent=opposed?'Opposition active : aucun nouveau brouillon ni relance. Une suppression conserve seulement les empreintes nécessaires au blocage des réimportations.':'';
 $('#reconsent-open').hidden=!(prospect&&contactBlocked(prospect));
}
$('#create').addEventListener('change',e=>{
 const form=$('#create');
 if(e.target.name==='response_scenario'){
  const scenario=e.target.value;
  const stages={'Réponse positive':'Intéressé','Demande d’informations':'Contacté','Demande de rendez-vous':'Rendez-vous','Demande de devis / tarifs':'Intéressé','Pas maintenant / rappeler plus tard':'À recontacter','Pas de budget':'À recontacter','Déjà un prestataire':'À recontacter','Pas intéressé / offre refusée':'Pas intéressé','Ne plus être contacté':'Opposition','Demande de suppression des données':'Opposition','Adresse email invalide / rebond':'Injoignable','Entreprise fermée':'Perdu','Projet reporté':'À recontacter'};
  if(stages[scenario])form.elements.status.value=stages[scenario];
  if(scenario==='Adresse email invalide / rebond')form.elements.do_not_email.value='Oui';
 }
 if(form.elements.status.value==='Opposition'||form.elements.contact_permission.value==='Opposition'){
  form.elements.status.value='Opposition';form.elements.contact_permission.value='Opposition';form.elements.next_followup.value='';
  if(!form.elements.opposition_date.value)form.elements.opposition_date.value=todayKey();
 }
 if(['Perdu','Pas intéressé'].includes(form.elements.status.value))form.elements.next_followup.value='';
 updatePermissionWarning(editingId?state.prospects.find(p=>p.id===editingId):null);
});
$('#reconsent-open').onclick=()=>{$('#reconsent-evidence').value='';$('#reconsent-error').textContent='';$('#reconsent-modal').showModal()};
$('#reconsent-cancel').onclick=()=>$('#reconsent-modal').close();
$('#reconsent-confirm').onclick=async()=>{
 const button=$('#reconsent-confirm');button.disabled=true;
 try{await api(`/api/prospects/${editingId}/reconsent`,{confirm:editingId,evidence:$('#reconsent-evidence').value});$('#reconsent-modal').close();$('#modal').close();await refresh();openContact(state.prospects.find(p=>p.id===editingId));notice('Nouvel accord enregistré. Aucune relance programmée.')}catch(e){$('#reconsent-error').textContent=e.message}finally{button.disabled=false}
};
