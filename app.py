import json, os, sqlite3, subprocess, tempfile, uuid, urllib.request, urllib.parse
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
DATA = Path(os.environ.get('CRM_DATA_DIR', ROOT / '.data'))
DATA.mkdir(exist_ok=True, parents=True)
DB = DATA / 'crm.sqlite3'
CONTACT_FIELDS = ('contact_name','job_title','phone','mobile','address','address2','postal_code','city','country','siren','industry','source','source_date','priority','next_followup','needs','services')

def contact_values(data):
    values = {key: str(data.get(key, '')).strip() for key in ('company','email','website','notes') + CONTACT_FIELDS}
    if not values['company']: raise ValueError('Le nom de l’entreprise est requis.')
    if any(len(value)>20000 for value in values.values()): raise ValueError('Un champ dépasse la taille maximale.')
    if values['email'] and ('@' not in values['email'] or any(c.isspace() for c in values['email'])): raise ValueError('Adresse email invalide.')
    if values['website'] and urllib.parse.urlsplit(values['website']).scheme not in ('http','https'): raise ValueError('Le site doit commencer par https:// ou http://.')
    if values['priority'] not in ('','Faible','Moyenne','Haute'): raise ValueError('Priorité invalide.')
    for key in ('source_date','next_followup'):
        if values[key]:
            try: datetime.strptime(values[key], '%Y-%m-%d')
            except ValueError: raise ValueError('Date invalide : ' + key)
    return values


def save_contact(db, data, id=None):
    values = contact_values(data)
    if id:
        if not db.execute('UPDATE prospects SET '+','.join(key+'=?' for key in values)+' WHERE id=?', (*values.values(),id)).rowcount:
            raise ValueError('Prospect introuvable.')
        return id
    id = uuid.uuid4().hex
    values.update(id=id,created=now())
    db.execute('INSERT INTO prospects('+','.join(values)+') VALUES('+','.join('?' for _ in values)+')',tuple(values.values()))
    return id


def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db

def init():
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS prospects(id TEXT PRIMARY KEY, company TEXT NOT NULL, email TEXT, website TEXT, status TEXT NOT NULL DEFAULT 'Nouveau', notes TEXT DEFAULT '', pdf_text TEXT DEFAULT '', audit TEXT DEFAULT '{}', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL REFERENCES prospects(id), subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Brouillon', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), kind TEXT NOT NULL, created TEXT NOT NULL);
        ''')
        columns = {row['name'] for row in db.execute('PRAGMA table_info(prospects)')}
        for name in CONTACT_FIELDS:
            if name not in columns:
                db.execute('ALTER TABLE prospects ADD COLUMN '+name+" TEXT NOT NULL DEFAULT ''")

def now(): return datetime.now(timezone.utc).isoformat()
def records(db, sql, args=()): return [dict(r) for r in db.execute(sql, args)]

def draft(prospect):
    audit = json.loads(prospect['audit'])
    scores = audit.get('scores', {})
    findings = []
    if scores.get('performance', 100) < 70: findings.append('la vitesse de chargement de votre site')
    if scores.get('seo', 100) < 80: findings.append('la visibilité technique de votre site sur les moteurs de recherche')
    if scores.get('accessibility', 100) < 80: findings.append('l’accessibilité de votre parcours en ligne')
    details = dict(prospect)
    evidence = '\n'.join(x for x in [details.get('needs',''), details.get('services',''), prospect['notes'], prospect['pdf_text'][:6000]] if x)
    focus = ', '.join(findings) if findings else 'les possibilités d’amélioration de votre présence en ligne'
    body = f"Bonjour,\n\nJe vous contacte au nom d’OmniDigital au sujet de {prospect['company']}. Nous accompagnons les entreprises dans la création de sites web et leur marketing digital.\n\n"
    if findings: body += f"Une analyse automatisée de votre site suggère des pistes concernant {focus}. Ces résultats méritent une vérification avec votre contexte métier.\n\n"
    else: body += f"Nous souhaitons échanger avec vous sur {focus}, en fonction de vos priorités.\n\n"
    if evidence: body += f"Éléments du dossier à vérifier et reformuler avant envoi :\n{evidence[:1200]}\n\n"
    body += 'Seriez-vous disponible pour un échange de 15 minutes afin d’identifier les actions les plus utiles pour votre activité ?\n\nOmniDigital\nhttps://omnidigital.fr\n\nSi vous ne souhaitez plus être contacté, répondez simplement « stop ».'
    return f"{prospect['company']} — pistes pour votre présence digitale", body

class Handler(BaseHTTPRequestHandler):
    def reply(self, value, code=200):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/state':
            with connect() as db:
                prospects = records(db,'SELECT * FROM prospects ORDER BY created DESC')
                messages = records(db,'SELECT m.*, p.company FROM messages m JOIN prospects p ON p.id=m.prospect_id ORDER BY m.created DESC')
                counts = dict(db.execute('SELECT kind, COUNT(DISTINCT message_id) FROM events GROUP BY kind').fetchall())
            sent = sum(m['status']=='Envoyé' for m in messages)
            self.reply(dict(prospects=prospects,messages=messages,metrics=dict(sent=sent,opened=counts.get('open',0),clicked=counts.get('click',0),replied=counts.get('reply',0)), integrations={'pagespeed': bool(os.environ.get('PAGESPEED_API_KEY')), 'email':False})); return
        files = {'/':'index.html','/style.css':'style.css','/app.js':'app.js'}
        if path not in files: self.reply({'error':'Introuvable'},404); return
        file = ROOT/'static'/files[path]
        self.send_response(200); self.send_header('Content-Type',{'html':'text/html; charset=utf-8','css':'text/css','js':'text/javascript'}[file.suffix[1:]]); self.end_headers(); self.wfile.write(file.read_bytes())
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length > 12*1024*1024: raise ValueError('Fichier trop volumineux (12 Mo maximum).')
            raw = self.rfile.read(length)
            path = urllib.parse.urlsplit(self.path).path
            if path == '/api/import-pdf':
                if not raw.startswith(b'%PDF-'): raise ValueError('Un fichier PDF est requis.')
                from import_prospect import import_report
                with tempfile.TemporaryDirectory() as tmp:
                    pdf = Path(tmp)/'rapport.pdf'
                    pdf.write_bytes(raw)
                    id, created = import_report(pdf)
                self.reply({'id':id,'created':created},201 if created else 200)
                return
            if path.endswith('/pdf'):
                if not raw.startswith(b'%PDF-'): raise ValueError('Un fichier PDF est requis.')
                with tempfile.TemporaryDirectory() as tmp:
                    pdf = Path(tmp)/'input.pdf'; pdf.write_bytes(raw)
                    result = subprocess.run(['pdftotext','-layout',str(pdf),'-'],capture_output=True,timeout=30)
                    if result.returncode: raise ValueError('Extraction PDF impossible.')
                    content = result.stdout.decode('utf-8', errors='replace').strip()
                    if not content: raise ValueError('PDF sans texte : OCR nécessaire pour ce document scanné.')
                id = path.split('/')[3]
                with connect() as db:
                    if not db.execute('UPDATE prospects SET pdf_text=? WHERE id=?',(content[:100000],id)).rowcount: raise ValueError('Prospect introuvable.')
                self.reply({'ok':True,'characters':len(content)}); return
            data = json.loads(raw or b'{}')
            with connect() as db:
                if path == '/api/prospects':
                    id = save_contact(db, data)
                    self.reply({'id':id},201); return
                parts = path.strip('/').split('/')
                if len(parts)==4 and parts[:2]==['api','prospects']:
                    id, action = parts[2:]
                    p = db.execute('SELECT * FROM prospects WHERE id=?',(id,)).fetchone()
                    if not p: raise ValueError('Prospect introuvable.')
                    if action == 'update':
                        save_contact(db, data, id)
                    elif action == 'status':
                        if data.get('status') not in ['Nouveau','Qualifié','Contacté','Gagné','Perdu','Opposition']: raise ValueError('Statut invalide.')
                        db.execute('UPDATE prospects SET status=? WHERE id=?',(data['status'],id))
                    elif action == 'draft':
                        if p['status']=='Opposition': raise ValueError('Ce prospect s’oppose aux sollicitations.')
                        subject, body = draft(p)
                        db.execute('INSERT INTO messages(id,prospect_id,subject,body,created) VALUES(?,?,?,?,?)',(uuid.uuid4().hex,id,subject,body,now()))
                    elif action == 'audit':
                        key = os.environ.get('PAGESPEED_API_KEY')
                        if not key: raise ValueError('Configurez PAGESPEED_API_KEY pour lancer une analyse Google.')
                        url = p['website']
                        if urllib.parse.urlsplit(url).scheme not in ('http','https'): raise ValueError('URL du site invalide : utilisez https://.')
                        query = urllib.parse.urlencode([('url',url),('strategy','mobile'),('key',key),('category','performance'),('category','seo'),('category','accessibility'),('category','best-practices')])
                        try:
                            with urllib.request.urlopen('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?'+query,timeout=100) as response: audit=json.load(response)
                        except Exception: raise ValueError('Google PageSpeed indisponible : vérifiez la clé, les quotas et l’accès réseau.')
                        lighthouse=audit.get('lighthouseResult',{})
                        if not lighthouse.get('categories'): raise ValueError('Google n’a pas renvoyé d’analyse exploitable.')
                        summary={'scores':{k:round(v['score']*100) for k,v in lighthouse['categories'].items() if v.get('score') is not None},'date':now(),'url':url,'strategy':'mobile','opportunities':[{'title':v['title'],'description':v.get('description','')} for v in lighthouse.get('audits',{}).values() if v.get('details',{}).get('type')=='opportunity' and v.get('score') is not None and v['score']<1]}
                        db.execute('UPDATE prospects SET audit=? WHERE id=?',(json.dumps(summary),id))
                    else: self.reply({'error':'Action inconnue'},404); return
                    self.reply({'ok':True}); return
            self.reply({'error':'Introuvable'},404)
        except (ValueError, subprocess.SubprocessError, FileNotFoundError) as e: self.reply({'error':str(e)},400)
        except Exception: self.reply({'error':'Erreur interne. Consultez la configuration du serveur.'},500)

if __name__ == '__main__':
    init()
    print('OmniDigital CRM — serveur local sur le port '+os.environ.get('PORT','8000'),flush=True)
    ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('PORT','8000'))),Handler).serve_forever()
