"""
Doneo — API Netlify Function
Gestion des tournées CChezVous via Supabase (PostgreSQL)
"""

import json
import os
import re
import base64
import io
import pdfplumber
import psycopg2
from datetime import datetime

DATABASE_URL = os.environ.get('DATABASE_URL', '')

HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
}


def resp(status, data):
    return {
        'statusCode': status,
        'headers': HEADERS,
        'body': json.dumps(data, default=str, ensure_ascii=False),
    }


def get_db():
    return psycopg2.connect(DATABASE_URL)


def parse_pdf_bytes(pdf_bytes):
    results = {}
    current_tournee = None
    date_tournee = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        first_text = pdf.pages[0].extract_text() or ''
        m = re.search(
            r'(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+\d+\s+\w+',
            first_text
        )
        if m:
            date_tournee = m.group(0)

        for page in pdf.pages:
            text = page.extract_text() or ''

            tm = re.search(r'TOURNEE\s*(TA\d+[Cc][Aa][Mm][Ii][Oo][Nn]\S+)', text)
            if tm:
                code = tm.group(1).strip()
                if code not in results:
                    sm = re.search(r'TA\d+[Cc][Aa][Mm][Ii][Oo][Nn](.+)', code, re.IGNORECASE)
                    nom = sm.group(1).upper() if sm else code
                    results[code] = {
                        'code_complet': code,
                        'nom': nom,
                        'date': date_tournee,
                        'colis': [],
                    }
                current_tournee = code

            if not current_tournee:
                continue

            if 'LIVRAISON' in text and 'CHARGEMENT' not in text:
                continue

            lines = text.split('\n')
            for i, line in enumerate(lines):
                bm = re.search(r'\b(LV\d+_\w+)\s+(\d{12,14})\s*$', line)
                if bm:
                    barcode = bm.group(2)
                    type_p = 'Livraison'
                    for j in range(i + 1, min(i + 7, len(lines))):
                        if 'Type prestation' in lines[j]:
                            type_p = 'Reprise' if 'Reprise' in lines[j] else 'Livraison'
                            break
                    existing = [c['numero'] for c in results[current_tournee]['colis']]
                    if barcode not in existing:
                        results[current_tournee]['colis'].append({
                            'numero': barcode,
                            'type': type_p,
                        })

    return results


def handle_import_pdf(body):
    filename = body.get('filename', 'upload.pdf')
    data_b64 = body.get('data')

    if not data_b64:
        return resp(400, {'error': 'Aucune donnée PDF fournie'})

    try:
        pdf_bytes = base64.b64decode(data_b64)
    except Exception:
        return resp(400, {'error': 'Données PDF invalides'})

    try:
        data = parse_pdf_bytes(pdf_bytes)
    except Exception as e:
        return resp(500, {'error': f'Erreur parsing PDF : {str(e)}'})

    nb_tournees = 0
    nb_colis = 0
    details = []

    conn = get_db()
    try:
        cur = conn.cursor()
        for code, info in data.items():
            cur.execute('SELECT id FROM tournees WHERE code_complet = %s', (code,))
            existing = cur.fetchone()

            if existing:
                tournee_id = existing[0]
                details.append(f"Tournée {info['nom']} déjà existante, colis mis à jour")
            else:
                cur.execute(
                    'INSERT INTO tournees (code_complet, nom, date_tournee) VALUES (%s, %s, %s) RETURNING id',
                    (code, info['nom'], info['date'])
                )
                tournee_id = cur.fetchone()[0]
                nb_tournees += 1
                details.append(f"Tournée {info['nom']} créée ({len(info['colis'])} colis)")

            for c in info['colis']:
                cur.execute(
                    '''INSERT INTO colis (tournee_id, numero_colis, type_prestation)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (numero_colis) DO NOTHING''',
                    (tournee_id, c['numero'], c['type'])
                )
                if cur.rowcount:
                    nb_colis += 1

        cur.execute(
            'INSERT INTO imports (filename, nb_tournees, nb_colis) VALUES (%s, %s, %s)',
            (filename, nb_tournees, nb_colis)
        )
        conn.commit()
    finally:
        conn.close()

    return resp(200, {
        'success': True,
        'nb_tournees': nb_tournees,
        'nb_colis': nb_colis,
        'details': details,
        'tournees': [
            {'code': c, 'nom': v['nom'], 'nb_colis': len(v['colis'])}
            for c, v in data.items()
        ],
    })


def handle_get_tournees():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute('''
            SELECT t.id, t.code_complet, t.nom, t.date_tournee, t.active, t.created_at,
                   COUNT(c.id) AS nb_colis,
                   COUNT(CASE WHEN c.type_prestation = 'Livraison' THEN 1 END) AS nb_livraisons,
                   COUNT(CASE WHEN c.type_prestation = 'Reprise'   THEN 1 END) AS nb_reprises
            FROM tournees t
            LEFT JOIN colis c ON c.tournee_id = t.id
            GROUP BY t.id
            ORDER BY t.date_tournee DESC NULLS LAST, t.nom
        ''')
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        return resp(200, rows)
    finally:
        conn.close()


def handle_get_tournee_detail(tournee_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id, code_complet, nom, date_tournee, active FROM tournees WHERE id = %s',
            (tournee_id,)
        )
        row = cur.fetchone()
        if not row:
            return resp(404, {'error': 'Tournée non trouvée'})
        tournee = dict(zip([d[0] for d in cur.description], row))

        cur.execute('''
            SELECT c.id, c.numero_colis, c.type_prestation,
                   s.resultat  AS dernier_scan,
                   s.operateur,
                   s.timestamp AS dernier_scan_at
            FROM colis c
            LEFT JOIN LATERAL (
                SELECT resultat, operateur, timestamp
                FROM   scans
                WHERE  numero_colis = c.numero_colis
                ORDER  BY timestamp DESC
                LIMIT  1
            ) s ON true
            WHERE c.tournee_id = %s
            ORDER BY c.type_prestation, c.numero_colis
        ''', (tournee_id,))
        cols = [d[0] for d in cur.description]
        colis = [dict(zip(cols, r)) for r in cur.fetchall()]

        return resp(200, {'tournee': tournee, 'colis': colis, 'anomalies_externes': []})
    finally:
        conn.close()


def handle_update_tournee(tournee_id, body):
    conn = get_db()
    try:
        cur = conn.cursor()
        if 'nom' in body:
            cur.execute('UPDATE tournees SET nom = %s WHERE id = %s', (body['nom'], tournee_id))
        if 'active' in body:
            cur.execute('UPDATE tournees SET active = %s WHERE id = %s', (body['active'], tournee_id))
        conn.commit()
        return resp(200, {'success': True})
    finally:
        conn.close()


def handle_delete_tournee(tournee_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute('DELETE FROM colis WHERE tournee_id = %s', (tournee_id,))
        cur.execute('DELETE FROM tournees WHERE id = %s', (tournee_id,))
        conn.commit()
        return resp(200, {'success': True})
    finally:
        conn.close()


def handle_scan(body):
    numero     = (body.get('numero_colis') or '').strip()
    tournee_id = body.get('tournee_id')
    operateur  = body.get('operateur', 'Opérateur')

    if not numero or not tournee_id:
        return resp(400, {'error': 'Données manquantes'})

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute('SELECT id, tournee_id FROM colis WHERE numero_colis = %s', (numero,))
        colis = cur.fetchone()

        if not colis:
            cur.execute(
                "INSERT INTO scans (numero_colis, tournee_selectionnee_id, resultat, operateur) "
                "VALUES (%s, %s, 'orange', %s)",
                (numero, tournee_id, operateur)
            )
            conn.commit()
            return resp(200, {
                'resultat': 'orange',
                'message': 'Colis inconnu',
                'detail': f"Le code {numero} n'existe dans aucune tournée.",
                'numero_colis': numero,
            })

        _, colis_tournee_id = colis

        if colis_tournee_id == tournee_id:
            cur.execute(
                "INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur) "
                "VALUES (%s, %s, %s, 'vert', %s)",
                (numero, tournee_id, colis_tournee_id, operateur)
            )
            conn.commit()
            cur.execute('SELECT nom FROM tournees WHERE id = %s', (tournee_id,))
            t = cur.fetchone()
            return resp(200, {
                'resultat': 'vert',
                'message': 'Colis conforme',
                'detail': f'Tournée : {t[0]}',
                'numero_colis': numero,
            })

        else:
            cur.execute('SELECT nom FROM tournees WHERE id = %s', (colis_tournee_id,))
            t_reelle = cur.fetchone()
            cur.execute('SELECT nom FROM tournees WHERE id = %s', (tournee_id,))
            t_sel = cur.fetchone()
            cur.execute(
                "INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur) "
                "VALUES (%s, %s, %s, 'rouge', %s)",
                (numero, tournee_id, colis_tournee_id, operateur)
            )
            conn.commit()
            return resp(200, {
                'resultat': 'rouge',
                'message': 'Mauvaise tournée',
                'detail': f'Ce colis appartient à {t_reelle[0]}, pas à {t_sel[0]}.',
                'numero_colis': numero,
                'tournee_reelle': t_reelle[0],
            })
    finally:
        conn.close()


def handle_get_anomalies():
    conn = get_db()
    try:
        cur = conn.cursor()

        cur.execute('''
            SELECT s.numero_colis, s.timestamp, s.operateur,
                   ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle
            FROM   scans s
            LEFT JOIN tournees ts ON ts.id = s.tournee_selectionnee_id
            LEFT JOIN tournees tr ON tr.id = s.tournee_reelle_id
            WHERE  s.resultat = 'rouge'
            ORDER  BY s.timestamp DESC LIMIT 100
        ''')
        cols = [d[0] for d in cur.description]
        mauvaise = [dict(zip(cols, r)) for r in cur.fetchall()]

        cur.execute('''
            SELECT s.numero_colis, s.timestamp, s.operateur,
                   ts.nom AS tournee_selectionnee
            FROM   scans s
            LEFT JOIN tournees ts ON ts.id = s.tournee_selectionnee_id
            WHERE  s.resultat = 'orange'
            ORDER  BY s.timestamp DESC LIMIT 100
        ''')
        cols = [d[0] for d in cur.description]
        inconnus = [dict(zip(cols, r)) for r in cur.fetchall()]

        cur.execute('''
            SELECT
                COUNT(DISTINCT CASE WHEN resultat = 'vert'   THEN numero_colis END) AS scans_ok,
                COUNT(DISTINCT CASE WHEN resultat = 'rouge'  THEN numero_colis END) AS scans_rouge,
                COUNT(DISTINCT CASE WHEN resultat = 'orange' THEN numero_colis END) AS scans_orange,
                COUNT(*) AS total_scans
            FROM scans
        ''')
        cols = [d[0] for d in cur.description]
        stats = dict(zip(cols, cur.fetchone()))

        return resp(200, {'mauvaise_tournee': mauvaise, 'inconnus': inconnus, 'stats': stats})
    finally:
        conn.close()


def handle_get_historique(qs):
    limit = int((qs or {}).get('limit', 200))
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute('''
            SELECT s.id, s.numero_colis, s.resultat, s.operateur, s.timestamp,
                   ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle
            FROM   scans s
            LEFT JOIN tournees ts ON ts.id = s.tournee_selectionnee_id
            LEFT JOIN tournees tr ON tr.id = s.tournee_reelle_id
            ORDER  BY s.timestamp DESC
            LIMIT  %s
        ''', (limit,))
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return resp(200, rows)
    finally:
        conn.close()


def handle_get_imports():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT id, filename, date_import, nb_tournees, nb_colis FROM imports '
            'ORDER BY date_import DESC LIMIT 20'
        )
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return resp(200, rows)
    finally:
        conn.close()


def handle_reset_scans():
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute('DELETE FROM scans')
        conn.commit()
        return resp(200, {'success': True})
    finally:
        conn.close()


def handler(event, context):
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': HEADERS, 'body': ''}

    if not DATABASE_URL:
        return resp(500, {'error': 'DATABASE_URL non configurée. Voir guide de déploiement.'})

    raw_path = event.get('path', '/')
    api_path  = re.sub(r'^/api', '', raw_path)
    api_path  = re.sub(r'^/\.netlify/functions/api', '', api_path)
    if not api_path:
        api_path = '/'

    body = {}
    raw_body = event.get('body') or ''
    if raw_body:
        if event.get('isBase64Encoded'):
            raw_body = base64.b64decode(raw_body).decode('utf-8')
        try:
            body = json.loads(raw_body)
        except Exception:
            pass

    qs = event.get('queryStringParameters') or {}

    try:
        if api_path == '/import-pdf' and method == 'POST':
            return handle_import_pdf(body)
        elif api_path == '/tournees' and method == 'GET':
            return handle_get_tournees()
        elif re.match(r'^/tournees/\d+$', api_path):
            tid = int(api_path.split('/')[-1])
            if method == 'GET':      return handle_get_tournee_detail(tid)
            elif method == 'PUT':    return handle_update_tournee(tid, body)
            elif method == 'DELETE': return handle_delete_tournee(tid)
        elif api_path == '/scan' and method == 'POST':
            return handle_scan(body)
        elif api_path == '/anomalies' and method == 'GET':
            return handle_get_anomalies()
        elif api_path == '/historique' and method == 'GET':
            return handle_get_historique(qs)
        elif api_path == '/imports' and method == 'GET':
            return handle_get_imports()
        elif api_path == '/reset-scans' and method == 'POST':
            return handle_reset_scans()
        else:
            return resp(404, {'error': f'Route inconnue : {api_path}'})
    except Exception as e:
        return resp(500, {'error': str(e)})
