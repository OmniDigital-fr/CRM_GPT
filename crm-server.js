import {initOutreach,createSequence,registerReply,messageAction,stopOutreach} from './outreach.js';
import {CONTACT_STATUSES,POLICY_FIELDS,PolicyError,initPolicy,checkPolicyValues,isOpposed,suppressed,suppress,history,assertDraftAllowed,reconsent} from './contact-policy.js';
import {auditWebsite,AuditError,inspectWebsite} from './site-audit.js';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXTRA_FIELDS = ['contact_name','job_title','phone','mobile','address','address2','postal_code','city','country','siren','industry','source','source_date','priority','next_followup','needs','services',...POLICY_FIELDS];
const FIELDS = ['company','email','website','notes',...EXTRA_FIELDS];
const STATUSES = CONTACT_STATUSES;
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
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), kind TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS site_audits(id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL REFERENCES prospects(id),payload TEXT NOT NULL,created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_site_audits_prospect ON site_audits(prospect_id,created);`);
  const columns = new Set(db.prepare('PRAGMA table_info(prospects)').all().map(c=>c.name));
  for (const field of EXTRA_FIELDS) if (!columns.has(field)) db.exec(`ALTER TABLE prospects ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
  initOutreach(db);
  initPolicy(db);
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
  checkPolicyValues(values);
  if(data.status && !STATUSES.includes(data.status))throw new InputError('Statut invalide.');
  for (const f of ['source_date','next_followup','last_contact_date','last_response_date','opposition_date']) if (values[f] && (!/^\d{4}-\d{2}-\d{2}$/.test(values[f]) || !Number.isFinite(Date.parse(values[f])) || new Date(values[f]).toISOString().slice(0,10)!==values[f])) throw new InputError('Date invalide : '+f);
  return values;
}
function saveContact(db, data, id = null) {
  const values = valuesFor(data);
  const before=id?db.prepare('SELECT * FROM prospects WHERE id=?').get(id):null;
  if(before&&isOpposed(before)&&values.contact_permission!=='Opposition')throw new PolicyError('Opposition active. Utilisez « Nouvel accord documenté » pour modifier cette situation.');
  if((!before||!isOpposed(before))&&suppressed(db,values))throw new PolicyError('Contact en liste d’opposition : création ou réimportation bloquée.',409);
  const existing = matchingContact(db,values.company,values.email,id);
  if (existing) throw new InputError(`Doublon détecté : une fiche « ${existing.company} » existe déjà avec ce nom d’entreprise ou cet email. Modifiez la fiche existante.`,409);
  if (id) db.prepare(`UPDATE prospects SET ${FIELDS.map(f=>f+'=?').join(',')} WHERE id=?`).run(...FIELDS.map(f=>values[f]),id);
  else {
    id = randomUUID().replaceAll('-','');
    db.prepare(`INSERT INTO prospects(id,${FIELDS.join(',')},created) VALUES(${Array(FIELDS.length+2).fill('?').join(',')})`).run(id,...FIELDS.map(f=>values[f]),now());
  }
  if(data.status)db.prepare('UPDATE prospects SET status=? WHERE id=?').run(data.status,id);
  let saved=db.prepare('SELECT * FROM prospects WHERE id=?').get(id);
  if(saved.response_scenario==='Adresse email invalide / rebond')db.prepare("UPDATE prospects SET do_not_email='Oui' WHERE id=?").run(id);
  if(isOpposed(saved)||['Ne plus être contacté','Demande de suppression des données'].includes(saved.response_scenario))suppress(db,saved);
  else if(['Pas intéressé','Perdu'].includes(saved.status)){db.prepare("UPDATE prospects SET next_followup='' WHERE id=?").run(id);stopOutreach(db,id,'Refus commercial / dossier clôturé.');}
  if(before&&['company','email','contact_name'].some(k=>String(before[k]||'')!==String(values[k]||'')))db.prepare("UPDATE messages SET status='Brouillon',approved_at='',approved_recipient='' WHERE prospect_id=? AND status='Approuvé'").run(id);
  const changed=before?Object.keys(values).filter(k=>String(before[k]||'')!==values[k]):[];
  const scenario=saved.response_scenario?`Scénario : ${saved.response_scenario}. `:'';
  if(!before||changed.length||before.status!==saved.status)history(db,id,before?'Fiche mise à jour':'Contact créé',scenario+(saved.response_details||saved.permission_note||'')+(changed.length?' · Informations de la fiche mises à jour.':''));
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
  const latestAudit=JSON.parse(p.audit || '{}');
  const scores = latestAudit.scores || {}, findings = [];
  if ((scores.performance ?? 100)<70) findings.push('la vitesse de chargement de votre site');
  if ((scores.seo ?? 100)<80) findings.push('la visibilité technique de votre site sur les moteurs de recherche');
  if ((scores.accessibility ?? 100)<80) findings.push('l’accessibilité de votre parcours en ligne');
  const evidence = [p.needs,p.services,p.response_scenario,p.response_details,p.objection,...(latestAudit.conclusions || []),p.notes,(p.pdf_text || '').slice(0,6000)].filter(Boolean).join('\n');
  let body = `Bonjour,\n\nJe vous contacte au nom d’OmniDigital au sujet de ${p.company}. Nous accompagnons les entreprises dans la création de sites web et leur marketing digital.\n\n`;
  if(p.response_details)body=`Bonjour${p.contact_name?' '+p.contact_name:''},\n\nMerci pour votre retour au sujet de ${p.company}.\n\n`;
  body += findings.length ? `Une analyse automatisée de votre site suggère des pistes concernant ${findings.join(', ')}. Ces résultats méritent une vérification avec votre contexte métier.\n\n` : 'Nous souhaitons échanger avec vous sur les possibilités d’amélioration de votre présence en ligne, en fonction de vos priorités.\n\n';
  if (evidence) body += `Éléments du dossier à vérifier et reformuler avant envoi :\n${evidence.slice(0,1200)}\n\n`;
  const nextSteps={
    'Réponse positive':'Merci pour votre retour. Définissons ensemble un créneau pour examiner vos priorités.',
    'Demande d’informations':'Nous pouvons préciser les actions utiles à votre activité après un court diagnostic de vos besoins.',
    'Demande de rendez-vous':'Merci pour votre demande de rendez-vous. Quel créneau vous conviendrait pour notre échange ?',
    'Demande de devis / tarifs':'Pour établir une proposition précise, clarifions d’abord le périmètre et vos priorités. Aucun tarif ne sera avancé sans ces éléments.',
    'Pas maintenant / rappeler plus tard':p.next_followup?'Comme convenu, nous pourrons reprendre contact à partir du '+p.next_followup+'.':'Indiquez-nous si vous souhaitez reprendre cet échange ultérieurement, et à quelle date.',
    'Pas de budget':'Nous pouvons commencer par identifier vos priorités, puis reprendre le projet lorsque votre budget le permettra, si vous le souhaitez.',
    'Déjà un prestataire':'Si vous le souhaitez, nous pouvons vous transmettre un avis complémentaire à discuter avec votre prestataire actuel.',
    'Mauvais interlocuteur':'Pourriez-vous nous indiquer l’interlocuteur approprié pour cette demande, si vous souhaitez nous orienter ?',
    'Projet reporté':'Nous prenons note du report du projet. Nous pourrons reprendre la discussion à votre demande.'
  };
  body += (nextSteps[p.response_scenario] || 'Seriez-vous disponible pour un échange de 15 minutes afin d’identifier les actions les plus utiles pour votre activité ?')+'\n\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus être contacté, répondez simplement « stop ».';
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
const digest = value => createHash('sha256').update(value).digest();
export function createApp({db,config,fetcher=fetch,parsePdf=extractPdf,inspect=inspectWebsite}) {
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
    res.json({prospects,messages,sequences:db.prepare('SELECT * FROM outreach_sequences ORDER BY created DESC').all(),replies:db.prepare('SELECT * FROM prospect_replies ORDER BY created DESC').all(),duplicate_groups:duplicateGroups(prospects),metrics:{sent:messages.filter(m=>m.status==='Envoyé').length,opened:counts.open || 0,clicked:counts.click || 0,replied:counts.reply || 0},integrations:{pagespeed:!!config.pagespeedKey,email:false}});
  });
  app.post('/api/messages/:id/:action',(req,res)=>{
    const m=db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
    if(!m)throw new InputError('Message introuvable.',404);
    const p=db.prepare('SELECT * FROM prospects WHERE id=?').get(m.prospect_id);
    if(!p)throw new InputError('Prospect introuvable.',404);
    transaction(db,()=>messageAction(db,p,m,req.params.action,req.body||{}));res.json({ok:true});
  });
  app.get('/api/prospects/:id/history',(req,res)=>{
    if(!db.prepare('SELECT 1 FROM prospects WHERE id=?').get(req.params.id))throw new InputError('Prospect introuvable.',404);
    res.json({history:db.prepare('SELECT * FROM contact_history WHERE prospect_id=? ORDER BY created DESC,rowid DESC').all(req.params.id)});
  });
  app.get('/api/prospects/:id/audits',(req,res)=>{
    if(!db.prepare('SELECT 1 FROM prospects WHERE id=?').get(req.params.id))throw new InputError('Prospect introuvable.',404);
    res.json({audits:db.prepare('SELECT id,payload,created FROM site_audits WHERE prospect_id=? ORDER BY created DESC,rowid DESC').all(req.params.id).map(a=>({...JSON.parse(a.payload),id:a.id}))});
  });
  app.post('/api/prospects',(req,res)=>res.status(201).json({id:transaction(db,()=>saveContact(db,req.body))}));
  app.post('/api/import-pdf',async(req,res)=>{
    const result=importText(db,await parsePdf(req.body));res.status(result.created?201:200).json(result);
  });
  app.post('/api/prospects/:id/:action',async(req,res)=>{
    const {id,action}=req.params;
    const p=db.prepare('SELECT * FROM prospects WHERE id=?').get(id);
    if (!p) throw new InputError('Prospect introuvable.',404);
    if(action==='sequence'){
      const sequenceId=transaction(db,()=>createSequence(db,p,draft));return res.status(201).json({sequenceId});
    }
    if(action==='reply'){
      const result=transaction(db,()=>registerReply(db,p,req.body?.body,req.body?.scenario,draft));return res.status(201).json(result);
    }
    if (action==='pdf') {
      const text=await parsePdf(req.body);
      const result=db.prepare('UPDATE prospects SET pdf_text=? WHERE id=?').run(text,id);
      if (!result.changes) throw new InputError('Prospect introuvable.',404);
      return res.json({ok:true,characters:text.length});
    }
    if (action==='audit') {
      const audit=await auditWebsite(req.body?.website || p.website,{pagespeedKey:config.pagespeedKey,fetcher,inspect});
      const auditId=randomUUID().replaceAll('-','');
      transaction(db,()=>{
        const updated=db.prepare('UPDATE prospects SET audit=? WHERE id=?').run(JSON.stringify(audit),id);
        if(!updated.changes)throw new InputError('Prospect introuvable.',404);
        db.prepare('INSERT INTO site_audits(id,prospect_id,payload,created) VALUES(?,?,?,?)').run(auditId,id,JSON.stringify(audit),audit.date);
        history(db,id,'Audit du site',audit.conclusions.join('\n')||'Audit enregistré, aucune piste prioritaire.');
      });
      return res.json({ok:true,audit:{...audit,id:auditId}});
    }
    transaction(db,()=>{
      if (action==='update') saveContact(db,req.body,id);
      else if (action==='status') {
        if (!STATUSES.includes(req.body?.status)) throw new InputError('Statut invalide.');
        if(isOpposed(p)&&req.body.status!=='Opposition')throw new PolicyError('Opposition active : un nouvel accord documenté est nécessaire.');
        db.prepare('UPDATE prospects SET status=? WHERE id=?').run(req.body.status,id);
        if(req.body.status==='Opposition')suppress(db,p);
        if(['Pas intéressé','Perdu'].includes(req.body.status)){db.prepare("UPDATE prospects SET next_followup='' WHERE id=?").run(id);stopOutreach(db,id,'Refus commercial / dossier clôturé.');}
        history(db,id,'Changement de statut',p.status+' → '+req.body.status);
      } else if (action==='draft') {
        assertDraftAllowed(db,p);
        const {subject,body}=draft(p);
        db.prepare('INSERT INTO messages(id,prospect_id,subject,body,created) VALUES(?,?,?,?,?)').run(randomUUID().replaceAll('-',''),id,subject,body,now());
      } else if(action==='reconsent'){
        if(req.body?.confirm!==id)throw new PolicyError('Confirmation du nouvel accord requise.');
        reconsent(db,p,req.body.evidence);
      } else if (action==='delete') {
        if (req.body?.confirm!==id) throw new InputError('Confirmation de suppression requise.');
        if(isOpposed(p))suppress(db,p);
        db.prepare('DELETE FROM contact_history WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM outreach_sequences WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM prospect_replies WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM events WHERE message_id IN (SELECT id FROM messages WHERE prospect_id=?)').run(id);
        db.prepare('DELETE FROM messages WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM site_audits WHERE prospect_id=?').run(id);
        db.prepare('DELETE FROM prospects WHERE id=?').run(id);
      } else throw new InputError('Action inconnue.',404);
    });
    res.json({ok:true});
  });
  for (const [route,file] of Object.entries({'/':'index.html','/app.js':'app.js','/dashboard.js':'dashboard.js','/audit.js':'audit.js','/outreach-ui.js':'outreach-ui.js','/style.css':'style.css'})) app.get(route,(req,res)=>res.sendFile(resolve(ROOT,'static',file)));
  app.use((req,res)=>res.status(404).json({error:'Introuvable'}));
  app.use((error,req,res,next)=>{
    const status=error.status || (error.type==='entity.too.large'?413:500);
    res.status(status).json({error:(error instanceof InputError || error instanceof AuditError || error instanceof PolicyError)?error.message:status===413?'Fichier trop volumineux.':status===400?'Requête invalide.':'Erreur interne. Consultez la configuration du serveur.'});
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
