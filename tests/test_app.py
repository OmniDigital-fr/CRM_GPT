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

    def test_contact_edit_preserves_report_and_status(self):
        with app.connect() as db:
            id=app.save_contact(db,{'company':'Entreprise','contact_name':'Marie','phone':'01 23 45 67 89','city':'Orsay','priority':'Haute','next_followup':'2026-11-03'})
            db.execute("UPDATE prospects SET pdf_text='Rapport conservé',status='Qualifié' WHERE id=?",(id,))
        with app.connect() as db:
            data=dict(db.execute('SELECT * FROM prospects WHERE id=?',(id,)).fetchone())
            data['phone']='09 87 65 43 21'
            app.save_contact(db,data,id)
        with app.connect() as db:
            p=db.execute('SELECT * FROM prospects WHERE id=?',(id,)).fetchone()
            self.assertEqual(p['phone'],'09 87 65 43 21')
            self.assertEqual(p['contact_name'],'Marie')
            self.assertEqual(p['pdf_text'],'Rapport conservé')
            self.assertEqual(p['status'],'Qualifié')
        app.init()  # repeated migrations must preserve records
        with app.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM prospects').fetchone()[0],1)

    def test_invalid_contact_is_rejected(self):
        with app.connect() as db:
            for data in ({'company':''},{'company':'A','website':'javascript:test'},{'company':'A','next_followup':'2026-99-01'}):
                with self.assertRaises(ValueError): app.save_contact(db,data)

if __name__=='__main__': unittest.main()
