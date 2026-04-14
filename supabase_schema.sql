-- ============================================================
-- Doneo — Schéma Supabase (PostgreSQL)
-- À exécuter une seule fois dans l'éditeur SQL de Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS tournees (
    id           SERIAL PRIMARY KEY,
    code_complet TEXT UNIQUE NOT NULL,
    nom          TEXT NOT NULL,
    date_tournee TEXT,
    active       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS colis (
    id               SERIAL PRIMARY KEY,
    tournee_id       INTEGER NOT NULL REFERENCES tournees(id) ON DELETE CASCADE,
    numero_colis     TEXT NOT NULL UNIQUE,
    type_prestation  TEXT DEFAULT 'Livraison'
);

CREATE TABLE IF NOT EXISTS scans (
    id                       SERIAL PRIMARY KEY,
    numero_colis             TEXT NOT NULL,
    tournee_selectionnee_id  INTEGER REFERENCES tournees(id),
    tournee_reelle_id        INTEGER REFERENCES tournees(id),
    resultat                 TEXT NOT NULL CHECK (resultat IN ('vert', 'orange', 'rouge')),
    operateur                TEXT,
    timestamp                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS imports (
    id           SERIAL PRIMARY KEY,
    filename     TEXT,
    date_import  TIMESTAMPTZ DEFAULT NOW(),
    nb_tournees  INTEGER DEFAULT 0,
    nb_colis     INTEGER DEFAULT 0
);

-- Index pour performances
CREATE INDEX IF NOT EXISTS idx_colis_numero ON colis(numero_colis);
CREATE INDEX IF NOT EXISTS idx_scans_numero ON scans(numero_colis);
CREATE INDEX IF NOT EXISTS idx_scans_timestamp ON scans(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scans_resultat ON scans(resultat);
