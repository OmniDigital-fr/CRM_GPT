import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {load} from 'cheerio';
import {saveCompany, validateFrenchCompanyIds, restrictedIdentity} from './entities.js';
import {suppressed, isOpposed} from './contact-policy.js';
import {siteUrl, publicAddress, inspectWebsite} from './site-audit.js';
import {runDigitalAudit} from './digital-audit.js';
import {computeQualification} from './qualification-rules.js';

const source='Annuaire des Entreprises';
const endpoint='https://recherche-entreprises.api.gouv.fr/search';
const date=()=>new Date().toISOString();
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const text=(value,max=250)=>typeof value==='string'?value.trim().slice(0,max):'';
const parse=value=>JSON.parse(value);
const DAY=86400000;
export class DiscoveryError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const fail=(message,status)=>{throw new DiscoveryError(message,status);};
const transaction=(db,fn)=>{
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
};
const sectors={
  Commerce:['G'], Industrie:['B','C','E'], Bâtiment:['F'], Immobilier:['L'], Transport:['H'],
  'Services aux entreprises':['J','K','M','N'], Santé:['Q'], Restauration:['56'],
  Tourisme:['55','79','91','93'], Énergie:['D'], Autres:['A','O','P','R','S','T','U']
};
const sectionRanges=[['A',1,3],['B',5,9],['C',10,33],['D',35,35],['E',36,39],['F',41,43],['G',45,47],['H',49,53],['I',55,56],['J',58,63],['K',64,66],['L',68,68],['M',69,75],['N',77,82],['O',84,84],['P',85,85],['Q',86,88],['R',90,93],['S',94,96],['T',97,98],['U',99,99]];
const workforce={'00':[0,0],'01':[1,2],'02':[3,5],'03':[6,9],'11':[10,19],'12':[20,49],'21':[50,99],'22':[100,199],'31':[200,249],'32':[250,499],'41':[500,999],'42':[1000,1999],'51':[2000,4999],'52':[5000,9999],'53':[10000,Infinity]};
const sizes={'Microentreprise':[0,9],'TPE':[0,9],'PME':[0,249],'1–10 salariés':[1,10],'11–50 salariés':[11,50],'51–100 salariés':[51,100]};
const digitalStates=['Site web existant','Aucun site identifié','Site inaccessible','Site à améliorer','Présence digitale inconnue'];
const priorities=['Maintenance mensuelle','SEO','Site à moderniser','Automatisation','Présence digitale','Croissance','Services récurrents'];

export function initDiscovery(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_runs(
      id TEXT PRIMARY KEY, criteria TEXT NOT NULL, state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '', source_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'Annuaire des Entreprises', requests INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS discovery_candidates(
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
      company TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'pending', verification TEXT NOT NULL DEFAULT '{}',
      audit TEXT, audit_at TEXT, review TEXT NOT NULL DEFAULT '[]', reviewed_matches TEXT NOT NULL DEFAULT '[]', imported_id TEXT REFERENCES companies(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS discovery_candidates_run ON discovery_candidates(run_id);
    CREATE TABLE IF NOT EXISTS discovery_usage(kind TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS discovery_usage_date ON discovery_usage(kind,created_at);
  `);
}
export function discoveryCriteria(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Critères invalides.');
  const list=(key,values)=>{
    const selection=raw[key]??[];
    if(!Array.isArray(selection)||selection.length>values.length||selection.some(value=>!values.includes(value)))fail('Filtre invalide : '+key);
    return [...new Set(selection)];
  };
  const location=raw.location??'all';
  if(!['all','region','department','city','postal'].includes(location))fail('Localisation invalide.');
  const area=location==='all'?'':text(raw.area,100);
  const formats={region:/^\d{2}$/,department:/^(?:\d{2}|2[AB]|97[1-8]|98[46789])$/,postal:/^\d{5}$/,city:/^[\p{L}\p{M}\d .’'-]{2,100}$/u};
  if(location!=='all'&&!formats[location].test(area))fail('Précisez le code ou le nom demandé pour la localisation.');
  const limit=raw.limit??10;
  if(!Number.isInteger(limit)||limit<1||limit>25)fail('Choisissez entre 1 et 25 entreprises.');
  if(raw.query!==undefined&&(typeof raw.query!=='string'||raw.query.length>100))fail('Mot-clé invalide.');
  return {location,area,limit,query:text(raw.query,100),sectors:list('sectors',Object.keys(sectors)),
    sizes:list('sizes',[...Object.keys(sizes),'Taille inconnue']),digital:list('digital',digitalStates),priorities:list('priorities',priorities)};
}
function matchesSize(range,selection){
  if(!selection.length)return true;
  if(!range)return true; // The registry often omits the workforce.
  return selection.some(label=>sizes[label]&&range[0]<=sizes[label][1]&&range[1]>=sizes[label][0]);
}
function establishmentDepartment(establishment){
  if(establishment.departement)return establishment.departement;
  // The official formatter removes departement from matching_etablissements.
  const commune=text(establishment.commune,5).toUpperCase();
  if(/^2[AB]\d{3}$/.test(commune))return commune.slice(0,2);
  if(/^\d{5}$/.test(commune))return commune.slice(0,/^(97|98)/.test(commune)?3:2);
  const postal=text(establishment.code_postal,5);
  if(/^\d{5}$/.test(postal)&&!postal.startsWith('20'))return postal.slice(0,/^(97|98)/.test(postal)?3:2);
  return '';
}
function matchesLocation(establishment,{location,area}){
  if(location==='all')return true;
  if(location==='department')return normalize(establishmentDepartment(establishment))===normalize(area);
  if(location==='city'){
    const city=normalize(establishment.libelle_commune);
    const requested=normalize(area);
    if(city===requested)return true;
    return ['paris','lyon','marseille'].includes(requested)&&
      new RegExp('^'+requested+'[0-9]{1,2}(?:er|e|eme)?arrondissement$').test(city);
  }
  return normalize(establishment[location==='region'?'region':'code_postal'])===normalize(area);
}
const publicEstablishment=establishment=>establishment?.etat_administratif==='A'&&
  !['P','N'].includes(establishment.statut_diffusion_etablissement??establishment.statut_diffusion);

function registryCompany(row,criteria){
  if(row?.etat_administratif!=='A'||['P','N'].includes(row.statut_diffusion)||row.opposition_diffusion_commerciale===true)return null;
  const seat=row.siege||{};
  const matched=Array.isArray(row.matching_etablissements)?row.matching_etablissements:[];
  const address=[seat,...matched].find(e=>publicEstablishment(e)&&matchesLocation(e,criteria));
  if(!address)return null;
  const identity={siren:text(row.siren,20),siret:text(address.siret,20)};
  if(!identity.siren)return null;
  try{validateFrenchCompanyIds(identity);}catch{return null;}
  const sole=String(row.nature_juridique||'').startsWith('1');
  const tradeName=text(address.nom_commercial||seat.nom_commercial||(Array.isArray(address.liste_enseignes)?address.liste_enseignes[0]:''),250);
  const legalName=sole?'':text(row.nom_raison_sociale||row.nom_complet);
  const name=tradeName||legalName;
  if(!name)return null;
  const naf=text(row.activite_principale,12);
  const division=Number(naf.slice(0,2));
  const section=text(row.section_activite_principale,1)||sectionRanges.find(([,a,b])=>division>=a&&division<=b)?.[0];
  const categories=Object.keys(sectors).filter(key=>sectors[key].includes(section)||sectors[key].includes(naf.slice(0,2)));
  const range=workforce[row.tranche_effectif_salarie];
  if(criteria.sectors.length&&!criteria.sectors.some(key=>categories.includes(key)))return null;
  if(!matchesSize(range,criteria.sizes))return null;
  const companySize=range?(Number.isFinite(range[1])?range.join('–'):'10000 et plus'):'';
  return {...identity,name,legal_name:legalName,industry:categories.join(' / '),naf_code:naf,company_size:companySize,
    company_status:'Active',country:'France',address:sole?'':text(address.adresse,450),postal_code:text(address.code_postal,5),
    city:text(address.libelle_commune),region:text(address.region,2),source,
    source_url:'https://annuaire-entreprises.data.gouv.fr/entreprise/'+identity.siren,collected_at:date()};
}
async function readRegistry(response){
  if(response.status===429)fail('Quota de la source officielle atteint. Réessayez plus tard.',429);
  if(!response.ok||!response.body)fail('Source officielle indisponible.',502);
  const reader=response.body.getReader(), chunks=[];
  let length=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>2_000_000)fail('Réponse de la source trop volumineuse.',502);
      chunks.push(Buffer.from(value));
    }
    const payload=parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(payload.results))fail('Réponse de la source non reconnue.',502);
    return payload;
  }finally{await reader.cancel().catch(()=>{});}
}
function registryUrl(criteria,page){
  const url=new URL(endpoint);
  url.search=new URLSearchParams({etat_administratif:'A',per_page:'25',page:String(page),minimal:'true',include:'siege,matching_etablissements'});
  const geo={region:'region',department:'departement',postal:'code_postal'}[criteria.location];
  if(geo)url.searchParams.set(geo,criteria.area);
  const query=criteria.query||(criteria.location==='city'?criteria.area:'');
  if(query)url.searchParams.set('q',query);
  const sections=[...new Set(criteria.sectors.flatMap(key=>sectors[key]).filter(value=>value.length===1))];
  if(sections.length&&criteria.sectors.every(key=>sectors[key].every(value=>value.length===1)))url.searchParams.set('section_activite_principale',sections.join(','));
  return url.href;
}
function domain(value){
  try{return siteUrl(value).hostname.replace(/^www\./,'');}catch{return '';}
}
function publicSite(value){
  const url=siteUrl(value);
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if((isIP(host)&&!publicAddress(host))||(!isIP(host)&&(!host.includes('.')||/\.(localhost|local|internal|home|test|invalid)$/i.test(host))))fail('Adresse de site non publique.');
  url.search='';
  return url.href;
}
function legalPage(page,homepage){
  const $=load(page.html||'');
  for(const element of $('a[href]').toArray().slice(0,150)){
    const href=$(element).attr('href');
    if(!/mentions[-_ /]*legales|mentions légales|legal[-_ /]*notice/i.test(href+' '+$(element).text()))continue;
    try{
      const target=new URL(href,homepage);
      if(target.origin===new URL(homepage).origin&&target.href!==homepage)return publicSite(target.href);
    }catch{ /* Ignore unsupported links. */ }
  }
  return '';
}
function generalChannels(page,website){
  const $=load(page.html||'');
  const result={};
  for(const element of $('a[href]').toArray().slice(0,150)){
    const link=$(element), href=link.attr('href')||'';
    const email=href.match(/^mailto:((?:contact|info|accueil|standard|bonjour|hello)@([a-z0-9.-]+))(?:\?.*)?$/i);
    if(!result.email&&email&&email[2].toLowerCase()===domain(website))result.email=email[1].toLowerCase();
    if(!result.phone&&href.startsWith('tel:')&&/standard|accueil|contact général/i.test(link.text()+' '+(link.attr('aria-label')||''))){
      const phone=href.slice(4).replace(/[ .()-]/g,'').replace(/^\+33/,'0');
      if(/^0[1-59]\d{8}$/.test(phone))result.phone=phone;
    }
  }
  return result;
}
function identityOnPage(page,company){
  if(page.status<200||page.status>=300||!/^text\/html|^application\/xhtml\+xml/i.test(page.contentType||''))return false;
  const $=load(page.html||'');
  $('script,style,template,noscript').remove();
  const visible=$('body').text();
  const pattern=company.siren.split('').join('[\\s.\\-]*');
  const siret=company.siret?company.siret.split('').join('[\\s.\\-]*'):pattern;
  return new RegExp('(?:^|[^0-9])(?:'+siret+'|'+pattern+')(?![\\s.\\-]*[0-9])').test(visible);
}
export class DiscoveryService {
  constructor({db,fetcher=fetch,inspect=inspectWebsite,digital,qualification,runner=runDigitalAudit}){
    Object.assign(this,{db,fetcher,inspect,digital,qualification,runner});
    this.searches=new Map();
    this.candidateJobs=new Set();
  }
  prune(){
    const limit=new Date(Date.now()-30*DAY).toISOString();
    this.db.prepare("UPDATE discovery_runs SET state='interrupted',finished_at=?,error='Recherche interrompue.' WHERE state='running' AND created_at<?").run(date(),new Date(Date.now()-120000).toISOString());
    this.db.prepare("DELETE FROM discovery_runs WHERE created_at<? AND state<>'running'").run(limit);
    this.db.prepare('DELETE FROM discovery_usage WHERE created_at<?').run(limit);
  }
  consume(kind,limit){
    const since=new Date(Date.now()-DAY).toISOString();
    transaction(this.db,()=>{
      if(this.db.prepare('SELECT COUNT(*) n FROM discovery_usage WHERE kind=? AND created_at>=?').get(kind,since).n>=limit)fail('Limite locale atteinte pour les dernières 24 heures.',429);
      this.db.prepare('INSERT INTO discovery_usage VALUES(?,?)').run(kind,date());
    });
  }
  start(raw){
    const criteria=discoveryCriteria(raw), id=randomUUID(), controller=new AbortController();
    this.prune();
    transaction(this.db,()=>{
      if(this.db.prepare("SELECT 1 FROM discovery_runs WHERE state='running'").get())fail('Une recherche est déjà en cours.',429);
      this.db.prepare("INSERT INTO discovery_runs(id,criteria,state,created_at) VALUES(?,?,'running',?)").run(id,JSON.stringify(criteria),date());
    });
    const work=this.search(id,criteria,controller.signal).finally(()=>this.searches.delete(id));
    this.searches.set(id,{controller,work});
    return {id,state:'running'};
  }
  async search(id,criteria,signal){
    const seen=new Set();
    try{
      for(let page=1;page<=4&&seen.size<criteria.limit;page++){
        if(signal.aborted)break;
        if(page>1)await delay(200,undefined,{signal});
        this.consume('registry',40);
        this.db.prepare('UPDATE discovery_runs SET requests=requests+1 WHERE id=?').run(id);
        const payload=await readRegistry(await this.fetcher(registryUrl(criteria,page),{
          signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error',headers:{Accept:'application/json'}
        }));
        if(signal.aborted||this.run(id).state!=='running')break;
        this.db.prepare('UPDATE discovery_runs SET source_count=source_count+? WHERE id=?').run(payload.results.length,id);
        const insert=this.db.prepare('INSERT INTO discovery_candidates(id,run_id,company) VALUES(?,?,?)');
        for(const row of payload.results){
          const company=registryCompany(row,criteria);
          if(!company||seen.has(company.siren))continue;
          insert.run(randomUUID(),id,JSON.stringify(company));
          seen.add(company.siren);
          if(seen.size===criteria.limit)break;
        }
        if(!payload.results.length||(Number.isInteger(payload.total_pages)?page>=payload.total_pages:payload.results.length<25))break;
      }
      this.finish(id,signal.aborted?'cancelled':'completed');
    }catch(error){
      this.finish(id,signal.aborted?'cancelled':'failed',signal.aborted?'':error instanceof DiscoveryError?error.message:'Recherche interrompue : source indisponible ou délai dépassé.');
    }
  }
  finish(id,state,error=''){
    this.db.prepare("UPDATE discovery_runs SET state=?,error=?,finished_at=? WHERE id=? AND state='running'").run(state,error,date(),id);
  }
  cancel(id){
    this.run(id);
    this.finish(id,'cancelled');
    this.searches.get(id)?.controller.abort();
    return {ok:true};
  }
  async close(){
    for(const [id] of this.searches)this.cancel(id);
    await Promise.allSettled([...this.searches.values()].map(job=>job.work));
  }
  run(id){
    const run=this.db.prepare('SELECT * FROM discovery_runs WHERE id=?').get(id);
    if(!run)fail('Recherche introuvable.',404);
    return {...run,criteria:parse(run.criteria)};
  }
  candidate(id){
    const row=this.db.prepare(`SELECT c.* FROM discovery_candidates c JOIN discovery_runs r ON r.id=c.run_id
      WHERE c.id=? AND r.created_at>=?`).get(id,new Date(Date.now()-30*DAY).toISOString());
    if(!row)fail('Prospect introuvable.',404);
    return {...row,company:parse(row.company),verification:parse(row.verification),audit:row.audit?parse(row.audit):null,review:parse(row.review),reviewed_matches:parse(row.reviewed_matches)};
  }
  companyRows(){
    return this.db.prepare(`SELECT id,name,legal_name,siren,siret,website,business_status,
      EXISTS(SELECT 1 FROM contacts WHERE company_id=companies.id AND (contact_status='Opposition' OR email_opt_out=1 OR phone_opt_out=1)) AS contact_opposed
      FROM companies`).all();
  }
  duplicates(company,verification,rows=this.companyRows()){
    const site=domain(verification.confirmed?verification.url:'');
    const nameKeys=new Set([company.name,company.legal_name].map(normalize).filter(Boolean));
    return rows.flatMap(row=>{
      const strong=Boolean((row.siren&&row.siren===company.siren)||(row.siret&&row.siret===company.siret)||(site&&domain(row.website)===site));
      const similar=[row.name,row.legal_name].some(name=>nameKeys.has(normalize(name)));
      return strong||similar?[{id:row.id,name:row.name,strong,opposed:row.business_status==='Opposition'||!!row.contact_opposed}]:[];
    });
  }
  opposed(company,duplicates){
    if(duplicates.some(row=>row.opposed)||[company.name,company.legal_name].some(name=>name&&suppressed(this.db,{company:name})))return true;
    const names=new Set([company.name,company.legal_name].map(normalize).filter(Boolean));
    return this.db.prepare("SELECT * FROM prospects WHERE status='Opposition' OR contact_permission='Opposition'").all().some(row=>
      ((row.siren&&row.siren===company.siren)||names.has(normalize(row.company)))&&(isOpposed(row)||suppressed(this.db,row)));
  }
  describe(row,companies){
    const {company,verification,audit,audit_at}=row;
    const duplicates=this.duplicates(company,verification,companies);
    const restricted=this.opposed(company,duplicates);
    const scores=computeQualification({
      company:{...company,updated_at:company.collected_at,website:verification.confirmed?verification.url:''},
      audit:audit?{id:row.id,created_at:audit_at,result:audit}:null,restricted,
      catalog:this.db.prepare('SELECT * FROM qualification_services').all()
    });
    const hasIssues=audit?.controls?.some(control=>['Erreur critique','Problème important'].includes(control.status));
    const digital=verification.status==='unreachable'?'Site inaccessible':verification.confirmed?(hasIssues?'Site à améliorer':'Site web existant'):
      verification.status==='unidentified'?'Aucun site identifié':'Présence digitale inconnue';
    const signals=row.review.map(item=>({...item,reason:'Indice saisi manuellement, à vérifier : '+item.reason}));
    if(verification.confirmed)signals.push({label:'Maintenance mensuelle',reason:'Site confirmé. Besoin et contrat de maintenance à vérifier.'},
      {label:'Services récurrents',reason:'Suivi du site envisageable. Aucun abonnement confirmé.'});
    if(scores.services.some(item=>item.code==='seo'))signals.push({label:'SEO',reason:'Contrôles SEO documentés dans l’audit.'});
    if(hasIssues)signals.push({label:'Site à moderniser',reason:'Points d’amélioration observés. L’ancienneté du site reste inconnue.'});
    if(digital==='Aucun site identifié'||digital==='Site inaccessible')signals.push({label:'Présence digitale',reason:'Disponibilité ou présence du site à vérifier.'});
    return {...row,audit:audit?{state:audit.execution_status,conclusions:audit.conclusions||[],controls:audit.controls||[]}:null,
      duplicates,restricted,scores,digital,signals};
  }
  view(id){
    this.prune();
    const run=this.run(id);
    const companies=this.companyRows();
    const results=this.db.prepare('SELECT id FROM discovery_candidates WHERE run_id=?').all(id).map(({id})=>this.describe(this.candidate(id),companies));
    const count=fn=>results.filter(fn).length;
    const stats={found:results.length,verified:count(row=>row.verification.confirmed),duplicates:count(row=>row.duplicates.length&&!row.imported_id),
      approved:count(row=>row.decision==='approved'||row.decision==='imported'),rejected:count(row=>row.decision==='rejected'),imported:count(row=>row.decision==='imported')};
    const preferred=row=>row.signals.filter(signal=>run.criteria.priorities.includes(signal.label)).length;
    results.sort((a,b)=>preferred(b)-preferred(a)||(b.scores.fit.score??-1)-(a.scores.fit.score??-1));
    return {...run,results,stats};
  }
  history(){
    this.prune();
    const runs=this.db.prepare(`SELECT r.*,COUNT(c.id) found,
      COUNT(CASE WHEN c.decision='rejected' THEN 1 END) rejected,
      COUNT(CASE WHEN c.decision IN ('approved','imported') THEN 1 END) approved,
      COUNT(CASE WHEN c.decision='imported' THEN 1 END) imported,
      COUNT(CASE WHEN json_extract(c.verification,'$.confirmed')=1 THEN 1 END) verified
      FROM discovery_runs r LEFT JOIN discovery_candidates c ON c.run_id=r.id
      GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50`).all();
    const companies=this.companyRows();
    const candidates=this.db.prepare("SELECT company,verification FROM discovery_candidates WHERE run_id=? AND decision<>'imported'");
    return runs.map(row=>({...row,criteria:parse(row.criteria),duplicates:candidates.all(row.id).filter(c=>
      this.duplicates(parse(c.company),parse(c.verification),companies).length).length}));

  }
  decision(id,raw){
    const row=this.candidate(id);
    if(row.decision==='imported'||this.candidateJobs.has(id))fail('Fiche importée ou opération en cours.',409);
    if(!['approved','rejected','deferred','pending'].includes(raw?.decision))fail('Décision invalide.');
    const matches=this.duplicates(row.company,row.verification);
    if(raw.decision==='approved'&&(this.opposed(row.company,matches)||matches.some(item=>item.strong)))fail('Import bloqué : doublon ou opposition.',409);
    if(raw.decision==='approved'&&matches.length&&raw.reviewed!==true)fail('Confirmez la revue du nom similaire.',409);
    this.db.prepare('UPDATE discovery_candidates SET decision=?,reviewed_matches=? WHERE id=?').run(raw.decision,JSON.stringify(matches.map(item=>item.id)),id);
    return {ok:true};
  }
  reviewSignal(id,raw){
    const row=this.candidate(id);
    if(row.decision==='imported'||this.candidateJobs.has(id))fail('Fiche importée ou opération en cours.',409);
    const reason=text(raw?.reason,500);
    if(!priorities.includes(raw?.label)||reason.length<10)fail('Indiquez un indice documenté et sa source.');
    const url=publicSite(raw?.url);
    const review=[...row.review.filter(item=>item.label!==raw.label),{label:raw.label,reason,url,observed_at:date()}];
    this.db.prepare("UPDATE discovery_candidates SET review=?,decision='pending' WHERE id=?").run(JSON.stringify(review),id);
    return {ok:true};
  }
  async verify(id,raw){
    const row=this.candidate(id);
    if(row.decision==='imported')fail('Fiche déjà importée.',409);
    const value=raw?.url;
    if(typeof value!=='string')fail('Adresse de site invalide.');
    if(this.candidateJobs.size)fail('Une vérification ou un audit est déjà en cours.',429);
    this.candidateJobs.add(id);
    try{
      let verification={status:'unidentified',confirmed:false,checked_at:date()};
      if(value.trim()){
        const url=publicSite(value);
        if(row.verification.requested===url&&Date.now()-Date.parse(row.verification.checked_at)<DAY)return row.verification;
        this.consume('website',20);
        verification={...verification,requested:url,status:'unreachable'};
        let page;
        const deadline=Date.now()+8000,budget={remaining:5};
        try{page=await this.inspect(url,{deadline,budget});}catch(error){
          if(error?.status===400&&/locales|privées|réservées|non autorisée/.test(error.message))throw error;
        }
        if(page){
          const homepage=publicSite(page.url);
          let proof=identityOnPage(page,row.company)?homepage:'';
          if(!proof&&page.status>=200&&page.status<300&&/html/i.test(page.contentType||'')){
            const legal=legalPage(page,homepage);
            if(legal){
              try{
                const candidate=await this.inspect(legal,{deadline,budget});
                if(domain(candidate.url)===domain(homepage)&&identityOnPage(candidate,row.company))proof=publicSite(candidate.url);
              }catch(error){
                if(error?.status===400&&/locales|privées|réservées|non autorisée/.test(error.message))throw error;
              }
            }
          }
          const confirmed=!!proof;
          verification={...verification,status:confirmed?'confirmed':page.status>=200&&page.status<300?'unconfirmed':'unreachable',
            confirmed,url:homepage,proof_url:proof,http_status:page.status,channels:confirmed?generalChannels(page,homepage):{},
            evidence:confirmed?'SIREN ou SIRET trouvé dans le texte public de la page.':'Correspondance de l’entreprise non établie sur cette page.'};
        }
      }
      this.db.prepare("UPDATE discovery_candidates SET verification=?,audit=NULL,audit_at=NULL,decision='pending' WHERE id=?").run(JSON.stringify(verification),id);
      return verification;
    }finally{this.candidateJobs.delete(id);}
  }
  async audit(id){
    const row=this.candidate(id);
    if(!row.verification.confirmed||row.decision==='imported')fail('Vérifiez d’abord le site de ce prospect.');
    if(row.audit&&Date.now()-Date.parse(row.audit_at)<7*DAY)return {cached:true};
    if(this.candidateJobs.size)fail('Une vérification ou un audit est déjà en cours.',429);
    this.candidateJobs.add(id);
    try{
      const result=await this.digital.legacyAudit(()=>{
        this.consume('audit',5);
        return this.runner(row.verification.url,{inspect:this.inspect,fetcher:this.fetcher});
      });
      if(result?.engine_version!==3||domain(result.url)!==domain(row.verification.url))fail('Audit non attribuable au domaine vérifié.',502);
      this.db.prepare("UPDATE discovery_candidates SET audit=?,audit_at=?,decision='pending' WHERE id=?").run(JSON.stringify(result),date(),id);
      return {cached:false,state:result.execution_status};
    }finally{this.candidateJobs.delete(id);}
  }
  import(ids){
    if(!Array.isArray(ids)||!ids.length||ids.length>25||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail('Sélection invalide.');
    return transaction(this.db,()=>({imported:ids.map(id=>{
      const row=this.candidate(id);
      if(row.decision==='imported'&&row.imported_id)return {id,company_id:row.imported_id};
      if(this.candidateJobs.has(id)||row.decision!=='approved')fail('Approuvez chaque prospect avant l’import.',409);
      const matches=this.duplicates(row.company,row.verification);
      if(this.opposed(row.company,matches)||matches.some(item=>item.strong))fail('Import bloqué : doublon ou opposition.',409);
      if(matches.some(item=>!row.reviewed_matches.includes(item.id)))fail('Une nouvelle correspondance doit être revue avant l’import.',409);
      const website=row.verification.confirmed?row.verification.url:'';
      const channels={...row.verification.channels};
      for(const kind of ['email','phone']){
        if(channels[kind]&&(suppressed(this.db,{[kind]:channels[kind]})||restrictedIdentity(this.db,{[kind]:channels[kind]})))delete channels[kind];
      }
      const data={...row.company,website,general_email:channels.email||'',general_phone:channels.phone||'',information_status:'À vérifier',
        verification_notes:'Identité et activité : '+row.company.source_url+' ('+row.company.collected_at+'). '+
          (website?'Site : '+website+' ('+row.verification.checked_at+'), '+row.verification.evidence+' '+row.verification.proof_url:'Site à vérifier.')+
          (channels.email||channels.phone?' Coordonnées générales publiées sur '+website+'.':'')+
          row.review.map(item=>'\nIndice à vérifier — '+item.label+' : '+item.reason+' ('+item.url+', '+item.observed_at+').').join('')};
      const saved=saveCompany(this.db,data);
      if(row.audit&&website){
        const auditId=randomUUID();
        this.db.prepare('INSERT INTO audits VALUES(?,?,?,?,?,?)').run(auditId,saved.id,null,JSON.stringify(row.audit),'Recherche de prospects · moteur digital v3',row.audit_at);
        this.db.prepare('UPDATE companies SET audit_status=?,last_audit_at=?,audit_summary=? WHERE id=?')
          .run(row.audit.execution_status==='failed'?'Échec de lecture':'Réalisé - contrôles indicatifs',row.audit_at,(row.audit.conclusions||[]).join('\n'),saved.id);
      }
      this.db.prepare("UPDATE discovery_candidates SET decision='imported',imported_id=? WHERE id=?").run(saved.id,id);
      return {id,company_id:saved.id};
    })}));
  }
}
export function mountDiscovery(app,service){
  const base='/api/discovery';
  app.get(base+'/runs',(req,res)=>res.json({runs:service.history(),sectors:Object.keys(sectors),sizes:[...Object.keys(sizes),'Taille inconnue'],digital:digitalStates,priorities,gemini:!!service.qualification?.status().configured}));
  app.post(base+'/runs',(req,res)=>res.status(202).json(service.start(req.body)));
  app.get(base+'/runs/:id',(req,res)=>res.json(service.view(req.params.id)));
  app.post(base+'/runs/:id/cancel',(req,res)=>res.json(service.cancel(req.params.id)));
  app.post(base+'/candidates/:id/decision',(req,res)=>res.json(service.decision(req.params.id,req.body)));
  app.post(base+'/candidates/:id/signal',(req,res)=>res.json(service.reviewSignal(req.params.id,req.body)));
  app.post(base+'/candidates/:id/verify',async(req,res)=>res.json(await service.verify(req.params.id,req.body)));
  app.post(base+'/candidates/:id/audit',async(req,res)=>res.json(await service.audit(req.params.id)));
  app.post(base+'/import',(req,res)=>res.status(201).json(service.import(req.body?.ids)));
}
