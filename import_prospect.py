"""Import local de dossiers PDF OmniDigital, sans publication des données."""
import argparse
import re
import subprocess
from pathlib import Path
import uuid
import app


def extract(path):
    result = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, timeout=30, check=True)
    text = result.stdout.decode('utf-8', errors='replace').strip()
    if not text:
        raise ValueError('PDF sans texte : OCR nécessaire.')
    return text


def field(text, label):
    match = re.search(r'^\s*' + re.escape(label) + r'\s{2,}(.+)$', text, re.M)
    return match.group(1).strip() if match else ''


def import_report(path, company=None, email=None, website=None):
    text = extract(path)
    company = company or field(text, 'Nom')
    email = email or field(text, 'Email')
    website = website or field(text, 'Site web')
    if not company:
        raise ValueError('Entreprise non identifiée : précisez --company.')
    notes = ['Source : ' + Path(path).name + ' (rapport importé ; observations non revérifiées).']
    for label in ['Dirigeant(e)', 'Téléphone', 'Adresse', 'SIREN', 'SIRET (siège)']:
        value = field(text, label)
        if value:
            notes.append(label + ' : ' + value)
    opportunity = re.search(r'Opportunité\s*:\s*([^\n]+)', text)
    if opportunity:
        notes.append('Opportunité selon le rapport : ' + opportunity.group(1).strip())
    app.init()
    with app.connect() as db:
        existing = db.execute('SELECT id FROM prospects WHERE company=? AND COALESCE(email,\'\')=?', (company, email)).fetchone()
        if existing:
            return existing['id'], False
        id = uuid.uuid4().hex
        db.execute('INSERT INTO prospects(id,company,email,website,notes,pdf_text,created) VALUES(?,?,?,?,?,?,?)', (id, company, email, website, '\n'.join(notes), text[:100000], app.now()))
    return id, True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--company')
    parser.add_argument('--email')
    parser.add_argument('--website')
    args = parser.parse_args()
    try:
        id, created = import_report(args.pdf, args.company, args.email, args.website)
        print(('Prospect importé' if created else 'Prospect déjà présent — aucun doublon créé') + ' : ' + id)
        print('Actualisez le CRM. Aucun email envoyé ; aucune analyse Google exécutée.')
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, 'Import impossible : ' + str(error) + '\n')
