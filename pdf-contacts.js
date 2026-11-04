import {randomUUID} from 'node:crypto';
import {EntityError,saveCompany,saveEntityContact,validateFrenchCompanyIds,restrictedIdentity} from './entities.js';
import {PolicyError,history,isOpposed,suppressed} from './contact-policy.js';

const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const emailKey=value=>String(value||'').trim().toLowerCase();
const phoneKey=value=>String(value||'').replace(/\D/g,'').replace(/^33(?=\d{9}$)/,'0');
const pdfFields={
  name:['Raison sociale','Dénomination sociale','Nom de la société','Société','Entreprise','Nom de l’entreprise','Nom de l\'entreprise','Nom'],
  siren:['SIREN'],siret:['SIRET'],website:['Site web','Site internet','Site'],address:['Adresse'],
  postal_code:['Code postal'],city:['Ville','Commune'],industry:['Secteur / NAF','Secteur','Activité'],
  display_name:['Dirigeant(e)','Dirigeant','Nom du contact','Contact'],job_title:['Fonction','Poste'],
  email:['Email du contact','Adresse email','Adresse e-mail','Email','E-mail','Courriel'],phone:['Téléphone professionnel','Téléphone','Tél.','Tél'],mobile:['Mobile','Portable']
};
const knownLabels=new Set(Object.values(pdfFields).flat().map(label=>label.toLowerCase()));
const contactFields=new Set(['display_name','job_title','email','phone','mobile']);
const fail=(message,status=400)=>{throw new EntityError(message,status);};

function extractFields(text){
  const documentLines=text.split(/\r?\n/);
  const identity=documentLines.findIndex(line=>/^Identité et coordonnées$/iu.test(line.trim()));
  const end=identity<0?-1:documentLines.findIndex((line,index)=>index>identity&&
    /^(?:Audit du site(?:\s|$)|Principaux problèmes|Premier contact(?:\s|$)|Relances?(?:\s|$))/iu.test(line.trim()));
  const lines=identity<0?documentLines:documentLines.slice(identity+1,end<0?undefined:end);
  const values={};
  for(const [key,labels] of Object.entries(pdfFields)){
    for(const label of labels){
      const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const rule=new RegExp('^\\s*'+escaped+'(?:[ \t]*:[ \t]*|[ \t]{2,})(.{1,499})$','iu');
      const labelOnly=new RegExp('^\\s*'+escaped+'[ \t]*:?[ \t]*$','iu');
      const matches=[...new Set(lines.map((line,index)=>{
        const inline=line.match(rule)?.[1].trim();
        if(inline)return inline;
        if(!labelOnly.test(line))return '';
        const next=lines[index+1]?.trim()||'';
        const nextLabel=next.split(/:|[ \t]{2,}/,1)[0].trim().toLowerCase();
        return next.length<=499&&!knownLabels.has(nextLabel)?next:'';
      }).filter(value=>value&&!/^(?:[-–—]+|n\/?a|non renseigné|non trouv[ée]e?|non disponible|inconnu)$/i.test(value)))];
      if(matches.length>1)fail('Plusieurs valeurs pour « '+label+' ». Utilisez un PDF pour une seule entreprise.');
      if(matches.length){values[key]=matches[0];break;}
    }
  }
  if(!values.name&&identity>=0){
    values.name=documentLines.slice(0,identity)
      .map(line=>line.match(/^\s*Prospect\s+\d+\s*[—–-]\s*(.{1,250})$/iu)?.[1].trim())
      .find(Boolean);
    if(!values.name)delete values.name;
  }
  const combined=lines.map(line=>line.match(/^\s*SIREN\s*\/\s*SIRET(?:\s*:\s*|\s{2,})([\d ]+)\s*\/\s*([\d ]+)\s*$/iu)).find(Boolean);
  if(combined){
    values.siren||=combined[1].trim();
    values.siret||=combined[2].trim();
  }
  const location=values.address?.match(/^(.+),\s*(\d{5})\s+(.+)$/u);
  if(location){
    values.address=location[1].trim();
    values.postal_code||=location[2];
    values.city||=location[3].trim();
  }
  const manager=values.display_name?.match(/^(.+?)\s+[—–]\s+(.+)$/u);
  if(manager){
    values.display_name=manager[1].trim();
    values.job_title||=manager[2].trim();
  }
  if(!values.name)fail('Entreprise non identifiée dans le PDF. Utilisez un champ « Entreprise », « Raison sociale » ou « Nom de la société » suivi de sa valeur.');
  if(values.email)values.email=emailKey(values.email);
  if(values.website&&/^(?:www\.)?[a-z\d][a-z\d.-]*\.[a-z]{2,}(?:[/?#]|$)/i.test(values.website))values.website='https://'+values.website;
  validateFrenchCompanyIds(values);
  return values;
}

function unique(rows,label){
  if(rows.length>1)fail('Plusieurs fiches possibles ('+label+'). Vérifiez les doublons avant de réimporter.',409);
  return rows[0];
}

function matchesContact(incoming,row){
  const named=incoming.display_name&&row.display_name;
  return incoming.email&&emailKey(row.email)===incoming.email||
    named&&normalize(incoming.display_name)===normalize(row.display_name)||
    !named&&['phone','mobile'].some(key=>incoming[key]&&phoneKey(incoming[key])===phoneKey(row[key]));
}

function planImport(db,fields){
  const companies=db.prepare('SELECT * FROM companies').all();
  const byId=fields.siren&&companies.find(company=>company.siren===fields.siren);
  const sameName=companies.filter(company=>[company.name,company.legal_name].some(value=>normalize(value)===normalize(fields.name)));
  const company=byId||unique(sameName,'entreprise');
  if(company?.siren&&fields.siren&&company.siren!==fields.siren)fail('Le nom correspond à une entreprise portant un autre SIREN. Vérifiez l’identité avant l’import.',409);
  const contacts=company?db.prepare('SELECT * FROM contacts WHERE company_id=?').all(company.id):[];
  const identified=contacts.filter(row=>matchesContact(fields,row));
  const contact=unique(identified,'contact')||
    (contacts.length===1&&fields.display_name&&!contacts[0].display_name?contacts[0]:undefined);
  const emailOwner=fields.email&&db.prepare('SELECT id FROM contacts WHERE lower(email)=?').get(fields.email);
  if(emailOwner&&emailOwner.id!==contact?.id)fail('Cet email appartient à un autre contact CRM. Vérifiez l’identité avant l’import.',409);
  const older=db.prepare('SELECT p.* FROM prospects p WHERE NOT EXISTS(SELECT 1 FROM contacts c WHERE c.prospect_id=p.id)').all();
  const legacy=unique(older.filter(p=>(fields.siren&&p.siren===fields.siren||normalize(p.company)===normalize(fields.name))&&
    (matchesContact(fields,{...p,display_name:p.contact_name})||!company&&!p.contact_name&&(!p.email||!fields.email))),'dossier historique');
  if(fields.email&&older.some(row=>row.id!==legacy?.id&&emailKey(row.email)===fields.email))
    fail('Cet email appartient à un autre dossier historique. Vérifiez l’identité avant l’import.',409);
  if(legacy&&(contact||legacy.siren&&fields.siren&&legacy.siren!==fields.siren))fail('Identités en conflit avec un dossier historique. Vérifiez les fiches avant l’import.',409);
  if(company?.business_status==='Opposition'||contact?.contact_status==='Opposition'||legacy&&isOpposed(legacy)||
      suppressed(db,{company:fields.name,email:fields.email,phone:fields.phone,mobile:fields.mobile})||
      restrictedIdentity(db,fields,contact?.id))throw new PolicyError('Une opposition est enregistrée pour cette fiche.',409);

  const companyBase=company||legacy&&{name:legacy.company,website:legacy.website,siren:legacy.siren,address:legacy.address,
    postal_code:legacy.postal_code,city:legacy.city,country:legacy.country,industry:legacy.industry,priority:legacy.priority,
    observed_needs:legacy.needs,recommended_services:legacy.services,budget_range:legacy.budget_range,
    budget_kind:legacy.budget_range?'Inconnu':'',next_action:legacy.next_action,current_provider:legacy.competitor};
  const contactBase=contact||legacy&&{display_name:legacy.contact_name,job_title:legacy.job_title,email:legacy.email,phone:legacy.phone,
    mobile:legacy.mobile,contact_status:legacy.status,contact_notes:legacy.notes,contact_source:legacy.source,
    collected_at:legacy.source_date,contact_owner_id:legacy.assigned_to,preferred_channel:legacy.preferred_channel,
    decision_role:legacy.decision_role==='Prescripteur'?'Influenceur':
      ['Décideur','Utilisateur'].includes(legacy.decision_role)?legacy.decision_role:'Inconnu',
    last_contact_at:legacy.last_contact_date,last_reply_at:legacy.last_response_date,next_followup_at:legacy.next_followup,
    email_opt_out:legacy.do_not_email==='Oui',phone_opt_out:legacy.do_not_call==='Oui'};
  const changes=Object.entries(fields).map(([key,value])=>{
    const current=(contactFields.has(key)?contactBase:companyBase)?.[key]||'';
    return {key,label:pdfFields[key][0],value,current,conflict:!!current&&current!==value};
  }).filter(field=>field.current!==field.value);
  return {company,contact,legacy,companyBase,contactBase,changes};
}

function applyImport(db,plan,choices){
  if(!choices||typeof choices!=='object'||Array.isArray(choices))fail('Choix de validation invalides.');
  const companyData={},contactData={};
  for(const field of plan.changes){
    const choice=choices[field.key];
    if(field.conflict&&!['crm','pdf'].includes(choice))fail('Choisissez la valeur à retenir pour « '+field.label+' ».');
    if(choice==='crm')continue;
    (contactFields.has(field.key)?contactData:companyData)[field.key]=field.value;
  }
  const companyId=plan.company?.id||saveCompany(db,{...plan.companyBase,...companyData,source:'Import PDF'}).id;
  if(plan.company&&Object.keys(companyData).length)saveCompany(db,companyData,companyId);
  let contact=plan.contact;
  if(contact&&Object.keys(contactData).length)contact=saveEntityContact(db,{...contactData,
    ...(contactData.email?{email_verified_status:'Non vérifié'}:{})},contact.id);
  if(!contact){
    const values={...plan.contactBase,...contactData};
    if(values.display_name||values.email||values.phone||values.mobile){
      contact=saveEntityContact(db,{...values,company_id:companyId,contact_source:values.contact_source||'Import PDF'},undefined,plan.legacy?.id);
    }
  }
  if(contact&&!db.prepare("SELECT 1 FROM contact_history WHERE prospect_id=? AND kind='Import PDF structuré'").get(contact.prospect_id))
    history(db,contact.prospect_id,'Import PDF structuré','Identité et coordonnées revues. Analyse du PDF ignorée.');
  return {company_id:companyId,contact_id:contact?.id||null,prospect_id:contact?.prospect_id||null};
}

export function isPdfContact(db,id){
  return !!db.prepare("SELECT 1 FROM contact_history WHERE prospect_id=? AND kind='Import PDF structuré' LIMIT 1").get(id);
}

export function mountPdfContacts(app,db,parsePdf,transaction){
  const previews=new Map();
  app.post('/api/pdf-contacts/preview',async(req,res)=>{
    const fields=extractFields(await parsePdf(req.body));
    const plan=planImport(db,fields);
    const now=Date.now();
    for(const [id,entry] of previews)if(entry.expires<=now)previews.delete(id);
    if(previews.size>=20)fail('Trop d’imports en attente. Validez une fiche ou réessayez plus tard.',429);
    const token=randomUUID();
    previews.set(token,{fields,plan:JSON.stringify(plan),expires:now+15*60*1000});
    res.json({token,changes:plan.changes,company:plan.company?.name||plan.legacy?.company||fields.name});
  });
  app.post('/api/pdf-contacts/confirm',(req,res)=>{
    const token=req.body?.token;
    const entry=previews.get(token);
    if(!entry||entry.expires<=Date.now()){previews.delete(token);fail('Aperçu expiré. Rechargez le PDF.',409);}
    const result=transaction(db,()=>{
      const plan=planImport(db,entry.fields);
      if(JSON.stringify(plan)!==entry.plan)fail('Une fiche a changé depuis l’aperçu. Rechargez le PDF.',409);
      return applyImport(db,plan,req.body.choices);
    });
    previews.delete(token);
    res.json(result);
  });
}
