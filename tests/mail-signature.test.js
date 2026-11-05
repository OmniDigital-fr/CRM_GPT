import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
import {readFileSync} from 'node:fs';
import {signedMessage,SIGNATURE_TEXT} from '../mail-signature.js';

test('original signature is embedded once, before opt-out, with readable text fallback',async()=>{
 const body='Bonjour <dirigeant>,\n\nCordialement,\n\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus être contacté, répondez stop.';
 const parts=signedMessage(body);
 assert.equal(parts.attachments.length,1);
 assert.equal((parts.html.match(/<img /g)||[]).length,1);
 assert.ok(parts.html.indexOf('<img ')<parts.html.indexOf('Si vous ne souhaitez'));
 assert.match(parts.html,/Bonjour &lt;dirigeant&gt;/);
 assert.doesNotMatch(parts.html,/crm\.omnidigital\.fr|src="https:/);
 assert.equal(parts.text.split(SIGNATURE_TEXT).length,2);
 assert.doesNotMatch(parts.text,/\nOmniDigital\n/);
 assert.equal(signedMessage(parts.text).text,parts.text);
 // Exercise real MIME assembly without connecting to SMTP or sending any email.
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true});
 const result=await transport.sendMail({from:'sender@example.fr',to:'test@example.fr',subject:'Test simulé',...parts});
 const parsed=await simpleParser(result.message);
 assert.match(parsed.text,/contact@omnidigital.fr/);
 assert.equal(parsed.attachments.length,1);
 assert.equal(parsed.attachments[0].contentDisposition,'inline');
 assert.equal(parsed.attachments[0].cid,parts.attachments[0].cid);
 assert.deepEqual(parsed.attachments[0].content,readFileSync(new URL('../assets/mail-signature.png',import.meta.url)));
});

test('custom HTML override preserves text fallback without the default image',()=>{
 const result=signedMessage('Merci pour votre retour.','<p>Signature personnalisée</p>');
 assert.match(result.html,/Signature personnalisée/);
 assert.doesNotMatch(result.html,/<img/);
 assert.equal(result.attachments.length,0);
 assert.match(result.text,/Paulo Da Costa/);
});
