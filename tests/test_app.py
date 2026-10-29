import json, tempfile, unittest
from pathlib import Path
import app

class CRMTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.original=app.DB; app.DB=Path(self.tmp.name)/'test.sqlite3'; app.init()
    def tearDown(self): app.DB=self.original; self.tmp.cleanup()
    def test_persistence_and_contextual_draft(self):
        with app.connect() as db:
            db.execute('INSERT INTO prospects(id,company,notes,pdf_text,audit,created) VALUES(?,?,?,?,?,?)',('p','Client','Besoin de visibilité','Rapport : pages lentes',json.dumps({'scores':{'performance':35,'seo':50}}),app.now()))
        with app.connect() as db:
            prospect=db.execute('SELECT * FROM prospects WHERE id="p"').fetchone()
            subject,body=app.draft(prospect)
        self.assertIn('Client',subject); self.assertIn('vitesse',body); self.assertIn('visibilité technique',body); self.assertIn('pages lentes',body); self.assertIn('stop',body)
    def test_no_fabricated_findings(self):
        subject,body=app.draft({'company':'Client','audit':'{}','notes':'','pdf_text':''})
        self.assertNotIn('Une analyse automatisée',body)

if __name__=='__main__': unittest.main()
