import {PolicyError,assertDraftAllowed} from './contact-policy.js';

const MAX_AUDIT_AGE = 90 * 24 * 60 * 60 * 1000;
const observations = [
  {id:'page0-viewport',status:'Amélioration recommandée',subject:'Une piste pour votre site sur mobile',text:'Lors du contrôle de votre page auditée, l’outil n’a pas détecté le réglage qui aide les téléphones à adapter l’affichage. Je vous propose de vérifier ensemble le rendu sur mobile.'},
  {id:'page0-alt',status:'Problème important',subject:'Une piste d’accessibilité pour votre site',text:'Le contrôle de votre page auditée a repéré des images sans texte alternatif. Je vous propose de vérifier lesquelles transmettent une information utile et gagneraient à être décrites.'}
];

function siteHost(value) {
  try {
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol) ? url.hostname.replace(/^www\./,'') : '';
  } catch {
    return '';
  }
}

export function guidedDraft(db,prospect) {
  assertDraftAllowed(db,prospect);
  const contact=db.prepare(`SELECT c.company_id,c.email_opt_out,c.email_verified_status,
    co.website,co.business_status,co.company_status FROM contacts c
    JOIN companies co ON co.id=c.company_id WHERE c.prospect_id=?`).get(prospect.id);
  if(!contact)throw new PolicyError('Utilisez une fiche contact associée à une entreprise.',409);
  if(!prospect.email||contact.email_verified_status==='Invalide'||contact.email_opt_out||
      prospect.preferred_channel==='Aucun'||contact.company_status==='Fermée'||
      ['Opposition','Pas intéressé','Perdu'].includes(contact.business_status)){
    throw new PolicyError('Vérifiez l’adresse email et les restrictions de contact de ce dossier.',409);
  }
  const previous=db.prepare(`SELECT 1 FROM contacts c JOIN prospects p ON p.id=c.prospect_id
    WHERE c.company_id=? AND (p.last_contact_date<>'' OR p.last_response_date<>'' OR EXISTS (
      SELECT 1 FROM messages m WHERE m.prospect_id=p.id AND m.status<>'Annulé'
    )) LIMIT 1`).get(contact.company_id);
  if(previous)throw new PolicyError('Une communication ou un brouillon existe pour cette entreprise. Consultez Emails et l’historique avant de reprendre contact.',409);

  const audit=db.prepare(`SELECT id,payload FROM audits WHERE company_id=? AND json_valid(payload)
    AND json_extract(payload,'$.engine_version')=3 ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(contact.company_id);
  const result=audit&&JSON.parse(audit.payload);
  const host=siteHost(contact.website);
  const age=Date.now()-Date.parse(result?.date);
  const usable=host&&siteHost(result?.requestedUrl)===host&&siteHost(result?.url)===host&&
    age>=0&&age<=MAX_AUDIT_AGE&&['partial','completed'].includes(result?.execution_status)&&
    Array.isArray(result?.controls);
  const observation=usable&&observations.find(item=>result.controls.some(control=>
    control?.id===item.id&&control.status===item.status&&control.source==='HTML reçu'&&control.page_url===result.url));
  if(!observation)throw new PolicyError('Aucun constat exploitable sur la page auditée dans le dernier audit. Vérifiez le site ou relancez Audit digital.',409);
  return {
    subject:observation.subject,
    body:`Bonjour,\n\nJe vous contacte de la part d’OmniDigital. ${observation.text}\n\nSi ce point vous intéresse, seriez-vous disponible pour un échange de 15 minutes ? Vous pouvez me répondre directement ou choisir un créneau : https://calendar.app.google/d2Cz8bKbXN6zfxsX6\n\nBien cordialement,\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus recevoir de messages de notre part, répondez simplement « stop ».`,
    context:`Brouillon ciblé · Audit ${audit.id} · ${result.date.slice(0,10)} · contrôle ${observation.id}. Vérifier le constat avant approbation.`
  };
}
