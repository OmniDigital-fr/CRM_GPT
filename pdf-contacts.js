import {parseProspectPdf,pdfFields,contactFields} from './pdf-prospect-parser.js';
import {randomUUID} from 'node:crypto';
import {EntityError,saveCompany,saveEntityContact,restrictedIdentity} from './entities.js';
import {PolicyError,history,isOpposed,suppressed} from './contact-policy.js';

const normalize=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const emailKey=value=>String(value||'').trim().toLowerCase();
const phoneKey=value=>String(value||'').replace(/\D/g,'').replace(/^33(?=\d{9}$)/,'0');
const fail=(message,status=400)=>{throw new EntityError(message,status);};

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
  const contact=unique(identified,'contact');
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
      restrictedIdentity(db,fields,contact?.id)||
      suppressed(db,{company:fields.name,email:fields.general_email,phone:fields.general_phone})||
      restrictedIdentity(db,{email:fields.general_email,phone:fields.general_phone},contact?.id))throw new PolicyError('Une opposition est enregistrée pour cette fiche.',409);

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
  const rows=Object.entries(fields).map(([key,value])=>{
    const current=(contactFields.has(key)?contactBase:companyBase)?.[key]||'';
    return {key,label:pdfFields[key][0],target:contactFields.has(key)?'contact':'company',value,current,conflict:!!current&&current!==value,unchanged:current===value};
  });
  const changes=rows.filter(field=>!field.unchanged);
  return {company,contact,legacy,companyBase,contactBase,rows,changes};
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
    const document=parseProspectPdf(await parsePdf(req.body));
    const {fields}=document;
    const plan=planImport(db,fields);
    const now=Date.now();
    for(const [id,entry] of previews)if(entry.expires<=now)previews.delete(id);
    if(previews.size>=20)fail('Trop d’imports en attente. Validez une fiche ou réessayez plus tard.',429);
    const token=randomUUID();
    previews.set(token,{document,fields,plan:JSON.stringify(plan),expires:now+15*60*1000});
    res.json({token,changes:plan.changes,fields:plan.rows,company:plan.company?.name||plan.legacy?.company||fields.name,
      company_id:plan.company?.id||null,contact_id:plan.contact?.id||null,
      supplementary:document.supplementary,opportunities:document.opportunities,warnings:document.warnings,
      missing:['name','siren','siret','address','postal_code','city','website','general_email','general_phone','display_name','job_title','email','phone'].filter(key=>!fields[key]).map(key=>({key,label:pdfFields[key][0],target:contactFields.has(key)?'contact':'company'}))});
  });
  app.post('/api/pdf-contacts/confirm',(req,res)=>{
    const token=req.body?.token;
    const entry=previews.get(token);
    if(!entry||entry.expires<=Date.now()){previews.delete(token);fail('Aperçu expiré. Rechargez le PDF.',409);}
    const result=transaction(db,()=>{
      const plan=planImport(db,entry.fields);
      if(JSON.stringify(plan)!==entry.plan)fail('Une fiche a changé depuis l’aperçu. Rechargez le PDF.',409);
      const result=applyImport(db,plan,req.body.choices);
      const documents=[
        ['Informations PDF à vérifier',entry.document.supplementary.map(item=>item.label+' : '+item.value).join('\n')],
        ['Hypothèses PDF à confirmer','Opportunités potentielles, non vérifiées. Aucun besoin, score ni intention d’achat établi.\n'+entry.document.opportunities.join('\n')]
      ];
      for(const [kind,detail]of documents){
        if(kind==='Hypothèses PDF à confirmer'&&!entry.document.opportunities.length||!detail)continue;
        if(!db.prepare('SELECT 1 FROM interactions WHERE company_id=? AND kind=? AND detail=?').get(result.company_id,kind,detail))
          db.prepare('INSERT INTO interactions VALUES(?,?,?,?,?,?)').run(randomUUID(),result.company_id,null,kind,detail,new Date().toISOString());
      }
      return result;
    });
    previews.delete(token);
    res.json(result);
  });
}
