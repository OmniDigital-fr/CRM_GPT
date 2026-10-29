import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXTRA_FIELDS = ['contact_name','job_title','phone','mobile','address','address2','postal_code','city','country','siren','industry','source','source_date','priority','next_followup','needs','services'];
const FIELDS = ['company','email','website','notes',...EXTRA_FIELDS];
const STATUSES = ['Nouveau','Qualifié','Contacté','Gagné','Perdu','Opposition'];
const inside = (root,path) => { const rel=relative(root,path); return rel==='' || (rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel)); };
const now = () => new Date().toISOString();
class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const normalized = value => String(value || '').normalize('NFKD').toLowerCase().replace(/ß/g,'ss').replace(/[^\p{L}\p{N}]/gu,'');
const emailKey = value => String(value || '').trim().toLowerCase();

export function validateConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const user = env.CRM_AUTH_USER || '';
  const password = env.CRM_AUTH_PASSWORD || '';
  if ((user && !password) || (!user && password)) throw new Error('Configurez ensemble CRM_AUTH_USER et CRM_AUTH_PASSWORD.');
  if (user.includes(':')) throw new Error('CRM_AUTH_USER ne doit pas contenir « : ».');
  if (production && (!user || password.length < 16)) throw new Error('En production, configurez CRM_AUTH_USER et CRM_AUTH_PASSWORD (16 caractères minimum).');
  if (production && (!env.CRM_DATA_DIR || !isAbsolute(env.CRM_DATA_DIR))) throw new Error('CRM_DATA_DIR doit être un chemin absolu vers un dossier persistant hors du répertoire de déploiement.');
  const dataDir = resolve(env.CRM_DATA_DIR || resolve(ROOT,'.data'));
  if (production) {
    let url;
    try { url = new URL(env.CRM_PUBLIC_URL); } catch { throw new Error('Configurez CRM_PUBLIC_URL avec l’adresse HTTPS du CRM.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CRM_PUBLIC_URL doit être une origine HTTPS, sans chemin.');
    if (inside(ROOT,dataDir)) throw new Error('Le dossier de données doit rester hors du répertoire de déploiement pour survivre aux mises à jour.');
  }
  return { production, user, password, dataDir, publicUrl:env.CRM_PUBLIC_URL || '', pagespeedKey:env.PAGESPEED_API_KEY || '' };
}

export function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS prospects(id TEXT PRIMARY KEY, company TEXT NOT NULL, email TEXT, website TEXT, status TEXT NOT NULL DEFAULT 'Nouveau', notes TEXT DEFAULT '', pdf_text TEXT DEFAULT '', audit TEXT DEFAULT '{}', created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES prospects(id), subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Brouillon', created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), kind TEXT NOT NULL, created TEXT NOT NULL);`);
  const columns = new Set(db.prepare('PRAGMA table_info(prospects)').all().map(c=>c.name));
  for (const field of EXTRA_FIELDS) if (!columns.has(field)) db.exec(`ALTER TABLE prospects ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
  return db;
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function matchingContact(db, company, email, exclude = null) {
  const name = normalized(company), mail = emailKey(email);
  return db.prepare('SELECT id,company,email FROM prospects ORDER BY created,id').all().find(p=>p.id!==exclude && ((name && normalized(p.company)===name) || (mail && emailKey(p.email)===mail)));
}
function valuesFor(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('Fiche de contact invalide.');
  const values = Object.fromEntries(FIELDS.map(f=>[f,String(data[f] ?? '').trim()]));
  if (!values.company) throw new InputError('Le nom de l’entreprise est requis.');
  if (Object.values(values).some(v=>v.length>20000)) throw new InputError('Un champ dépasse la taille maximale.');
  if (values.email && !/^[^\s@]+@[^\s@]+$/.test(values.email)) throw new InputError('Adresse email invalide.');
  if (values.website) {
    try { const url = new URL(values.website); if (!['http:','https:'].includes(url.protocol)) throw Error(); }
    catch { throw new InputError('Le site doit commencer par https:// ou http://.'); }
  }
  if (!['','Faible','Moyenne','Haute'].includes(values.priority)) throw new InputError('Priorité invalide.');
  for (const f of ['source_date','next_followup']) if (values[f] && (!/^\d{4}-\d{2}-\d{2}$/.test(values[f]) || !Number.isFinite(Date.parse(values[f])) || new Date(values[f]).toISOString().slice(0,10)!==values[f])) throw new InputError('Date invalide : '+f);
  return values;
}
function saveContact(db, data, id = null) {
  const values = valuesFor(data);
  const existing = matchingContact(db,values.company,values.email,id);
  if (existing) throw new InputError(`Doublon détecté : une fiche « ${existing.company} » existe déjà avec ce nom d’entreprise ou cet email. Modifiez la fiche existante.`,409);
  if (id) db.prepare(`UPDATE prospects SET ${FIELDS.map(f=>f+'=?').join(',')} WHERE id=?`).run(...FIELDS.map(f=>values[f]),id);
  else {
    id = randomUUID().replaceAll('-','');
    db.prepare(`INSERT INTO prospects(id,${FIELDS.join(',')},created) VALUES(${Array(FIELDS.length+2).fill('?').join(',')})`).run(id,...FIELDS.map(f=>values[f]),now());
  }
  return id;
}
function duplicateGroups(prospects) {
  const groups = new Map();
  for (const p of prospects) for (const [field,key] of [['company',normalized(p.company)],['email',emailKey(p.email)]]) {
    if (!key) continue;
    const groupKey = field+':'+key;
    if (!groups.has(groupKey)) groups.set(groupKey,{field,ids:[]});
    groups.get(groupKey).ids.push(p.id);
  }
  return [...groups.values()].filter(g=>g.ids.length>1);
}
function draft(p) {
  const scores = JSON.parse(p.audit || '{}').scores || {}, findings = [];
  if ((scores.performance ?? 100)<70) findings.push('la vitesse de chargement de votre site');
  if ((scores.seo ?? 100)<80) findings.push('la visibilité technique de votre site sur les moteurs de recherche');
  if ((scores.accessibility ?? 100)<80) findings.push('l’accessibilité de votre parcours en ligne');
  const evidence = [p.needs,p.services,p.notes,(p.pdf_text || '').slice(0,6000)].filter(Boolean).join('\n');
  let body = `Bonjour,\n\nJe vous contacte au nom d’OmniDigital au sujet de ${p.company}. Nous accompagnons les entreprises dans la création de sites web et leur marketing digital.\n\n`;
  body += findings.length ? `Une analyse automatisée de votre site suggère des pistes concernant ${findings.join(', ')}. Ces résultats méritent une vérification avec votre contexte métier.\n\n` : 'Nous souhaitons échanger avec vous sur les possibilités d’amélioration de votre présence en ligne, en fonction de vos priorités.\n\n';
  if (evidence) body += `Éléments du dossier à vérifier et reformuler avant envoi :\n${evidence.slice(0,1200)}\n\n`;
  body += 'Seriez-vous disponible pour un échange de 15 minutes afin d’identifier les actions les plus utiles pour votre activité ?\n\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus être contacté, répondez simplement « stop ».';
  return {subject:`${p.company} — pistes pour votre présence digitale`, body};
}

export async function extractPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0,5).toString()!=='%PDF-') throw new InputError('Un fichier PDF est requis.');
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
  let text = '';
  try {
    const pdf = await task.promise;
    if (pdf.numPages>100) throw new InputError('Le PDF dépasse 100 pages.');
    for (let i=1;i<=pdf.numPages && text.length<100000;i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Keep PDF columns separated for the OmniDigital field extractor.
      let lineY = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = Math.round(item.transform[5]);
        if (lineY!==null && Math.abs(y-lineY)>3) text+='\n';
        text+=item.str+'  '; lineY=y;
        if (item.hasEOL) { text+='\n'; lineY=null; }
      }
      text+='\n'; page.cleanup();
    }
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError('Extraction PDF impossible. Vérifiez que le document est valide et non protégé.');
  } finally { await task.destroy(); }
  text=text.trim().slice(0,100000);
  if (!text) throw new InputError('PDF sans texte : OCR nécessaire pour ce document scanné.');
  return text;
}
function reportField(text,label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return text.match(new RegExp('^\\s*'+escaped+'\\s{2,}([^\\n]+)','m'))?.[1]?.trim() || '';
}
export function importText(db,text) {
  const company=reportField(text,'Nom'),email=reportField(text,'Email'),website=reportField(text,'Site web');
  if (!company) throw new InputError('Entreprise non identifiée. Créez le contact manuellement, puis importez le PDF dans sa fiche.');
  return transaction(db,()=>{
    const existing=matchingContact(db,company,email);
    if (existing) return {id:existing.id,created:false};
    const id=saveContact(db,{company,email,website,contact_name:reportField(text,'Dirigeant(e)'),phone:reportField(text,'Téléphone'),address:reportField(text,'Adresse'),siren:reportField(text,'SIREN'),notes:'Rapport PDF importé ; observations non revérifiées.\n'+(text.match(/Opportunité\s*:\s*([^\n]+)/)?.[0] || '')});
    db.prepare('UPDATE prospects SET pdf_text=? WHERE id=?').run(text.slice(0,100000),id);
    return {id,created:true};
  });
}
async function auditSite(p,key,fetcher) {
  if (!key) throw new InputError('Configurez PAGESPEED_API_KEY pour lancer une analyse Google.');
  if (!/^https?:\/\//i.test(p.website || '')) throw new InputError('URL du site invalide : utilisez https://.');
  const query = new URLSearchParams({url:p.website,strategy:'mobile',key});
  for (const category of ['performance','seo','accessibility','best-practices']) query.append('category',category);
  try {
    const response=await fetcher('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?'+query,{signal:AbortSignal.timeout(100000)});
    if (!response.ok) throw Error();
    const data=await response.json(),lighthouse=data.lighthouseResult;
    if (!lighthouse?.categories) throw Error();
    return {scores:Object.fromEntries(Object.entries(lighthouse.categories).filter(([,v])=>v.score!=null).map(([k,v])=>[k,Math.round(v.score*100)])),date:now(),url:p.website,strategy:'mobile',opportunities:Object.values(lighthouse.audits || {}).filter(v=>v.details?.type==='opportunity' && v.score!=null && v.score<1).map(v=>({title:v.title,description:v.description || ''}))};
  } catch { throw new InputError('Google PageSpeed indisponible : vérifiez la clé, les quotas et l’accès réseau.'); }
}
const digest = value => createHash('sha256').update(value).digest();
export function createApp({db,config,fetcher=fetch,parsePdf=extractPdf}) {
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    if (config.user) {
      let credentials='';
      if (req.headers.authorization?.startsWith('Basic ')) credentials=Buffer.from(req.headers.authorization.slice(6),'base64').toString('utf8');
      if (!timingSafeEqual(digest(credentials),digest(config.user+':'+config.password))) return res.status(401).set('WWW-Authenticate','Basic realm="OmniDigital CRM", charset="UTF-8"').json({error:'Authentification requise.'});
    }
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.headers.origin && config.publicUrl && req.headers.origin!==new URL(config.publicUrl).origin) return res.status(403).json({error:'Origine de la requête non autorisée.'});
      if (!req.is('application/json') && !req.is('application/pdf')) return res.status(415).json({error:'Utilisez JSON ou PDF.'});
    }
    next();
  });
  app.use(express.json({limit:'1mb'}));
  app.use(express.raw({type:'application/pdf',limit:'12mb'}));
  app.get('/api/state',(req,res)=>{
    const prospects=db.prepare('SELECT * FROM prospects ORDER BY created DESC').all();
    const messages=db.prepare('SELECT m.*,p.company FROM messages m JOIN prospects p ON p.id=m.prospect_id ORDER BY m.created DESC').all();
    const counts=Object.fromEntries(db.prepare('SELECT kind,COUNT(DISTINCT message_id) AS n FROM events GROUP BY kind').all().map(x=>[x.kind,x.n]));
    res.json({prospects,messages,duplicate_groups:duplicateGroups(prospects),metrics:{sent:messages.filter(m=>m.status==='Envoyé').length,opened:counts.open || 0,clicked:counts.click || 0,replied:counts.reply || 0},integrations:{pagespeed:!!config.pagespeedKey,email:false}});
  });
  app.post('/api/prospects',(req,res)=>res.status(201).json({id:transaction(db,()=>saveContact(db,req.body))}));
  app.post('/api/import-pdf',async(req,res)=>{
    const result=importText(db,await parsePdf(req.body));res.status(result.created?201:200).json(result);
  });
  app.post('/api/prospects/:id/:action',async(req,res)=>{
    const {id,action}=req.params;
    const p=db.prepare('SELECT * FROM prospects WHERE id=?').get(id);
    if (!p) throw new InputError('Prospect introuvable.',404);
    if (action==='pdf') {
      const text=await parsePdf(req.body);
      const result=db.prepare('UPDATE prospects SET pdf_text=? WHERE id=?').run(text,id);
      if (!result.changes) throw new InputError('Prospect introuvable.',404);
      return res.json({ok:true,characters:text.length});
    }
    if (action==='audit') {
      const audit=await auditSite(p,config.pagespeedKey,fetcher);
      if (!db.prepare('UPDATE prospects SET audit=? WHERE id=?').run(JSON.stringify(audit),id).changes) throw new InputError('Prospect introuvable.',404);
      return res.json({ok:true});
    }
    transaction(db,()=>{
      if (action==='update') saveContact(db,req.body,id);
      else if (action==='status') {
        if (!STATUSES.includes(req.body?.status)) throw new InputError('Statut invalide.');
        db.prepare('UPDATE prospects SET status=? WHERE id=?').run(req.body.status,id);
      } else if (action==='draft') {
        if (p.status==='Opposition') throw new InputError('Ce prospect s’oppose aux sollicitations.');
        const {subject,body}=draft(p);
        db.prepare('INSERT INTO messages(id,prospect_id,subject,body,created) VALUES(?,?,?,?,?)').run(randomUUID().replaceAll('-',''),id,subject,body,now());
      } else if (action==='delete') {
        if (req.body?.confirm!==id) throw new InputError('Confirmation de suppression requise.');
        db.prepare('DELETE FROM events WHERE message_id IN (SELECT id FROM messages WHERE prospect_id=?)').run(id);
        db.prepare('DELETE FROM messages WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM prospects WHERE id=?').run(id);
      } else throw new InputError('Action inconnue.',404);
    });
    res.json({ok:true});
  });
  for (const [route,file] of Object.entries({'/':'index.html','/app.js':'app.js','/dashboard.js':'dashboard.js','/style.css':'style.css'})) app.get(route,(req,res)=>res.sendFile(resolve(ROOT,'static',file)));
  app.use((req,res)=>res.status(404).json({error:'Introuvable'}));
  app.use((error,req,res,next)=>{
    const status=error.status || (error.type==='entity.too.large'?413:500);
    res.status(status).json({error:error instanceof InputError?error.message:status===413?'Fichier trop volumineux.':status===400?'Requête invalide.':'Erreur interne. Consultez la configuration du serveur.'});
  });
  return app;
}

export function startServer() {
  try {
    const config=validateConfig();
    mkdirSync(config.dataDir,{recursive:true,mode:0o700});
    if (config.production) {
      if (inside(realpathSync(ROOT),realpathSync(config.dataDir))) throw new Error('Le dossier persistant ne doit pas pointer dans le déploiement.');
    }
    const db=openDatabase(resolve(config.dataDir,'crm.sqlite3'));
    const server=createApp({db,config}).listen(Number(process.env.PORT || 8000),config.production?'0.0.0.0':'127.0.0.1',()=>console.log('OmniDigital CRM — serveur Node.js démarré. port='+server.address().port));
    const stop=()=>server.close(()=>{db.close();process.exit(0)});
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
