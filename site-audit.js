import {lookup} from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import {isIP} from 'node:net';
import ipaddr from 'ipaddr.js';
import {load} from 'cheerio';

export class AuditError extends Error { constructor(message,status=400){super(message);this.status=status} }
export function siteUrl(value){
  let url;
  try{url=new URL(String(value||'').trim())}catch{throw new AuditError('Indiquez une URL complète, par exemple https://example.fr.')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new AuditError('Utilisez un site public HTTP/HTTPS sans identifiants ni port personnalisé.');
  url.hash='';return url;
}
export function publicAddress(address){
  try{let ip=ipaddr.parse(address);if(ip.kind()==='ipv6'&&ip.isIPv4MappedAddress())ip=ip.toIPv4Address();return ip.range()==='unicast'}catch{return false}
}
export async function resolvePublic(hostname,resolver=lookup){
  const host=hostname.replace(/^\[|\]$/g,'');
  let addresses;
  try{addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true})}catch{throw new AuditError('Le nom de domaine ne peut pas être résolu.')}
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new AuditError('Les adresses locales, privées et réservées ne peuvent pas être auditées.');
  return addresses[0];
}
async function requestPage(url,deadline){
  const address=await resolvePublic(url.hostname);
  return new Promise((resolve,reject)=>{
    const start=performance.now(),remaining=deadline-Date.now();
    if(remaining<=0)return reject(new AuditError('Le site met trop de temps à répondre.'));
    const req=(url.protocol==='https:'?https:http).get(url,{
      headers:{'User-Agent':'OmniDigital-SiteAudit/1.0','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},
      lookup:(hostname,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family),
      agent:false,rejectUnauthorized:true
    },res=>{
      const status=res.statusCode,headers=res.headers,ttfbMs=Math.round(performance.now()-start);
      const peer=url.protocol==='https:'?res.socket.getPeerCertificate?.():null;
      const certificate=peer?.valid_to?{validTo:new Date(peer.valid_to).toISOString(),daysRemaining:Math.floor((Date.parse(peer.valid_to)-Date.now())/86400000)}:null;
      if(status>=300&&status<400&&headers.location){res.destroy();resolve({redirect:headers.location});return}
      if(headers['content-encoding']&&headers['content-encoding']!=='identity'){res.destroy();reject(new AuditError('Le site impose une réponse compressée non analysable.'));return}
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(new AuditError('La page dépasse la limite de lecture de 2 Mo.'))}else chunks.push(chunk)});
      res.on('end',()=>resolve({url:url.href,status,ttfbMs,bytes:size,certificate,html:Buffer.concat(chunks).toString('utf8'),contentType:headers['content-type']||''}));
      res.on('error',()=>reject(new AuditError('Lecture de la page interrompue.')));
    });
    const timer=setTimeout(()=>req.destroy(new Error('timeout')),remaining);
    req.on('close',()=>clearTimeout(timer));
    req.on('error',()=>reject(new AuditError('Impossible de joindre le site : délai dépassé, accès réseau ou certificat TLS à vérifier.')));
  });
}
export async function inspectWebsite(value){
  let url=siteUrl(value);const deadline=Date.now()+18000;
  for(let i=0;i<5;i++){
    const page=await requestPage(url,deadline);
    if(!page.redirect)return page;
    try{url=siteUrl(new URL(page.redirect,url).href)}catch{throw new AuditError('Redirection vers une adresse invalide ou non autorisée.')}
  }
  throw new AuditError('Trop de redirections pour analyser ce site.');
}
function schemaTypes(value,result=[]){
  if(!value||typeof value!=='object')return result;
  if(value['@type'])result.push(...[value['@type']].flat().filter(x=>typeof x==='string'));
  for(const child of Object.values(value))if(typeof child==='object')schemaTypes(child,result);
  return result;
}
export function analyzePage(page){
  const checks=[],argumentsList=[];
  const check=(key,label,state,value,detail,source='HTML de la page d’accueil')=>checks.push({key,label,state,value,detail,source});
  const argue=(title,service,severity,argument,evidence)=>argumentsList.push({title,service,severity,argument,evidence});
  const available=page.status>=200&&page.status<300&&/html/i.test(page.contentType);
  check('site','Site',available?'pass':'fail',available?'Accessible':`HTTP ${page.status}`,`${page.url} · ${Math.round(page.bytes/1024)} Ko de HTML`,'Requête HTTP');
  check('https','HTTPS',page.url.startsWith('https:')?'pass':'warning',page.url.startsWith('https:')?'Connexion chiffrée':'Connexion HTTP',page.certificate?`Certificat valide encore ${page.certificate.daysRemaining} jour(s), jusqu’au ${page.certificate.validTo.slice(0,10)}.`:'Expiration du certificat non disponible.','Connexion TLS vérifiée');
  check('response','Réponse du serveur','unknown',`${(page.ttfbMs/1000).toFixed(2)} s`,'Temps jusqu’au premier octet, vu depuis le serveur CRM. Ce n’est pas le chargement complet de la page.','Chronométrage HTTP');
  if(!available){
    for(const [key,label] of [['mobile','Adaptation mobile'],['cms','CMS / technologie'],['seo','SEO de base'],['schema','Données structurées locales'],['tracking','Mesure & publicité'],['conversion','Conversion'],['social','Réseaux sociaux']])check(key,label,'unknown','Non vérifiable','La page HTML n’a pas pu être inspectée.');
    argue('Page inaccessible à l’audit','Disponibilité','Haute','Vérifier l’accès au site et les éventuels blocages avant toute proposition technique.',`Réponse HTTP ${page.status}. Un blocage anti-robot peut expliquer ce résultat.`);
    return {checks,arguments:argumentsList};
  }
  const $=load(page.html),viewport=$('meta[name="viewport" i]').attr('content')||'';
  check('mobile','Adaptation mobile',viewport?'pass':'warning',viewport?'Viewport déclaré':'Viewport non détecté','Indice dans le HTML ; le rendu réel sur téléphone reste à vérifier.');
  if(!viewport)argue('Configuration mobile à vérifier','Webdesign / responsive','Moyenne','Vérifier et adapter l’affichage du site sur smartphone.','Aucune balise viewport détectée sur la page inspectée.');
  const generator=$('meta[name="generator" i]').attr('content')||'';
  const signals=[['WordPress',/wp-content|wp-includes/i],['Shopify',/cdn\.shopify\.com|Shopify\.theme/i],['Wix',/wixstatic\.com/i],['Webflow',/webflow\.com|data-wf-page/i],['Squarespace',/static\.squarespace\.com/i]];
  const cms=generator.slice(0,120)||signals.find(([,re])=>re.test(page.html))?.[0];
  check('cms','CMS / technologie',cms?'pass':'unknown',cms||'Non identifié',cms?'Signature détectée dans le HTML, à confirmer.':'Aucune signature reconnue ; cela ne signifie pas que le site n’utilise aucun CMS.');
  const title=$('title').first().text().trim(),description=$('meta[name="description" i]').attr('content')?.trim()||'',h1=$('h1').first().text().trim();
  const missing=[!title?'titre':null,!description?'description':null,!h1?'H1':null].filter(Boolean);
  check('seo','SEO de base',missing.length?'warning':'pass',missing.length?'Éléments manquants':'Titre, description et H1 présents',missing.length?`Non détecté : ${missing.join(', ')}.`:`Titre : ${title.slice(0,120)}. La présence des balises ne garantit pas leur qualité.`);
  if(missing.length)argue('Compléter les balises de référencement','SEO technique','Moyenne',`Travailler ${missing.join(', ')} pour clarifier la présentation de votre activité.`,`Éléments non détectés dans le HTML : ${missing.join(', ')}.`);
  let types=[];
  $('script[type="application/ld+json"]').each((i,e)=>{try{schemaTypes(JSON.parse($(e).text()),types)}catch{}});
  const local=types.filter(t=>/LocalBusiness|Electrician|Plumber|ProfessionalService|Store|Restaurant|Dentist|LegalService|HomeAndConstructionBusiness|AutoRepair|MedicalBusiness|RealEstateAgent|LodgingBusiness/i.test(t));
  check('schema','Données structurées locales',local.length?'pass':'warning',local.length?'Présentes':'Non détectées',local.length?`Types JSON-LD : ${[...new Set(local)].join(', ')}.`:'Contrôle JSON-LD uniquement ; microdonnées, scripts différés et autres types non couverts.');
  if(!local.length)argue('Balisage local à vérifier','SEO local','Faible','Vérifier le balisage de votre entreprise et compléter les données utiles à sa compréhension par les moteurs.','Aucun type local reconnu dans les blocs JSON-LD inspectés.');
  const analytics=/googletagmanager\.com|google-analytics\.com|gtag\(|GTM-[A-Z0-9]+|matomo|plausible\.io/i.test(page.html),meta=/connect\.facebook\.net|fbq\(/i.test(page.html);
  check('tracking','Mesure & publicité',analytics||meta?'pass':'unknown',[analytics?'Analytics / gestionnaire de tags':null,meta?'Pixel Meta':null].filter(Boolean).join(' · ')||'Non détectée','Présence de signatures uniquement : le fonctionnement, le consentement et les balises chargées plus tard ne sont pas vérifiés.');
  const form=$('form').length>0,phone=$('a[href^="tel:" i]').length>0,mail=$('a[href^="mailto:" i]').length>0;
  check('conversion','Conversion',form||phone||mail?'pass':'warning',[form?'formulaire':null,phone?'bouton d’appel':null,mail?'lien email':null].filter(Boolean).join(', ')||'Aucun point de contact détecté','Contrôle de la page d’accueil uniquement ; les pages Contact et les formulaires ne sont pas testés.');
  if(!form&&!phone&&!mail)argue('Faciliter la prise de contact','Conversion / demandes de devis','Moyenne','Vérifier le parcours de contact et rendre la demande de devis plus accessible.','Aucun formulaire, lien téléphonique ou lien email détecté dans le HTML de la page d’accueil.');
  const socials=new Set();
  $('a[href]').each((i,e)=>{try{const host=new URL($(e).attr('href'),page.url).hostname.toLowerCase();for(const [name,domain] of [['Facebook','facebook.com'],['Instagram','instagram.com'],['LinkedIn','linkedin.com'],['YouTube','youtube.com'],['TikTok','tiktok.com'],['X','x.com']])if(host===domain||host.endsWith('.'+domain))socials.add(name)}catch{}});
  check('social','Réseaux sociaux',socials.size?'pass':'warning',socials.size?[...socials].join(', '):'Aucun lien détecté','Liens visibles dans le HTML inspecté ; existence et activité des comptes non vérifiées.');
  if(!socials.size)argue('Valoriser les profils sociaux existants','Présence digitale','Faible','Vérifier si vos profils professionnels peuvent être mis en avant sur le site.','Aucun lien vers les principaux réseaux sociaux détecté sur la page inspectée.');
  if(!page.url.startsWith('https:'))argue('Sécuriser la connexion du site','HTTPS / maintenance','Haute','Mettre en place une connexion HTTPS et une redirection adaptée.','La page finale a été servie en HTTP.');
  return {checks,arguments:argumentsList};
}
export async function auditWebsite(value,{pagespeedKey='',fetcher=fetch,inspect=inspectWebsite}={}){
  const requested=siteUrl(value).href;
  const page=await inspect(requested),analysis=analyzePage(page);
  const result={...analysis,url:page.url,requestedUrl:requested,date:new Date().toISOString(),strategy:'mobile',scores:{},opportunities:[],pagespeed:{state:'unconfigured',message:'Ajoutez PAGESPEED_API_KEY pour mesurer les performances mobiles avec Google.'}};
  if(pagespeedKey){
    const query=new URLSearchParams({url:page.url,strategy:'mobile',key:pagespeedKey});
    for(const c of ['performance','seo','accessibility','best-practices'])query.append('category',c);
    try{
      const response=await fetcher('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?'+query,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error();
      const data=await response.json(),l=data.lighthouseResult;
      if(!l?.categories)throw Error();
      result.scores=Object.fromEntries(Object.entries(l.categories).filter(([,v])=>v.score!=null).map(([k,v])=>[k,Math.round(v.score*100)]));
      result.opportunities=Object.values(l.audits||{}).filter(v=>v.details?.type==='opportunity'&&v.score!=null&&v.score<1).map(v=>({title:v.title,description:v.description||''}));
      result.pagespeed={state:'available',message:'Analyse mobile Google Lighthouse / PageSpeed Insights.'};
      if((result.scores.performance??100)<70)result.arguments.unshift({title:'Améliorer les performances mobiles',service:'Performance web',severity:'Haute',argument:'Identifier les optimisations prioritaires pour améliorer l’expérience mobile.',evidence:`Score Lighthouse mobile : ${result.scores.performance}/100. Mesure de laboratoire, variable selon les conditions.`});
    }catch{result.pagespeed={state:'unavailable',message:'Google PageSpeed indisponible : clé, quotas, blocage réseau ou analyse du site à vérifier. Les contrôles HTML restent disponibles.'}}
  }
  const performance=result.scores.performance;
  result.checks.splice(3,0,{key:'performance',label:'Performance mobile',state:performance==null?'unknown':performance>=90?'pass':'warning',value:performance==null?'Non mesurée':`${performance}/100`,detail:result.pagespeed.message,source:'Google PageSpeed Insights'});
  result.checks.push({key:'reviews',label:'Avis Google',state:'unknown',value:'Non vérifiés',detail:'Aucune source Google Business / Places connectée. Aucun nombre d’avis n’est déduit du site.',source:'Service externe non connecté'});
  result.conclusions=result.arguments.slice(0,3).map(a=>a.title+' : '+a.evidence);
  return result;
}
