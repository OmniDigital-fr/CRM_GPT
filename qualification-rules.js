// Scores are deterministic. AI may explain evidence, never assign scores or act.
export const METHODOLOGY_VERSION = 'omni-qualification-1.0';
export const PRIORITIES = ['Priorité haute','Priorité moyenne','Priorité basse','Données insuffisantes'];
export const SIGNAL_TYPES = ['Demande d’informations','Réponse positive','Demande de devis','Rendez-vous confirmé','Projet annoncé','Refus explicite','Besoin confirmé'];
export const DEFAULT_SERVICES = [
  ['creation-site','Création de site web','Créer un site adapté à un besoin confirmé.'],
  ['refonte','Refonte de site web','Repenser un site et son parcours après diagnostic.'],
  ['maintenance','Maintenance WordPress','Suivi technique d’un site WordPress confirmé.'],
  ['seo-local','SEO local','Améliorer une présence locale après vérification du besoin.'],
  ['seo','Optimisation SEO','Corriger les problèmes SEO observés.'],
  ['performance','Optimisation des performances','Améliorer les temps de chargement mesurés.'],
  ['conversion','Amélioration de la conversion','Simplifier le parcours de prise de contact.'],
  ['automatisation','Automatisation des processus','Automatiser un processus métier documenté.'],
  ['crm','CRM et suivi commercial','Structurer le suivi des relations commerciales.'],
  ['assistant-ia','Chatbots et assistants IA','Étudier un assistant répondant à un besoin explicite.'],
  ['conseil','Conseil et accompagnement digital','Préciser les priorités à partir de faits documentés.']
];
export const NEED_WEIGHTS = {'Performance':20,'SEO technique':25,'Conversion':30,'Expérience mobile':15,'Accessibilité':5,'Sécurité':5};
const severity = {'Erreur critique':100,'Problème important':65,'Amélioration recommandée':20,'Conforme au contrôle':0};
const categoryService = {'Performance':'performance','SEO technique':'seo','Conversion':'conversion','Expérience mobile':'refonte','Accessibilité':'conseil','Sécurité':'conseil'};
export const redact = v => String(v ?? '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email masqué]').replace(/(?:\+?\d[\s().-]*){9,15}/g,'[numéro masqué]').replace(/https?:\/\/[^\s<>]+/g,'[URL masquée]').replace(/[\x00-\x1f]/g,' ').slice(0,600);
function sizeValue(value) {
  const s=String(value||'').trim().toLowerCase();
  if (/^(tpe|pme|micro[- ]entreprise|indépendant|solo)$/.test(s)) return 100;
  const range=s.match(/^(\d+)\s*(?:à|-|–)\s*(\d+)(?:\s*(?:salariés?|personnes|employés?))?$/);
  if(range){const a=Number(range[1]),b=Number(range[2]);if(a>b)return null;if(b<=100)return 100;if(a>100)return 30;return null;}
  const n=s.match(/^(\d+)(?:\s*(?:salariés?|personnes|employés?))?$/);
  return n ? (Number(n[1])<=100?100:30) : null;
}
export function computeQualification({company,audit,signals=[],catalog=DEFAULT_SERVICES.map(([code,name,description])=>({code,name,description,active:1})),opportunities=[],restricted=false,now=Date.now()}) {
  const evidence=[],missing=[],fitParts=[];
  const fit=(criterion,weight,value,detail)=>{fitParts.push({criterion,weight,value,detail});if(value===null)missing.push(criterion);};
  fit('Effectif',35,sizeValue(company.company_size),'Cible : TPE/PME jusqu’à 100 personnes ; effectif inconnu exclu du calcul.');
  const country=(company.country||'').toLowerCase().trim();
  fit('Localisation',25,country?(['france','fr','français'].includes(country)?100:40):null,'Cible géographique : France entière.');
  fit('Secteur',10,company.industry?.trim()?100:null,'Tous secteurs : aucun secteur exclu par défaut.');
  fit('Présence digitale',10,company.website?.trim()?100:null,'Un site renseigné permet un diagnostic ; une absence de champ ne prouve pas une absence de site.');
  const recent=signals.filter(s=>Date.parse(s.observed_at)<=now && now-Date.parse(s.observed_at)<=180*86400000);
  const activeCatalog=catalog.filter(s=>s.active),allowed=new Map(activeCatalog.map(s=>[s.code,s]));
  const confirmedNeeds=recent.filter(s=>s.type==='Besoin confirmé'&&allowed.has(s.service_code));
  fit('Besoin / modèle commercial',20,confirmedNeeds.length?100:null,'Compatibilité fondée sur un besoin documenté, jamais sur un budget supposé.');
  for(const p of fitParts.filter(p=>p.value!==null)) evidence.push({id:'fit:'+p.criterion,kind:'Donnée entreprise déclarée',label:p.criterion,observation:p.criterion==='Effectif'?company.company_size:p.criterion==='Localisation'?company.country:p.criterion==='Secteur'?company.industry:p.detail,source:'Fiche entreprise',observed_at:company.updated_at});
  const known=fitParts.filter(p=>p.value!==null),coverage=known.reduce((s,p)=>s+p.weight,0);
  const fitScore=known.length>=2&&coverage>=40?Math.round(known.reduce((s,p)=>s+p.weight*p.value,0)/coverage):null;
  const controls=Array.isArray(audit?.result?.controls)?audit.result.controls.filter(c=>c&&typeof c==='object'&&typeof c.category==='string'):[];
  const auditFresh=!!audit&&Number.isFinite(Date.parse(audit.created_at))&&now-Date.parse(audit.created_at)<=90*86400000&&Date.parse(audit.created_at)<=now;
  const categories=Object.entries(NEED_WEIGHTS).map(([name,weight])=>{
    const all=controls.filter(c=>c.category===name),checked=all.filter(c=>Object.hasOwn(severity,c.status));
    // Mean of distinct control IDs: repeated pages cannot multiply a problem.
    const groups=new Map();for(const c of checked){const key=c.id||c.label;groups.set(key,Math.max(groups.get(key)??0,severity[c.status]));}
    return {name,weight,checked:groups.size,unknown:all.filter(c=>c.status==='Non vérifié').length,value:groups.size?Math.round([...groups.values()].reduce((a,b)=>a+b,0)/groups.size):null};
  });
  const covered=categories.filter(c=>c.value!==null),needCoverage=covered.reduce((n,c)=>n+c.weight,0);
  const needScore=auditFresh&&covered.length>=2&&needCoverage>=40?Math.round(covered.reduce((s,c)=>s+c.weight*c.value,0)/needCoverage):null;
  if(!audit)missing.push('Audit digital récent');else if(!auditFresh)missing.push('Audit de moins de 90 jours');
  if(needScore===null)missing.push('Couverture de contrôle suffisante pour le Need Score');
  const candidates=[];
  for(const [i,c] of controls.entries()){
    if(!Object.hasOwn(severity,c.status))continue;
    const eid='audit:'+i;
    evidence.push({id:eid,kind:'Contrôle automatisé indicatif',label:c.label,observation:c.evidence,page_url:c.page_url,source:c.source||'Audit digital',observed_at:audit.created_at,status:c.status});
    const code=categoryService[c.category];
    if(auditFresh&&severity[c.status]>=65&&allowed.has(code))candidates.push({code,evidence_ids:[eid],reason:'Piste à confirmer à partir du contrôle : '+c.label});
  }
  for(const s of recent){
    evidence.push({id:'signal:'+s.id,kind:'Signal documenté',label:s.type,observation:s.evidence,source:s.source,observed_at:s.observed_at});
    if(s.type==='Besoin confirmé'&&allowed.has(s.service_code))candidates.push({code:s.service_code,evidence_ids:['signal:'+s.id],reason:'Besoin confirmé par un enregistrement humain.'});
  }
  const intentValues={'Demande d’informations':40,'Réponse positive':60,'Demande de devis':85,'Rendez-vous confirmé':75,'Projet annoncé':60,'Refus explicite':0};
  const intentSignal=recent.filter(s=>Object.hasOwn(intentValues,s.type)).sort((a,b)=>b.observed_at.localeCompare(a.observed_at)||String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
  const intentScore=intentSignal?intentValues[intentSignal.type]:null;
  if(intentScore===null)missing.push('Signal d’intention documenté de moins de 180 jours');
  let priority='Données insuffisantes',reason='Compléter les données avant de prioriser la prospection.';
  if(restricted||company.business_status==='Opposition'||company.company_status==='Fermée') {priority='Priorité basse';reason='Restriction de contact ou entreprise déclarée fermée : vérification interne uniquement.';}
  else if(intentScore===0){priority='Priorité basse';reason='Le dernier signal documenté est un refus explicite.';}
  else if(fitScore!==null&&fitScore<50){priority='Priorité basse';reason='Adéquation faible sur les critères connus ; vérifier le périmètre.';}
  else if(fitScore!==null&&fitScore>=70&&intentScore!==null&&intentScore>=60&&(needScore!==null&&needScore>=30||confirmedNeeds.length)){priority='Priorité haute';reason='Adéquation, besoin et signal d’intérêt documentés se recoupent.';}
  else if(fitScore!==null&&((needScore!==null&&needScore>=20)||intentScore!==null&&intentScore>0)){priority='Priorité moyenne';reason='Une piste existe ; confirmer le besoin, le calendrier et l’intérêt.';}
  else if(fitScore!==null&&needScore!==null){priority='Priorité basse';reason='Peu de besoins mesurés dans le périmètre contrôlé ; aucune urgence déduite.';}
  const services=[...new Set(candidates.map(s=>s.code))].map(code=>({code,name:allowed.get(code).name,evidence_ids:[...new Set(candidates.filter(s=>s.code===code).flatMap(s=>s.evidence_ids))],reason:candidates.find(s=>s.code===code).reason}));
  const contracted=opportunities.filter(o=>o.stage==='Gagné'&&o.contract_reference&&o.contract_signed_at).reduce((n,o)=>n+o.monthly_cents,0);
  const potential=opportunities.filter(o=>!['Gagné','Perdu'].includes(o.stage)&&o.monthly_cents>0).reduce((n,o)=>n+o.monthly_cents,0);
  return {methodology_version:METHODOLOGY_VERSION,fit:{score:fitScore,coverage,criteria:fitParts},need:{score:needScore,coverage:needCoverage,categories,audit_id:audit?.id||null,audit_fresh:auditFresh},intent:{score:intentScore,label:intentScore===null?'Inconnue':intentSignal.type,signal_id:intentSignal?.id||null},priority,priority_reason:reason,restricted,services,evidence,missing,confidence:fitScore!==null&&needScore!==null&&intentScore!==null?'Moyenne':'Faible',recurring:{contracted_monthly_cents:contracted,potential_monthly_cents:potential||null,explanation:'Potentiel : montants mensuels saisis dans les opportunités ouvertes, non contractés et sans pondération. Signé : opportunités gagnées avec référence et date de signature. Aucun tarif déduit par IA.'},next_action:restricted?'Vérifier les oppositions et les canaux autorisés ; aucune prise de contact suggérée.':intentScore===0?'Respecter le refus ; vérifier en interne avant toute nouvelle démarche.':'Vérifier les preuves et confirmer le besoin avant toute proposition.'};
}
