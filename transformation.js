export const POSITIONING_VERSION='transformation-1';
export const DIAGNOSTIC_TITLE='Diagnostic de transformation numérique';
export const TRANSFORMATION_SERVICES=[
 ['application-web','Applications web sur mesure','Étudier une application web à partir d’un besoin métier documenté.'],
 ['application-mobile','Applications mobiles sur mesure','Étudier un usage mobile confirmé et les solutions existantes avant un développement.'],
 ['integration-ia','Intégration de solutions d’intelligence artificielle','Évaluer la pertinence de l’IA sur un besoin documenté, avec contrôle humain et protection des données.']
];
const domains=[
 {code:'applications',name:'Applications sur mesure',services:['application-web','application-mobile','crm'],question:'Quel parcours client ou métier vos outils actuels couvrent-ils difficilement ?',solution:'Comparer les logiciels disponibles et une application sur mesure selon les utilisateurs et le périmètre.'},
 {code:'automatisation',name:'Automatisation des processus',services:['automatisation'],question:'Quelles informations passent entre vos outils, et quelles étapes nécessitent votre intervention ?',solution:'Étudier une connexion entre outils ou une automatisation limitée au processus confirmé.'},
 {code:'ia',name:'Intelligence artificielle',services:['integration-ia','assistant-ia'],question:'Quel usage précis justifierait une aide à la recherche, au classement ou à la rédaction, et comment vérifier ses réponses ?',solution:'Comparer une solution classique et un essai IA limité, selon la qualité des données et les contrôles nécessaires.'},
 {code:'conseil',name:'Conseil technologique',services:['conseil'],question:'Quels outils utilisez-vous, quelles limites rencontrez-vous et quelle priorité souhaitez-vous traiter ?',solution:'Cartographier les outils et les usages avant de choisir une évolution.'}
];
const sectorRules=[
 {pattern:/bâtiment|batiment|construction|plomb|chauff|électric|electric/i,naf:['41','42','43'],topic:'demandes clients, interventions et coordination administrative'},
 {pattern:/commerce|boutique|vente|e-commerce/i,naf:['45','46','47'],topic:'commandes, relation client et échanges entre outils'},
 {pattern:/immobili/i,naf:['68'],topic:'demandes, dossiers et organisation des rendez-vous'},
 {pattern:/industrie|fabrication/i,naf:Array.from({length:30},(_,i)=>String(i+5).padStart(2,'0')),topic:'suivi des opérations et centralisation des informations'},
 {pattern:/services aux entreprises|b2b|conseil|informatique/i,naf:['62','63','69','70','71','72','73','74','78','82'],topic:'documents, suivi administratif et échanges avec les clients'}
];
const oneLine=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,300);
function host(value){try{return new URL(value).hostname.replace(/^www\./,'')}catch{return ''}}
function recent(value,days,now){const time=Date.parse(value);return Number.isFinite(time)&&time<=now&&now-time<=days*86400000;}

export function buildTransformationDiagnostic({company={},audit,signals=[],restricted=false,config=readOutreachConfig(),now=Date.now()}={}){
 const latest=signals.filter(signal=>recent(signal.observed_at,180,now))
  .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at))[0];
 restricted=restricted||company.business_status==='Opposition'||company.company_status==='Fermée'||latest?.type==='Refus explicite';
 const result=audit?.result;
 const currentHost=host(company.website);
 const usable=!!result&&!!currentHost&&host(result.requestedUrl||result.url)===currentHost&&host(result.url)===currentHost&&
  recent(audit.created_at||result.date,90,now)&&['partial','completed'].includes(result.execution_status);
 const controls=usable&&Array.isArray(result.controls)?result.controls:[];
 const labels={'Performance':'Confort de consultation','SEO technique':'Présentation de la page',
  'Conversion':'Parcours de contact','Expérience mobile':'Consultation sur téléphone','Accessibilité':'Facilité d’utilisation','Sécurité':'Réglages techniques'};
 const observations=controls.filter(c=>['Erreur critique','Problème important','Amélioration recommandée'].includes(c.status)&&c.page_url&&c.source)
  .slice(0,12).map(c=>{
   const explanation=(result.commercial_opportunities||[]).find(item=>item.problem===c.label&&item.page_url===c.page_url);
   return {classification:'Constat vérifié',text:explanation?.plain_problem||labels[c.category]||'Contrôle du site',
    evidence:explanation?.plain_observation||'Un point du contrôle demande une vérification sur la page examinée. La preuve détaillée est disponible dans le rapport technique.',
    technical_evidence:c.evidence,source:c.source,url:c.page_url,date:c.observed_at||audit.created_at,
    confidence:c.confidence||'À confirmer',action:c.recommendation||''};
  });
 const documented=signals.filter(s=>s.type==='Besoin confirmé'&&s.source&&s.evidence&&recent(s.observed_at,180,now));
 const sector=sectorRules.find(rule=>rule.pattern.test(company.industry||'')||rule.naf.includes(String(company.naf_code||'').slice(0,2)));
 const basis=company.industry||company.naf_code;
 const opportunities=domains.filter(domain=>domain.code==='conseil'||domain.code!=='ia'&&sector||documented.some(s=>domain.services.includes(s.service_code)))
  .map(domain=>{
   const proof=documented.find(s=>domain.services.includes(s.service_code));
   return {domain:domain.name,code:domain.code,classification:proof?'Besoin documenté, solution à confirmer':'Opportunité potentielle',
    justification:proof?proof.evidence:sector?'L’activité déclarée invite à examiner '+sector.topic+'. Aucun dysfonctionnement interne n’est établi.':'Les outils et priorités internes restent à préciser.',
    confidence:proof?'Moyenne':'Faible',source:proof?.source||'Fiche entreprise · activité déclarée',
    date:proof?.observed_at||company.updated_at||company.collected_at||'',url:'',
    questions:[domain.question],solution:domain.solution,
    service_code:proof?.service_code||null};
  });
 const questions=[
  sector?'Comment gérez-vous aujourd’hui '+sector.topic+' ?':'Quels outils soutiennent votre activité au quotidien ?',
  'Quel besoin souhaitez-vous résoudre en priorité, avec quels utilisateurs et quelles contraintes ?',
  'Qui participe à la décision et quel calendrier envisagez-vous ?'
 ];
 const ai=opportunities.filter(item=>item.code==='ia');
 return {version:POSITIONING_VERSION,title:DIAGNOSTIC_TITLE,restricted,
  company:{name:company.name||'Entreprise',activity:basis||'Activité non renseignée',size:company.company_size||'Effectif non renseigné',
   location:[company.postal_code,company.city].filter(Boolean).join(' ')||company.country||'Localisation non renseignée',
   source:'Fiche entreprise',date:company.updated_at||company.collected_at||'',status:'Informations CRM à confirmer'},
  presence:{website:company.website||'',status:!company.website?'Site non renseigné ; présence web à confirmer':
   usable?'Audit web récent disponible':'Audit web actuel indisponible, ancien ou non attribuable au site enregistré',
   tools:'Logiciels internes, applications mobiles et échanges de données à confirmer avec l’entreprise.',
   audit_id:usable?audit.id:null,observations},
  opportunities,ai:{opportunities:ai,message:ai.length?'Usage documenté à étudier avant toute recommandation.':
   'Aucun besoin d’intelligence artificielle démontré dans les données disponibles.',
   questions:['Un besoin de recherche, de classement ou de rédaction existe-t-il ?','Quelles données seraient utilisables et qui contrôlerait les résultats ?']},
  recommendations:opportunities.filter(item=>item.service_code),
  questions,missing:['Outils et intégrations utilisés','Processus et difficultés confirmés','Utilisateurs, données et contraintes','Périmètre, budget et calendrier déclarés'],
  project:documented.length?'Besoin documenté ; périmètre, faisabilité et décision à confirmer':'Potentiel de projet à confirmer en rendez-vous',
  recurring:'Accompagnement récurrent à confirmer selon les besoins de suivi et les engagements renseignés.',
  proposed_email:restricted?null:transformationEmail({company:company.name,industry:company.industry,naf_code:company.naf_code},{config}),
  next:restricted?'Vérifier les restrictions en interne.':'Proposer un diagnostic de 20 minutes pour confirmer les priorités.'
 };
}

export function readTransformationContext(db,companyId){
 const company=db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
 if(!company)return null;
 const row=db.prepare("SELECT id,payload,created_at FROM audits WHERE company_id=? AND json_valid(payload) AND json_extract(payload,'$.engine_version')=3 ORDER BY created_at DESC,rowid DESC LIMIT 1").get(companyId);
 return {company,audit:row?{id:row.id,created_at:row.created_at,result:JSON.parse(row.payload)}:null,
  signals:db.prepare('SELECT * FROM qualification_signals WHERE company_id=?').all(companyId),
  restricted:company.business_status==='Opposition'||company.company_status==='Fermée'};
}

export function readOutreachConfig(env=process.env){
 const value=env.OMNI_CONTACT_FORM_URL||'';
 if(!value)return {contactForm:'',signatureProvided:!!env.MAIL_SIGNATURE_HTML};
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||!['omnidigital.fr','www.omnidigital.fr'].includes(url.hostname))
  throw new Error('OMNI_CONTACT_FORM_URL doit être une URL HTTPS du site Omni Digital.');
 return {contactForm:url.href,signatureProvided:!!env.MAIL_SIGNATURE_HTML};
}
export function meetingInvitation(config={}){
 return 'Seriez-vous disponible pour un diagnostic de 20 minutes, sans engagement ?\n'+
  'Vous pouvez me répondre ou choisir un créneau : https://calendar.app.google/d2Cz8bKbXN6zfxsX6'+
  (config.contactForm?'\nVous pouvez aussi utiliser notre formulaire : '+config.contactForm:'');
}
export function messageFooter(config={}){
 return (config.signatureProvided?'':'\n\nOmniDigital\nhttps://omnidigital.fr')+'\n\nSi vous ne souhaitez plus être contacté, répondez simplement « stop ».';
}
export function transformationEmail(prospect,{observation='',context='',config={},reply=false}={}){
 const company=oneLine(prospect.company)||'votre entreprise';
 const sector=sectorRules.find(rule=>rule.pattern.test(prospect.industry||'')||rule.naf.includes(String(prospect.naf_code||'').slice(0,2)));
 const question=sector?'Comment suivez-vous aujourd’hui '+sector.topic+' ?':'Je vous propose de faire le point sur vos outils et vos priorités, pour voir si une amélioration concrète serait utile à votre activité.';
 const postponed=reply&&['Pas maintenant / rappeler plus tard','Pas de budget','Projet reporté'].includes(prospect.response_scenario);
 const responses={
  'Demande de devis / tarifs':'Pour préparer une proposition adaptée, quels usages et quel périmètre souhaitez-vous couvrir ?',
  'Demande d’informations':'Quel aspect souhaitez-vous préciser : les usages, les outils concernés ou la manière de démarrer ?',
  'Déjà un prestataire':'Quel complément à votre organisation actuelle souhaiteriez-vous éventuellement examiner ?',
  'Pas maintenant / rappeler plus tard':'À quelle période souhaiteriez-vous reprendre cet échange ?',
  'Pas de budget':'Souhaitez-vous reprendre cet échange lorsque le budget sera défini ?',
  'Projet reporté':'À quel moment serait-il utile de reprendre le sujet ?'
 };
 const response=reply?responses[prospect.response_scenario]:'';
 const opening=reply?'Merci pour votre retour au sujet de '+company+'.':
  'Je vous contacte au sujet de '+company+'. Omni Digital accompagne les entreprises dans leur transformation numérique, avec des applications sur mesure, des échanges entre logiciels et des solutions d’IA lorsque leur usage est pertinent.';
 const body='Bonjour,\n\n'+opening+'\n\n'+(observation?observation+'\n\n':
  (response||question)+'\n\n')+
  (postponed?'':meetingInvitation(config))+messageFooter(config);
 return {subject:company+' — échange sur vos outils numériques',body,context,footer:messageFooter(config)};
}
