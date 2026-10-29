import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import {randomUUID} from 'node:crypto';
import {load} from 'cheerio';
import {assertDraftAllowed,history,PolicyError} from './contact-policy.js';
import {registerReply,stripQuotedReply,stopOutreach} from './outreach.js';

const MAILBOX=/^[^\s@<>,;:]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SERVERS={hostinger:{smtp:'smtp.hostinger.com',imap:'imap.hostinger.com'},titan:{smtp:'smtp.titan.email',imap:'imap.titan.email'}};
export function readMailConfig(env=process.env){
 const provider=String(env.MAIL_PROVIDER||'hostinger').toLowerCase(),user=env.MAIL_USER||'',password=env.MAIL_PASSWORD||'';
 return {provider,user,password,name:env.MAIL_FROM_NAME||'OmniDigital',...SERVERS[provider],configured:!!SERVERS[provider]&&!!password&&MAILBOX.test(user),intervalMs:60000};
}
function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}
function stamp(){return new Date().toISOString()}
export function initMail(db){
 const cols=new Set(db.prepare('PRAGMA table_info(messages)').all().map(c=>c.name));
 for(const field of ['smtp_message_id','send_attempted_at','delivery_note','internal_context'])if(!cols.has(field))db.exec(`ALTER TABLE messages ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
 db.exec(`CREATE TABLE IF NOT EXISTS mail_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mail_received(account TEXT NOT NULL,uidvalidity TEXT NOT NULL,uid INTEGER NOT NULL,message_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(account,uidvalidity,uid));
 CREATE INDEX IF NOT EXISTS idx_mail_received_id ON mail_received(account,message_id);`);
 // An interrupted process must never retry a potentially accepted SMTP message.
 db.prepare("UPDATE messages SET status='À vérifier',delivery_note='Processus interrompu pendant SMTP : vérifier la livraison avant toute nouvelle tentative.' WHERE status='Envoi en cours'").run();
}
function cleanIncoming(parsed){
 if(parsed.html){
  const $=load(parsed.html);$('blockquote,.gmail_quote,.yahoo_quoted,#divRplyFwdMsg,script,style').remove();$('br').replaceWith('\n');$('p,div').append('\n');
  return stripQuotedReply($.root().text()).trim();
 }
 return stripQuotedReply(parsed.text||'').trim();
}
function smtpTransport(config){return nodemailer.createTransport({host:config.smtp,port:465,secure:true,auth:{user:config.user,pass:config.password},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true})}
function imapClient(config){const client=new ImapFlow({host:config.imap,port:993,secure:true,auth:{user:config.user,pass:config.password},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,disableAutoIdle:true});client.on('error',()=>{});return client}
export class MailService{
 constructor({db,config,draft,transport,clientFactory}){
  this.db=db;this.config=config;this.draft=draft;this.transport=transport||(config.configured?smtpTransport(config):null);this.clientFactory=clientFactory||(()=>imapClient(config));this.syncPromise=null;this.lastSync='';this.lastError='';this.verifiedAt='';this.timer=null;
 }
 status(){return {configured:this.config.configured,provider:this.config.provider,address:this.config.user,smtpHost:this.config.smtp||'',imapHost:this.config.imap||'',verifiedAt:this.verifiedAt,lastSync:this.lastSync,error:this.lastError,automaticReception:!!this.timer}}
 requireConfig(){if(!this.config.configured)throw new PolicyError('Configurez MAIL_PROVIDER, MAIL_USER et MAIL_PASSWORD dans les variables sécurisées Hostinger.',503)}
 async verify(){
  this.requireConfig();let client;
  try{
   await this.transport.verify();client=this.clientFactory();await client.connect();
   this.verifiedAt=stamp();this.lastError='';return this.status();
  }catch{this.lastError='Connexion email impossible : vérifiez le fournisseur, les identifiants, les ports 465/993 et l’accès réseau.';throw new PolicyError(this.lastError,502)}
  finally{if(client)await client.logout().catch(()=>client.close())}
 }
 start(){if(!this.config.configured||this.timer)return;this.sync().catch(()=>{});this.timer=setInterval(()=>this.sync().catch(()=>{}),this.config.intervalMs);this.timer.unref()}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;this.transport?.close?.()}
 sync(){if(this.syncPromise)return this.syncPromise;this.syncPromise=this.performSync().finally(()=>{this.syncPromise=null});return this.syncPromise}
 async performSync(){
  this.requireConfig();const client=this.clientFactory();let lock;
  try{
   await client.connect();lock=await client.getMailboxLock('INBOX',{readOnly:true});
   const validity=String(client.mailbox.uidValidity),account=this.config.user.trim().toLowerCase(),key=account+':INBOX:'+validity;
   const state=this.db.prepare('SELECT value FROM mail_state WHERE key=?').get(key);
   const lastUid=state?Number(state.value):Number(client.mailbox.uidNext)-1;
   if(!state){this.db.prepare('INSERT INTO mail_state VALUES(?,?)').run(key,String(lastUid));this.lastSync=stamp();this.lastError='';return {initialized:true,imported:0,note:'Synchronisation activée pour les nouveaux messages uniquement. Aucun ancien email importé.'}}
   if(lastUid>=Number(client.mailbox.uidNext)-1){this.lastSync=stamp();this.lastError='';return {imported:0}}
   let imported=0,processed=0,reviewRequired=0;
   const endUid=Math.min(lastUid+50,Number(client.mailbox.uidNext)-1);
   for await(const item of client.fetch(`${lastUid+1}:${endUid}`,{uid:true,envelope:true,size:true},{uid:true})){
    if(item.uid<=lastUid)continue;
    processed++;
    const already=this.db.prepare('SELECT 1 FROM mail_received WHERE account=? AND uidvalidity=? AND uid=?').get(account,validity,item.uid);
    const from=item.envelope?.from?.[0]?.address?.toLowerCase();
    const known=from?this.db.prepare("SELECT m.*,p.id AS prospect FROM messages m JOIN prospects p ON p.id=m.prospect_id WHERE lower(m.approved_recipient)=? AND m.smtp_message_id<>'' AND m.status IN ('Envoyé','À vérifier')").all(from):[];
    if(!already&&known.length&&item.size>512*1024){
     atomic(this.db,()=>{for(const prospectId of new Set(known.map(m=>m.prospect_id)))stopOutreach(this.db,prospectId,'Email volumineux reçu de ce contact : vérifier manuellement la boîte avant de reprendre la prospection.');});reviewRequired++;
    }
    if(!already&&known.length&&item.size<=512*1024){
     const full=await client.fetchOne(item.uid,{source:true},{uid:true});
     if(full?.source?.length<=512*1024){
      const parsed=await simpleParser(full.source,{skipTextToHtml:true,skipImageLinks:true,maxHtmlLengthToParse:512*1024});
      const duplicate=parsed.messageId&&this.db.prepare('SELECT 1 FROM mail_received WHERE account=? AND message_id=?').get(account,parsed.messageId);
      const refs=[parsed.inReplyTo,...(Array.isArray(parsed.references)?parsed.references:[parsed.references])].filter(Boolean).join(' ');
      const match=known.find(m=>refs.includes(m.smtp_message_id));
      if(match&&!duplicate){
       atomic(this.db,()=>{
        const p=this.db.prepare('SELECT * FROM prospects WHERE id=?').get(match.prospect_id);
        if(!p)return;
        const text=cleanIncoming(parsed).slice(0,20000),automatic=String(parsed.headers.get('auto-submitted')||'no').toLowerCase()!=='no';
        registerReply(this.db,p,text||'Réponse reçue sans texte exploitable : vérifier la boîte email.','',this.draft,{prepareDraft:!!text&&!automatic});
        this.db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(randomUUID().replaceAll('-',''),match.id,'reply',stamp());
        this.db.prepare('INSERT INTO mail_received VALUES(?,?,?,?,?)').run(account,validity,item.uid,parsed.messageId||'',stamp());
       });imported++;
      }
     }
    }
    this.db.prepare('INSERT INTO mail_received VALUES(?,?,?,?,?) ON CONFLICT(account,uidvalidity,uid) DO NOTHING').run(account,validity,item.uid,item.envelope?.messageId||'',stamp());
   }
   this.db.prepare('UPDATE mail_state SET value=? WHERE key=?').run(String(endUid),key);
   this.lastSync=stamp();this.lastError='';return {imported,processed,reviewRequired,backlog:endUid<Number(client.mailbox.uidNext)-1};
  }catch{this.lastError='Synchronisation IMAP impossible. Aucun message n’a été supprimé de la boîte ; vérifiez la connexion.';throw new PolicyError(this.lastError,502)}
  finally{lock?.release();await client.logout().catch(()=>client.close())}
 }
 async send(messageId,data){
  this.requireConfig();
  // Read new replies first; a failed read blocks sending instead of guessing.
  const sync=await this.sync();
  if(sync.backlog)throw new PolicyError('Des emails restent à synchroniser. Relancez la synchronisation avant cet envoi.',409);
  const claimed=atomic(this.db,()=>{
   const m=this.db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
   if(!m)throw new PolicyError('Message introuvable.',404);
   const p=this.db.prepare('SELECT * FROM prospects WHERE id=?').get(m.prospect_id);
   if(!p)throw new PolicyError('Contact introuvable.',404);
   assertDraftAllowed(this.db,p);
   if(m.status!=='Approuvé'||data.confirm!==m.id||data.approvedAt!==m.approved_at)throw new PolicyError('Approuvez ce mail et confirmez individuellement son envoi.',409);
   if(!MAILBOX.test(m.approved_recipient))throw new PolicyError('Adresse email du destinataire invalide.');
   if(m.approved_recipient!==String(p.email||'').trim().toLowerCase())throw new PolicyError('Destinataire modifié : nouvelle approbation requise.');
   if(/Éléments du dossier à vérifier et reformuler avant envoi|\[(?:créneau|point |délai)/i.test(m.body))throw new PolicyError('Retirez les notes internes et les champs à compléter avant d’envoyer. Modifiez le texte puis approuvez-le à nouveau.');
   let previous;
   if(m.sequence_id){
    const seq=this.db.prepare('SELECT * FROM outreach_sequences WHERE id=?').get(m.sequence_id);
    if(seq?.state!=='Active')throw new PolicyError('Séquence en pause.');
    if(m.sequence_stage>0){
     previous=this.db.prepare('SELECT * FROM messages WHERE sequence_id=? AND sequence_stage=?').get(m.sequence_id,m.sequence_stage-1);
     if(!previous?.sent_at||Date.now()-Date.parse(previous.sent_at)<7*86400000)throw new PolicyError('Attendez 7 jours après le précédent envoi confirmé.');
    }
   }
   if(!previous)previous=this.db.prepare("SELECT * FROM messages WHERE prospect_id=? AND smtp_message_id<>'' AND status='Envoyé' ORDER BY sent_at DESC LIMIT 1").get(p.id);
   const smtpId=`<${randomUUID()}@${this.config.user.split('@')[1]}>`,attemptedAt=stamp();
   this.db.prepare("UPDATE messages SET status='Envoi en cours',smtp_message_id=?,send_attempted_at=?,delivery_note='' WHERE id=?").run(smtpId,attemptedAt,m.id);
   history(this.db,p.id,'Envoi SMTP confirmé par vous',m.subject+' · Destinataire : '+m.approved_recipient);
   return {...m,smtpId,attemptedAt,previousId:previous?.smtp_message_id||''};
  });
  try{
   const result=await this.transport.sendMail({from:{name:this.config.name,address:this.config.user},to:{address:claimed.approved_recipient},envelope:{from:this.config.user,to:[claimed.approved_recipient]},replyTo:this.config.user,subject:claimed.subject,text:claimed.body,messageId:claimed.smtpId,...(claimed.previousId?{inReplyTo:claimed.previousId,references:[claimed.previousId]}:{}),headers:{'Auto-Submitted':'no'},disableFileAccess:true,disableUrlAccess:true});
   if(!result.accepted?.length)throw new Error('Recipient not accepted');
   atomic(this.db,()=>this.markSent(claimed,'Accepté par le serveur SMTP ; cela ne garantit pas la livraison en boîte de réception.'));
   return {ok:true,note:'Email accepté par le serveur SMTP.'};
  }catch{
   this.db.prepare("UPDATE messages SET status='À vérifier',delivery_note='Résultat SMTP incertain. Vérifiez la boîte et les logs du fournisseur avant de réessayer.' WHERE id=? AND status='Envoi en cours'").run(messageId);
   history(this.db,claimed.prospect_id,'Envoi SMTP à vérifier','Aucune nouvelle tentative automatique. Vérifier la livraison avant toute action.');
   throw new PolicyError('L’envoi doit être vérifié auprès du fournisseur. Aucune nouvelle tentative automatique ne sera faite.',502);
  }
 }
 markSent(m,note){
  const sentAt=stamp();this.db.prepare("UPDATE messages SET status='Envoyé',sent_at=?,delivery_note=? WHERE id=?").run(sentAt,note,m.id);
  if(m.sequence_id){this.db.prepare('UPDATE messages SET due_at=? WHERE sequence_id=? AND sequence_stage=?').run(new Date(Date.parse(sentAt)+7*86400000).toISOString(),m.sequence_id,m.sequence_stage+1);if(m.sequence_stage===3)this.db.prepare("UPDATE outreach_sequences SET state='Terminée' WHERE id=?").run(m.sequence_id)}
  this.db.prepare("UPDATE prospects SET last_contact_date=?,status=CASE WHEN status IN ('Nouveau','À qualifier','Qualifié','Sans email') THEN 'Contacté' ELSE status END WHERE id=?").run(sentAt.slice(0,10),m.prospect_id);
  history(this.db,m.prospect_id,'Envoi SMTP enregistré',note);
 }
 resolve(messageId,data){
  return atomic(this.db,()=>{
   const m=this.db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
   if(!m||m.status!=='À vérifier'||data.confirm!==m.id||typeof data.evidence!=='string'||data.evidence.trim().length<12)throw new PolicyError('Documentez votre vérification auprès du fournisseur (12 caractères minimum).');
   if(data.outcome==='sent'){this.markSent(m,'Livraison vérifiée manuellement : '+data.evidence)}
   else if(data.outcome==='not-sent'){
    this.db.prepare("UPDATE messages SET status='Brouillon',approved_at='',approved_recipient='',smtp_message_id='',delivery_note=? WHERE id=?").run('Non-envoi confirmé manuellement : '+data.evidence,m.id);
    history(this.db,m.prospect_id,'Non-envoi confirmé',data.evidence+' · Nouvelle approbation et confirmation requises.');
   }else throw new PolicyError('Résultat de vérification invalide.');
   return {ok:true};
  });
 }
}
