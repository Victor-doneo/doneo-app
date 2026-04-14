const { Pool } = require('pg');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function resp(status, data) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(data) };
}
function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verify;
}
async function validateToken(token, pool) {
  if (!token) return null;
  const r = await pool.query(
    `SELECT s.user_id, u.username, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.active = true`,
    [token]
  );
  return r.rows[0] || null;
}
function getToken(event) {
  const auth = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
  return auth.replace('Bearer ', '').trim() || null;
}

// ── PDF PARSER ────────────────────────────────────────────────────────────────
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
    const tm = text.match(/TOURNEE\s*([Tt][Aa]\d+[Cc][Aa][Mm][Ii][Oo][Nn]\S+)/);
    if (tm) {
      const code = tm[1].trim();
      if (!results[code]) {
        const sm = code.match(/[Tt][Aa]\d+[Cc][Aa][Mm][Ii][Oo][Nn](.+)/i);
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
          if (lines[k].includes('Type prestation')) { type = lines[k].includes('Reprise') ? 'Reprise' : 'Livraison'; break; }
        }
        if (!results[currentTournee].colis.find(c => c.numero === barcode))
          results[currentTournee].colis.push({ numero: barcode, type });
      }
    }
  }
  return results;
}

// ── HANDLERS AUTH ─────────────────────────────────────────────────────────────
async function handleLogin(body) {
  const { username, password } = body;
  if (!username || !password) return resp(400, { error: 'Identifiants manquants' });
  const pool = getPool();
  try {
    const r = await pool.query('SELECT * FROM users WHERE username = $1 AND active = true', [username.trim()]);
    if (!r.rows.length) return resp(401, { error: 'Identifiants incorrects' });
    const user = r.rows[0];
    if (!verifyPassword(password, user.password_hash)) return resp(401, { error: 'Identifiants incorrects' });
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, token, expires]);
    return resp(200, { token, role: user.role, username: user.username });
  } finally { await pool.end(); }
}

async function handleCreateUser(body, user) {
  const pool = getPool();
  try {
    // Bootstrap: allow if no users exist yet
    const count = await pool.query('SELECT COUNT(*) FROM users');
    const isBootstrap = parseInt(count.rows[0].count) === 0;
    if (!isBootstrap && (!user || user.role !== 'admin')) return resp(403, { error: 'Accès refusé' });
    const { username, password, role = 'operateur' } = body;
    if (!username || !password) return resp(400, { error: 'Champs manquants' });
    const hash = hashPassword(password);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, active, created_at',
      [username.trim(), hash, role]
    );
    return resp(200, r.rows[0]);
  } finally { await pool.end(); }
}

async function handleGetUsers(user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    const r = await pool.query('SELECT id, username, role, active, created_at FROM users ORDER BY role, username');
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleUpdateUser(id, body, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    if (body.password) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(body.password), id]);
    }
    if (body.active !== undefined) await pool.query('UPDATE users SET active = $1 WHERE id = $2', [body.active, id]);
    if (body.role) await pool.query('UPDATE users SET role = $1 WHERE id = $2', [body.role, id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

async function handleDeleteUser(id, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

// ── HANDLERS IMPORT ───────────────────────────────────────────────────────────
async function handleImportPdf(body, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
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
      if (ex.rows.length) { tid = ex.rows[0].id; details.push(`Tournée ${info.nom} déjà existante`); }
      else {
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

// ── HANDLERS TOURNÉES ─────────────────────────────────────────────────────────
async function handleGetTournees(user) {
  if (!user) return resp(401, { error: 'Non authentifié' });
  const pool = getPool();
  try {
    const r = await pool.query(`SELECT t.id, t.code_complet, t.nom, t.date_tournee, t.active, t.created_at,
      COUNT(c.id) AS nb_colis,
      COUNT(CASE WHEN c.type_prestation='Livraison' THEN 1 END) AS nb_livraisons,
      COUNT(CASE WHEN c.type_prestation='Reprise' THEN 1 END) AS nb_reprises
      FROM tournees t LEFT JOIN colis c ON c.tournee_id=t.id
      GROUP BY t.id ORDER BY t.date_tournee DESC NULLS LAST, t.nom`);
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleGetTourneeDetail(id, user) {
  if (!user) return resp(401, { error: 'Non authentifié' });
  const pool = getPool();
  try {
    const t = await pool.query('SELECT * FROM tournees WHERE id=$1', [id]);
    if (!t.rows.length) return resp(404, { error: 'Tournée non trouvée' });
    const c = await pool.query(`
      SELECT c.id, c.numero_colis, c.type_prestation,
             s.resultat AS dernier_scan, s.operateur, s.timestamp AS dernier_scan_at
      FROM colis c
      LEFT JOIN LATERAL (
        SELECT resultat, operateur, timestamp FROM scans
        WHERE numero_colis=c.numero_colis AND tournee_selectionnee_id=$1
        ORDER BY timestamp DESC LIMIT 1
      ) s ON true
      WHERE c.tournee_id=$1
      ORDER BY c.type_prestation, c.numero_colis`, [id]);
    return resp(200, { tournee: t.rows[0], colis: c.rows, anomalies_externes: [] });
  } finally { await pool.end(); }
}

async function handleUpdateTournee(id, body, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    if (body.nom !== undefined) await pool.query('UPDATE tournees SET nom=$1 WHERE id=$2', [body.nom, id]);
    if (body.active !== undefined) await pool.query('UPDATE tournees SET active=$1 WHERE id=$2', [body.active, id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

async function handleDeleteTournee(id, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    await pool.query('DELETE FROM colis WHERE tournee_id=$1', [id]);
    await pool.query('DELETE FROM tournees WHERE id=$1', [id]);
    return resp(200, { success: true });
  } finally { await pool.end(); }
}

// ── HANDLER SCAN ──────────────────────────────────────────────────────────────
async function handleScan(body, user) {
  if (!user) return resp(401, { error: 'Non authentifié' });
  const { numero_colis: numero, tournee_id: tourneeId } = body;
  const operateur = user.username;
  const userId = user.user_id;
  if (!numero || !tourneeId) return resp(400, { error: 'Données manquantes' });

  const pool = getPool();
  try {
    // Vérifier si déjà scanné correctement dans cette tournée
    const already = await pool.query(
      "SELECT id FROM scans WHERE numero_colis=$1 AND tournee_selectionnee_id=$2 AND resultat='vert'",
      [numero, tourneeId]
    );
    if (already.rows.length) {
      await pool.query(
        "INSERT INTO scans (numero_colis, tournee_selectionnee_id, resultat, operateur, user_id) VALUES ($1,$2,'bleu',$3,$4)",
        [numero, tourneeId, operateur, userId]
      );
      return resp(200, { resultat: 'bleu', message: 'Déjà scanné', detail: `Ce colis a déjà été vérifié dans cette tournée.`, numero_colis: numero });
    }

    const colis = await pool.query('SELECT id, tournee_id FROM colis WHERE numero_colis=$1', [numero]);
    if (!colis.rows.length) {
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, resultat, operateur, user_id) VALUES ($1,$2,'orange',$3,$4)", [numero, tourneeId, operateur, userId]);
      return resp(200, { resultat: 'orange', message: 'Colis inconnu', detail: `Le code ${numero} n'existe dans aucune tournée.`, numero_colis: numero });
    }

    const colisT = colis.rows[0].tournee_id;
    if (colisT === tourneeId) {
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur, user_id) VALUES ($1,$2,$3,'vert',$4,$5)", [numero, tourneeId, colisT, operateur, userId]);
      const t = await pool.query('SELECT nom FROM tournees WHERE id=$1', [tourneeId]);
      return resp(200, { resultat: 'vert', message: 'Colis conforme', detail: `Tournée : ${t.rows[0].nom}`, numero_colis: numero });
    } else {
      const tr = await pool.query('SELECT nom FROM tournees WHERE id=$1', [colisT]);
      const ts = await pool.query('SELECT nom FROM tournees WHERE id=$1', [tourneeId]);
      await pool.query("INSERT INTO scans (numero_colis, tournee_selectionnee_id, tournee_reelle_id, resultat, operateur, user_id) VALUES ($1,$2,$3,'rouge',$4,$5)", [numero, tourneeId, colisT, operateur, userId]);
      return resp(200, { resultat: 'rouge', message: 'Mauvaise tournée', detail: `Ce colis appartient à ${tr.rows[0].nom}, pas à ${ts.rows[0].nom}.`, numero_colis: numero, tournee_reelle: tr.rows[0].nom });
    }
  } finally { await pool.end(); }
}

// ── HANDLER RÉSUMÉ TOURNÉE ────────────────────────────────────────────────────
async function handleGetResumeTournee(tourneeId, user) {
  if (!user) return resp(401, { error: 'Non authentifié' });
  const pool = getPool();
  try {
    const livraisons = await pool.query(
      "SELECT numero_colis FROM colis WHERE tournee_id=$1 AND type_prestation='Livraison'", [tourneeId]
    );
    const scannedOk = await pool.query(
      "SELECT DISTINCT numero_colis FROM scans WHERE tournee_selectionnee_id=$1 AND resultat='vert'", [tourneeId]
    );
    const scannedErreur = await pool.query(
      "SELECT DISTINCT numero_colis FROM scans WHERE tournee_selectionnee_id=$1 AND resultat='rouge'", [tourneeId]
    );
    const livraisonsSet = new Set(livraisons.rows.map(r => r.numero_colis));
    const okSet = new Set(scannedOk.rows.map(r => r.numero_colis));
    const manquants = [...livraisonsSet].filter(n => !okSet.has(n));
    return resp(200, {
      total_livraisons: livraisonsSet.size,
      ok: okSet.size,
      erreurs: scannedErreur.rows.length,
      manquants: manquants.length,
      manquants_list: manquants,
    });
  } finally { await pool.end(); }
}

// ── AUTRES HANDLERS ───────────────────────────────────────────────────────────
async function handleGetAnomalies(user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    const rouge = await pool.query(`SELECT s.numero_colis, s.timestamp, s.operateur, ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id LEFT JOIN tournees tr ON tr.id=s.tournee_reelle_id WHERE s.resultat='rouge' ORDER BY s.timestamp DESC LIMIT 100`);
    const orange = await pool.query(`SELECT s.numero_colis, s.timestamp, s.operateur, ts.nom AS tournee_selectionnee FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id WHERE s.resultat='orange' ORDER BY s.timestamp DESC LIMIT 100`);
    const stats = await pool.query(`SELECT COUNT(DISTINCT CASE WHEN resultat='vert' THEN numero_colis END) AS scans_ok, COUNT(DISTINCT CASE WHEN resultat='rouge' THEN numero_colis END) AS scans_rouge, COUNT(DISTINCT CASE WHEN resultat='orange' THEN numero_colis END) AS scans_orange, COUNT(*) AS total_scans FROM scans`);
    return resp(200, { mauvaise_tournee: rouge.rows, inconnus: orange.rows, stats: stats.rows[0] });
  } finally { await pool.end(); }
}

async function handleGetHistorique(qs, user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    const r = await pool.query(`SELECT s.id, s.numero_colis, s.resultat, s.operateur, s.timestamp, ts.nom AS tournee_selectionnee, tr.nom AS tournee_reelle FROM scans s LEFT JOIN tournees ts ON ts.id=s.tournee_selectionnee_id LEFT JOIN tournees tr ON tr.id=s.tournee_reelle_id ORDER BY s.timestamp DESC LIMIT $1`, [parseInt(qs.limit || '200')]);
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleGetImports(user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try {
    const r = await pool.query('SELECT id, filename, date_import, nb_tournees, nb_colis FROM imports ORDER BY date_import DESC LIMIT 20');
    return resp(200, r.rows);
  } finally { await pool.end(); }
}

async function handleResetScans(user) {
  if (!user || user.role !== 'admin') return resp(403, { error: 'Accès refusé' });
  const pool = getPool();
  try { await pool.query('DELETE FROM scans'); return resp(200, { success: true }); }
  finally { await pool.end(); }
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
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

  // Récupérer l'utilisateur authentifié
  const token = getToken(event);
  let currentUser = null;
  if (token) {
    const pool = getPool();
    try { currentUser = await validateToken(token, pool); } finally { await pool.end(); }
  }

  const m = apiPath.match(/^\/tournees\/(\d+)$/);
  const mResume = apiPath.match(/^\/tournees\/(\d+)\/resume$/);

  try {
    // Auth routes (publiques)
    if (apiPath === '/auth/login' && event.httpMethod === 'POST') return await handleLogin(body);

    // User routes
    if (apiPath === '/users' && event.httpMethod === 'GET') return await handleGetUsers(currentUser);
    if (apiPath === '/users' && event.httpMethod === 'POST') return await handleCreateUser(body, currentUser);
    const mUser = apiPath.match(/^\/users\/(\d+)$/);
    if (mUser && event.httpMethod === 'PUT') return await handleUpdateUser(parseInt(mUser[1]), body, currentUser);
    if (mUser && event.httpMethod === 'DELETE') return await handleDeleteUser(parseInt(mUser[1]), currentUser);

    // Import
    if (apiPath === '/import-pdf' && event.httpMethod === 'POST') return await handleImportPdf(body, currentUser);

    // Tournées
    if (apiPath === '/tournees' && event.httpMethod === 'GET') return await handleGetTournees(currentUser);
    if (mResume && event.httpMethod === 'GET') return await handleGetResumeTournee(parseInt(mResume[1]), currentUser);
    if (m && event.httpMethod === 'GET') return await handleGetTourneeDetail(parseInt(m[1]), currentUser);
    if (m && event.httpMethod === 'PUT') return await handleUpdateTournee(parseInt(m[1]), body, currentUser);
    if (m && event.httpMethod === 'DELETE') return await handleDeleteTournee(parseInt(m[1]), body, currentUser);

    // Scan
    if (apiPath === '/scan' && event.httpMethod === 'POST') return await handleScan(body, currentUser);

    // Admin
    if (apiPath === '/anomalies' && event.httpMethod === 'GET') return await handleGetAnomalies(currentUser);
    if (apiPath === '/historique' && event.httpMethod === 'GET') return await handleGetHistorique(qs, currentUser);
    if (apiPath === '/imports' && event.httpMethod === 'GET') return await handleGetImports(currentUser);
    if (apiPath === '/reset-scans' && event.httpMethod === 'POST') return await handleResetScans(currentUser);

    return resp(404, { error: `Route inconnue : ${apiPath}` });
  } catch (e) { return resp(500, { error: e.message }); }
};
