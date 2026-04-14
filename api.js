const { Pool } = require('pg');
const pdfParse = require('pdf-parse');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function resp(status, data) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(data) };
}

function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
}

async function parsePdf(buffer) {
  const results = {};
  let currentTournee = null;
  let dateTournee = null;
  const pages = [];

  const renderPage = (pageData) =>
    pageData.getTextContent({ normalizeWhitespace: true }).then((tc) => {
      const lineMap = {};
      for (const item of tc.items) {
        const y = Math.round(item.transform[5]);
        if (!lineMap[y]) lineMap[y] = [];
        lineMap[y].push({ x: item.transform[4], str: item.str });
      }
      const ys = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
      const text = ys.map(y => lineMap[y].sort((a, b) => a.x - b.x).map(i => i.str).join(' ')).join('\n');
      pages.push(text);
      return text;
    });

  await pdfParse(buffer, { pagerender: renderPage });

  for (let i = 0; i < pages.length; i++) {
    const text = pages[i];
    if (i === 0 && !dateTournee) {
      const dm = text.match(/(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+\d+\s+\w+/);
      if (dm) dateTournee = dm[0];
    }
    const tm = text.match(/TOURNEE\s*(TA\d+[Cc][Aa][Mm][Ii][Oo][Nn]\S+)/);
    if (tm) {
      const code = tm[1].trim();
      if (!results[code]) {
        const sm = code.match(/TA\d+[Cc][Aa][Mm][Ii][Oo][Nn](.+)/i);
        results[code] = { code_complet: code, nom: sm ? sm[1].toUpperCase() : code, date: dateTournee, colis: [] };
      }
      currentTournee = code;
    }
    if (!currentTournee) continue;
    if (text.includes('LIVRAISON') && !text.includes('CHARGEMENT')) continue;
    const lines = text.split('\n');
    for (let j = 0; j < lines.length; j++) {
      const bm = lines[j].match(/\b(LV\d+_\w+)\s+(\d{12,14})\s*$/);
      if (bm) {
        const barcode = bm[2];
        let type = 'Livraison';
        for (let k = j + 1; k < Math.min(j + 7, lines.length); k++) {
          if (lines[k].includes('Type prestation')) {
            type = lines[k].includes('Reprise') ? 'Reprise' : 'Livraison';
            break;
          }
        }
        if (!results[currentTournee].colis.find(c => c.numero === barcode))
          results[currentTournee].colis.push({ numero: barcode, type });
      }
    }
  }
  return results;
}

async function handleImportPdf(body) {
  if (!body.data) return resp(400, { error: 'Aucune donnée PDF fournie' });
  const buffer = Buffer.from(body.data, 'base64');
  let data;
  try { data = await parsePdf(buffer); } catch (e) { return resp(500, { error: `Erreur parsing PDF : ${e.message}` }); }
  const pool = getPool();
  const client = await pool.connect();
  let nbTournees = 0, nbColis = 0;
  const details = [];
  try {
    await client.query('BEGIN');
    for (const [code, info] of Object.entries(data)) {
      const ex = await client.query('SELECT id FROM tournees WHERE code_complet = $1', [code]);
      let tid;
      if (ex.rows.length) {
        tid = ex.rows[0].id;
        details.push(`Tournée ${info.nom} déjà existante`);
      } else {
        const r = await client.query('INSERT INTO tournees (code_complet, nom, date_tournee) VALUES ($1,$2,$3) RETURNING id', [code, info.nom, info.date]);
        tid = r.rows[0].id; nbTournees++;
        details.push(`Tournée ${info.nom} créée (${info.colis.length} colis)`);
      }
      for (const c of info.colis) {
        const r = await client.query('INSERT INTO colis (tournee_id, numero_colis, type_prestation) VALUES ($1,$2,$3) ON CONFLICT (numero_colis) DO NOTHING', [tid, c.numero, c.type]);
        if (r.rowCount) nbColis++;
      }
    }
    await client.query('INSERT INTO imports (filename, nb_tournees, nb_colis) VALUES ($1,$2,$3)', [body.filename || 'upload.pdf', nbTournees, nbColis]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await pool.end(); }
  return resp(200, { success: true, nb_tournees: nbTournees, nb_colis: nbColis, details, tournees: Object.entries(data).map(([c,v]) => ({code: c, nom: v.nom, nb_colis: v.colis.length})) });
}

async function handleGetTournees() {
  const pool = getPool();
  try {
    const r = await pool.query(`SELECT t.id, t.code_complet, t.nom, t.date_tournee, t.active, t.created_at, COUNT(c.id) AS nb_colis, COUNT(CASE WHEN c.type_prestation='Livraison' THEN 1 END) AS nb_livraisons, COUNT(CASE WHEN c.type_prestation='Reprise' THEN 1 END) AS nb_reprises FROM tournees t LEFT JOIN colis c ON c.tournee_id=t.id GROUP BY t.id ORDER BY t.date_tournee DESC NULLS LAST, t.nom`);
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleGetTourneeDetail(id) {
  const pool = getPool();
  try {
    const t = await pool.query('SELECT * FROM tournees WHERE id=$1', [id]);
    if (!t.rows.length) return resp(404, { error: 'Tournée non trouvée' });
    const c = await pool.query(`SELECT c.id, c.numero_colis, c.type_prestation, s.resultat AS dernier_scan, s.operateur, s.timestamp AS dernier_scan_at FROM colis c LEFT JOIN LATERAL (SELECT resultat, operateur, timestamp FROM scans WHERE numero_colis=c.numero_colis ORDER BY timestamp DESC LIMIT 1) s ON true WHERE c.tournee_id=$1 ORDER BY c.type_prestation, c.numero_colis`, [id]);
    return resp(200, { tournee: t.rows[0], colis: c.rows, anomalies_externes: [] });
  } finally { await pool.end(); }
}

async function handleUpdateTournee(id, body) {
  const pool = getPool();
  try {
    if (body.nom !== undefined) await pool.query('UPDATE tournees SET nom=$1 WHERE id=$2', [body.nom, id]);
    if (body.active !== undefined) await pool.query('UPDATE tournees SET active=$1 WHERE id=$2', [body.active, id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

async function handleDeleteTournee(id) {
  const pool = getPool();
  try {
    await pool.query('DELETE FROM colis WHERE tournee_id=$1', [id]);
    await pool.query('DELETE FROM tournees WHERE id=$1', [id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

async function handleScan(body) {
  const { numero_colis: numero, tournee_id: tourneeId, operateur = 'Opérateur' } = body;
  if (!numero || !tourneeId) return resp(400, { error: 'Données manquantes' });
  const pool = getPool();
  try {
    const colis = await pool.query('SELECT id, tournee_id FROM colis WHERE numero_colis=$1', [numero]);
    if (!colis.rows.length) {
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, resultat, operateur) VALUES ($1,$2,'orange',$3)", [numero, tourneeId, operateur]);
      return resp(200, { resultat: 'orange', message: 'Colis inconnu', detail: `Le code ${numero} n'existe dans aucune tournée.`, numero_colis: numero });
    }
    const colisT = colis.rows[0].tournee_id;
    if (colisT === tourneeId) {
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur) VALUES ($1,$2,$3,'vert',$4)", [numero, tourneeId, colisT, operateur]);
      const t = await pool.query('SELECT nom FROM tournees WHERE id=$1', [tourneeId]);
      return resp(200, { resultat: 'vert', message: 'Colis conforme', detail: `Tournée : ${t.rows[0].nom}`, numero_colis: numero });
    } else {
      const tr = await pool.query('SELECT nom FROM tournees WHERE id=$1', [colisT]);
      const ts = await pool.query('SELECT nom FROM tournees WHERE id=$1', [tourneeId]);
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur) VALUES ($1,$2,$3,'rouge',$4)", [numero, tourneeId, colisT, operateur]);
      return resp(200, { resultat: 'rouge', message: 'Mauvaise tournée', detail: `Ce colis appartient à ${tr.rows[0].nom}, pas à ${ts.rows[0].nom}.`, numero_colis: numero, tournee_reelle: tr.rows[0].nom });
    }
  } finally { await pool.end(); }
}

async function handleGetAnomalies() {
  const pool = getPool();
  try {
    const rouge = await pool.query(`SELECT s.numero_colis, s.timestamp, s.operateur, ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id LEFT JOIN tournees tr ON tr.id=s.tournee_reelle_id WHERE s.resultat='rouge' ORDER BY s.timestamp DESC LIMIT 100`);
    const orange = await pool.query(`SELECT s.numero_colis, s.timestamp, s.operateur, ts.nom AS tournee_selectionnee FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id WHERE s.resultat='orange' ORDER BY s.timestamp DESC LIMIT 100`);
    const stats = await pool.query(`SELECT COUNT(DISTINCT CASE WHEN resultat='vert' THEN numero_colis END) AS scans_ok, COUNT(DISTINCT CASE WHEN resultat='rouge' THEN numero_colis END) AS scans_rouge, COUNT(DISTINCT CASE WHEN resultat='orange' THEN numero_colis END) AS scans_orange, COUNT(*) AS total_scans FROM scans`);
    return resp(200, { mauvaise_tournee: rouge.rows, inconnus: orange.rows, stats: stats.rows[0] });
  } finally { await pool.end(); }
}

async function handleGetHistorique(qs) {
  const pool = getPool();
  try {
    const r = await pool.query(`SELECT s.id, s.numero_colis, s.resultat, s.operateur, s.timestamp, ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id LEFT JOIN tournees tr ON tr.id=s.tournee_reelle_id ORDER BY s.timestamp DESC LIMIT $1`, [parseInt(qs.limit || '200')]);
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleGetImports() {
  const pool = getPool();
  try {
    const r = await pool.query('SELECT id, filename, date_import, nb_tournees, nb_colis FROM imports ORDER BY date_import DESC LIMIT 20');
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleResetScans() {
  const pool = getPool();
  try { await pool.query('DELETE FROM scans'); return resp(200, { success: true }); }
  finally { await pool.end(); }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (!process.env.DATABASE_URL) return resp(500, { error: 'DATABASE_URL non configurée.' });

  let apiPath = (event.path || '/').replace(/^\/api/, '').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  let body = {};
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
    try { body = JSON.parse(raw); } catch (e) {}
  }
  const qs = event.queryStringParameters || {};
  const m = apiPath.match(/^\/tournees\/(\d+)$/);

  try {
    if (apiPath === '/import-pdf' && event.httpMethod === 'POST') return await handleImportPdf(body);
    if (apiPath === '/tournees' && event.httpMethod === 'GET') return await handleGetTournees();
    if (m && event.httpMethod === 'GET') return await handleGetTourneeDetail(parseInt(m[1]));
    if (m && event.httpMethod === 'PUT') return await handleUpdateTournee(parseInt(m[1]), body);
    if (m && event.httpMethod === 'DELETE') return await handleDeleteTournee(parseInt(m[1]));
    if (apiPath === '/scan' && event.httpMethod === 'POST') return await handleScan(body);
    if (apiPath === '/anomalies' && event.httpMethod === 'GET') return await handleGetAnomalies();
    if (apiPath === '/historique' && event.httpMethod === 'GET') return await handleGetHistorique(qs);
    if (apiPath === '/imports' && event.httpMethod === 'GET') return await handleGetImports();
    if (apiPath === '/reset-scans' && event.httpMethod === 'POST') return await handleResetScans();
    return resp(404, { error: `Route inconnue : ${apiPath}` });
  } catch (e) { return resp(500, { error: e.message }); }
};
