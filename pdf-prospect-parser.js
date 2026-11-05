import {EntityError,validateFrenchCompanyIds} from './entities.js';

const canonical=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/\s*\/\s*/gu,'/').replace(/\s+/gu,' ').trim();
export const pdfFields={
 name:['Nom commercial','Nom de la société','Société','Entreprise','Nom de l’entreprise',"Nom de l'entreprise",'Nom'],
 legal_name:['Raison sociale','Dénomination sociale','Dénomination légale'],siren:['SIREN'],siret:['SIRET'],ids:['SIREN / SIRET'],
 website:['Site web','Site internet','Site'],address:['Adresse du siège','Siège social','Siège','Adresse'],
 postal_code:['Code postal'],city:['Ville','Commune'],country:['Pays'],region:['Région','Département'],
 industry:['Secteur / NAF','Secteur','Activité'],naf_code:['Code NAF / APE','Code NAF','Code APE','APE','NAF'],
 company_size:['Effectif','Nombre de salariés','Taille de l’entreprise'],
 display_name:['Dirigeant(e)','Dirigeant','Nom du dirigeant','Nom du contact','Contact','Gérant'],
 first_name:['Prénom du contact','Prénom'],last_name:['Nom de famille du contact','Nom de famille'],job_title:['Fonction','Poste'],
 general_email:['Email général','E-mail général','Email entreprise','Email de l’entreprise','Email professionnel','E-mail professionnel','Adresse email','Adresse e-mail','Email','E-mail','Courriel'],
 general_phone:['Téléphone général','Téléphone entreprise','Téléphone de l’entreprise','Standard téléphonique','Téléphone professionnel','Téléphone','Tél.','Tél'],
 email:['Email du contact','E-mail du contact','Courriel du contact','Email du dirigeant','E-mail du dirigeant','Email direct'],
 phone:['Téléphone du contact','Téléphone du dirigeant','Téléphone direct'],mobile:['Mobile du contact','Mobile du dirigeant','Mobile','Portable'],
 legal_form:['Forme juridique'],legal_status:['Situation juridique','Statut juridique'],source:['Source','Sources'],research_date:['Date de recherche','Date de vérification']
};
export const contactFields=new Set(['display_name','first_name','last_name','job_title','email','phone','mobile']);
const supplementaryKeys=new Set(['legal_form','legal_status','source','research_date']);
const aliases=Object.entries(pdfFields).flatMap(([key,labels])=>labels.map(label=>({key,label:canonical(label)}))).sort((a,b)=>b.label.length-a.label.length);
const missing=value=>/^(?:[-–—]+|n\/?a|non renseigne|non trouvee?|non disponible|inconnu|a rechercher|a confirmer)$/u.test(canonical(value));
const cleanHeading=value=>canonical(value).replace(/^(?:\d+(?:\.\d+)*\s*[.)\-:]?\s+|[ivx]+[.)]\s+)/u,'').replace(/:$/,'');
function section(line){
 const title=cleanHeading(line);
 if(/^(?:identite|identification|informations generales|informations entreprise|coordonnees de l'entreprise|fiche entreprise)(?:\s|$)/.test(title))return 'company';
 if(/^(?:contacts?|dirigeants?|coordonnees (?:du contact|du dirigeant)|interlocuteurs?)(?:\s|$)/.test(title)&&!/[\t:]/.test(line))return 'contact';
 if(/^(?:opportunites?|pistes commerciales?|hypotheses)(?:\s|$)/.test(title)&&!/[\t:]/.test(line))return 'opportunities';
 if(/^(?:sources? et|sources?$|limites|forme juridique$)/.test(title)&&!/[\t:]/.test(line))return 'sources';
 if(/^(?:audit|analyse|diagnostic|besoins?|scores?|preconisations?|synthese|elements publics|points forts|principaux problemes|evaluation|recommandation|premier contact|proposition de|relances?|emails? proposes?)(?:\s|$)/.test(title))return 'ignore';
 if(/^\s*(?:\d+(?:\.\d+)*\s*[.)\-:]\s+|[ivx]+[.)]\s+)/u.test(line))return 'ignore';
 return null;
}
function fieldStart(line){
 const text=canonical(line.replace(/^\s*[•▪]\s*/u,''));
 for(const alias of aliases){
  if(text===alias.label||text===alias.label+':')return {key:alias.key,label:alias.label,value:''};
  if(!text.startsWith(alias.label))continue;
  const remainder=text.slice(alias.label.length);
  // One space after a label is deliberately not enough: it could be prose.
  const original=line.replace(/^\s*[•▪]\s*/u,'').trim();
  const delimiter=original.match(/\s*:\s*|\t+| {2,}|\s*\|\s*/u);
  if(delimiter&&canonical(original.slice(0,delimiter.index))===alias.label)
   return {key:alias.key,label:alias.label,value:original.slice(delimiter.index+delimiter[0].length).trim()};
  if(/^\s*:/u.test(remainder))return {key:alias.key,label:alias.label,value:original.slice(original.indexOf(':')+1).trim()};
 }
 return null;
}
function equalValue(key,a,b){
 if(['email','general_email'].includes(key))return canonical(a)===canonical(b);
 if(['siren','siret','ids','phone','general_phone','mobile'].includes(key))return a.replace(/\s/g,'')===b.replace(/\s/g,'');
 return canonical(a)===canonical(b);
}

export function parseProspectPdf(text){
 const lines=String(text).replace(/\u00a0/g,' ').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const fields={},supplementary=[],opportunities=[],warnings=[],unknown=[];
 let mode='company',pending=null,identityIndex=-1;
 const store=()=>{
  if(!pending)return;
  let {key,parts}=pending;const value=parts.join(' ').trim();pending=null;
  if(!value||missing(value))return;
  if(value.length>2000)throw new EntityError('Champ PDF trop long : '+pdfFields[key][0]);
  if(supplementaryKeys.has(key)){supplementary.push({label:pdfFields[key][0],value});return;}
  if(fields[key]&&!equalValue(key,fields[key],value))throw new EntityError('Plusieurs valeurs pour « '+pdfFields[key][0]+' ». Utilisez un PDF pour une seule entreprise.');
  fields[key]||=value;
 };
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(line==='\f'||/^(?:page\s+\d+(?:\s*\/\s*\d+)?|omni digital\s*[•|].*document.*)$/i.test(line))continue;
  const opportunity=line.match(/^(?:opportunités?(?:\s+(?:potentielles?|commerciales?|à confirmer))?|pistes? commerciales?)\s*:\s*(.+)$/iu);
  if(opportunity&&mode!=='ignore'&&mode!=='sources'){store();mode='opportunities';opportunities.push(opportunity[1]);continue;}
  const start=fieldStart(line),candidateHeading=section(line);
  const heading=start&&!(candidateHeading&&!start.value&&fieldStart(lines[i+1]||''))?null:candidateHeading;
  if(heading){store();mode=heading;if(heading==='company'&&identityIndex<0)identityIndex=i;continue;}
  if(mode==='opportunities'){
   if(opportunities.join('\n').length+line.length>12000)throw new EntityError('La section des opportunités dépasse la taille autorisée.');
   opportunities.push(line);continue;
  }
  if(mode==='sources'){supplementary.push({label:'Source mentionnée dans le PDF (non vérifiée)',value:line});continue;}
  if(mode==='ignore')continue;
  if(start){
   store();let key=start.key;
   if(mode==='contact'&&start.label==='nom')key='last_name';
   if(mode==='contact'&&key==='general_email')key='email';
   if(mode==='contact'&&key==='general_phone')key='phone';
   // A general company label has priority over the surrounding contact section.
   if(/(?:général|entreprise)/iu.test(line.split(/:|\t| {2,}/u)[0]))key=start.key;
   pending={key,parts:start.value?[start.value]:[]};
  }else if(pending){
   // Stop at another table row, even if its label is not in the catalogue.
   if(/\t| {2,}|^[^:]{1,70}:/.test(line)){store();unknown.push(line);}
   else pending.parts.push(line);
  }else if(identityIndex>=0)unknown.push(line);
 }
 store();
 if(fields.ids){
  const match=fields.ids.match(/^([\d\s]+)\s*\/\s*([\d\s]+)$/u);
  if(!match)throw new EntityError('Champ SIREN / SIRET invalide.');
  for(const [key,value]of [['siren',match[1]],['siret',match[2]]]){
   if(fields[key]&&!equalValue(key,fields[key],value))throw new EntityError('Identifiants SIREN / SIRET contradictoires.');
   fields[key]=value.trim();
  }
  delete fields.ids;
 }
 fields.name||=fields.legal_name;
 if(!fields.name&&identityIndex>=0)fields.name=lines.slice(0,identityIndex).map(line=>line.match(/^Prospect\s+\d+\s*[—–-]\s*(.{1,250})$/iu)?.[1]?.trim()).find(Boolean);
 if(!fields.name)throw new EntityError('Entreprise non identifiée dans le PDF. Utilisez un champ « Entreprise », « Raison sociale » ou « Nom de la société » suivi de sa valeur.');
 const location=fields.address?.match(/^(.+?)[,;]\s*(\d{5})\s+([^,;]+)(?:[,;]\s*(.+))?$/u);
 if(location){fields.address=location[1].trim();fields.postal_code||=location[2];fields.city||=location[3].trim();fields.country||=location[4]?.trim()||'';if(!fields.country)delete fields.country;}
 const manager=fields.display_name?.match(/^(.+?)\s*(?:\(([^()]+)\)|[—–]\s+(.+))$/u);
 if(manager){fields.display_name=manager[1].trim();fields.job_title||=(manager[2]||manager[3]).trim();}
 fields.display_name||=[fields.first_name,fields.last_name].filter(Boolean).join(' ');
 if(!fields.display_name)delete fields.display_name;
 const naf=fields.industry?.match(/\b(?:APE|NAF)\s*:?\s*(\d{2}\.\d{2}[A-Z])\b/iu);
 if(naf)fields.naf_code||=naf[1].toUpperCase();
 for(const key of ['email','general_email'])if(fields[key]){
  fields[key]=fields[key].trim().toLowerCase();
  if(!/^[^\s@<>,;]+@[^\s@]+\.[^\s@]+$/u.test(fields[key]))throw new EntityError('Email invalide dans le PDF : '+pdfFields[key][0]);
 }
 if(fields.website){
  if(/^(?:www\.)?[a-z\d][a-z\d.-]*\.[a-z]{2,}(?:[/?#]|$)/i.test(fields.website))fields.website='https://'+fields.website;
  try{const url=new URL(fields.website);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{throw new EntityError('Site internet invalide dans le PDF.');}
 }
 validateFrenchCompanyIds(fields);
 if(!fields.display_name&&!fields.email&&!fields.phone&&!fields.mobile&&(fields.general_email||fields.general_phone)){
  fields.email=fields.general_email||'';fields.phone=fields.general_phone||'';
  if(!fields.email)delete fields.email;if(!fields.phone)delete fields.phone;
  warnings.push('Un contact générique sera créé avec les coordonnées générales de l’entreprise ; aucun dirigeant n’est identifié.');
 }else if(fields.display_name&&(fields.general_email||fields.general_phone))warnings.push('Les coordonnées générales restent sur la fiche Entreprise. Elles ne sont pas attribuées au dirigeant sans mention explicite.');
 for(const line of unknown)supplementary.push({label:'Autre information de la fiche (à vérifier)',value:line});
 return {fields,supplementary,opportunities,warnings};
}
