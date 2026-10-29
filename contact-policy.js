import {createHash,randomUUID} from 'node:crypto';
export const CONTACT_STATUSES=['Nouveau','À qualifier','Sans email','Qualifié','Contacté','Intéressé','Rendez-vous','Proposition envoyée','Négociation','À recontacter','Pas intéressé','Injoignable','Gagné','Perdu','Opposition'];
export const POLICY_FIELDS=['contact_permission','permission_note','opposition_date','preferred_channel','do_not_email','do_not_call','do_not_sms','response_scenario','response_details','objection','budget_range','decision_role','project_timeline','competitor','loss_reason','next_action','assigned_to','last_contact_date','last_response_date'];
export const PERMISSIONS=['À vérifier','Contact professionnel documenté','Accord explicite','Opposition'];
export const SCENARIOS=['Aucune réponse','Réponse positive','Demande d’informations','Demande de rendez-vous','Demande de devis / tarifs','Pas maintenant / rappeler plus tard','Pas de budget','Déjà un prestataire','Pas intéressé / offre refusée','Ne plus être contacté','Demande de suppression des données','Adresse email invalide / rebond','Mauvais interlocuteur','Entreprise fermée','Projet reporté','Autre'];
export class PolicyError extends Error{constructor(message,status=400){super(message);this.status=status}}
export function initPolicy(db){
 db.exec(`CREATE TABLE IF NOT EXISTS contact_suppressions(kind TEXT NOT NULL,fingerprint TEXT NOT NULL,prospect_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(kind,fingerprint));
 CREATE TABLE IF NOT EXISTS contact_history(id TEXT PRIMARY KEY,prospect_id TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_contact_history ON contact_history(prospect_id,created);`);
 // Backfill legacy oppositions before any create or import can reintroduce them.
 for(const p of db.prepare("SELECT id,company,email,phone,mobile FROM prospects WHERE status='Opposition' OR contact_permission='Opposition'").all())suppress(db,p);
}
const normalize=v=>String(v||'').normalize('NFKD').toLowerCase().replace(/ß/g,'ss').replace(/[^\p{L}\p{N}]/gu,'');
function identifiers(p){return [['company',normalize(p.company)],['email',String(p.email||'').trim().toLowerCase()],['phone',String(p.phone||'').replace(/\D/g,'')],['mobile',String(p.mobile||'').replace(/\D/g,'')]].filter(([,v])=>v).map(([k,v])=>[k==='mobile'?'phone':k,createHash('sha256').update(v).digest('hex')])}
export function suppressed(db,p){return identifiers(p).some(([kind,key])=>db.prepare('SELECT 1 FROM contact_suppressions WHERE kind=? AND fingerprint=?').get(kind,key))}
export function isOpposed(p){return p.status==='Opposition'||p.contact_permission==='Opposition'}
export function history(db,id,kind,detail){db.prepare('INSERT INTO contact_history VALUES(?,?,?,?,?)').run(randomUUID().replaceAll('-',''),id,kind,detail,new Date().toISOString())}
export function suppress(db,p){
 const date=new Date().toISOString();
 for(const [kind,fingerprint] of identifiers(p))db.prepare('INSERT OR IGNORE INTO contact_suppressions VALUES(?,?,?,?)').run(kind,fingerprint,p.id,date);
 db.prepare("UPDATE outreach_sequences SET state='En pause' WHERE prospect_id=? AND state='Active'").run(p.id);
 db.prepare("UPDATE messages SET status='Annulé',approved_at='' WHERE prospect_id=? AND status IN ('Brouillon','Approuvé')").run(p.id);
 db.prepare("UPDATE prospects SET contact_permission='Opposition',status='Opposition',next_followup='',opposition_date=CASE WHEN opposition_date='' THEN ? ELSE opposition_date END WHERE id=?").run(date.slice(0,10),p.id);
}
export function checkPolicyValues(values){
 if(values.contact_permission&&!PERMISSIONS.includes(values.contact_permission))throw new PolicyError('Situation de contact invalide.');
 if(values.preferred_channel&&!['Email','Téléphone','SMS','Aucun'].includes(values.preferred_channel))throw new PolicyError('Canal de contact invalide.');
 if(values.response_scenario&&!SCENARIOS.includes(values.response_scenario))throw new PolicyError('Scénario de réponse invalide.');
 for(const field of ['do_not_email','do_not_call','do_not_sms'])if(values[field]&&!['Oui','Non'].includes(values[field]))throw new PolicyError('Restriction de canal invalide.');
}
export function assertDraftAllowed(db,p){
 if(isOpposed(p)||suppressed(db,p))throw new PolicyError('Ce contact s’oppose à la prospection. Aucun nouveau message ne peut être préparé.');
 if(p.do_not_email==='Oui')throw new PolicyError('Ce contact ne souhaite pas de prospection par email.');
 if(['Pas intéressé','Perdu'].includes(p.status))throw new PolicyError('Dossier clôturé : ne pas relancer sans nouvelle demande ou contexte documenté.');
}
export function reconsent(db,p,evidence){
 if(typeof evidence!=='string'||!evidence.trim()||evidence.length<12||evidence.length>20000)throw new PolicyError('Documentez le nouvel accord : date, canal et origine de la demande (12 caractères minimum).');
 for(const [kind,fingerprint] of identifiers(p))db.prepare('DELETE FROM contact_suppressions WHERE kind=? AND fingerprint=?').run(kind,fingerprint);
 db.prepare('DELETE FROM contact_suppressions WHERE prospect_id=?').run(p.id);
 db.prepare("UPDATE outreach_sequences SET state='Clôturée' WHERE prospect_id=? AND state='En pause'").run(p.id);
 db.prepare("UPDATE prospects SET contact_permission='Accord explicite',permission_note=?,opposition_date='',status='À qualifier',next_followup='',response_scenario='',do_not_email='',do_not_call='',do_not_sms='' WHERE id=?").run(evidence,p.id);
 history(db,p.id,'Nouvel accord documenté',evidence);
}
