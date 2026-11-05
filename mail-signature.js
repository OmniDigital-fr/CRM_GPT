import {readFileSync} from 'node:fs';

// Original image recovered from CRM1. Emails embed their own copy (no remote URL).
const image=readFileSync(new URL('./assets/mail-signature.png',import.meta.url));
export const SIGNATURE_TEXT='Paulo Da Costa\nFondateur & Consultant digital\nOmni Digital · +33 6 78 00 59 83\ncontact@omnidigital.fr · Le Perreux Sur Marne · https://omnidigital.fr';
const cid='omni-digital-signature@crm2.omnidigital.fr';
export const SIGNATURE_HTML=`<div style="margin:16px 0"><a href="https://omnidigital.fr"><img src="cid:${cid}" width="400" height="200" style="display:block;max-width:100%;height:auto;border:0" alt="Paulo Da Costa — Fondateur &amp; Consultant digital — Omni Digital — +33 6 78 00 59 83 — contact@omnidigital.fr — omnidigital.fr"></a></div>`;

export function signedMessage(body,customHtml=''){
 const clean=body.replaceAll(SIGNATURE_TEXT,'').replace(/\n\nOmniDigital\nhttps:\/\/omnidigital\.fr(?=\n\n|$)/g,'');
 const footer=clean.indexOf('\n\nSi vous ne souhaitez plus être contacté');
 const before=(footer<0?clean:clean.slice(0,footer)).trimEnd(),after=footer<0?'':clean.slice(footer);
 const escape=value=>value.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/\n/g,'<br>');
 return {
  text:before+'\n\n'+SIGNATURE_TEXT+after,
  html:'<div>'+escape(before)+'</div>'+(customHtml||SIGNATURE_HTML)+(after?'<div>'+escape(after)+'</div>':''),
  attachments:customHtml?[]:[{filename:'signature-omni-digital.png',content:image,contentType:'image/png',cid,contentDisposition:'inline'}]
 };
}
