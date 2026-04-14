# Guide de déploiement — Doneo sur Netlify

Durée estimée : **15 minutes** (une seule fois)

---

## Étape 1 — Créer la base de données Supabase (gratuit)

1. Allez sur [supabase.com](https://supabase.com) → **Start your project**
2. Créez un compte (GitHub ou email)
3. Cliquez **New Project** :
   - Nom : `doneo`
   - Mot de passe DB : choisissez-en un fort (notez-le !)
   - Région : **West EU (Ireland)** ou la plus proche
4. Attendez 1-2 minutes que le projet démarre
5. Dans le menu gauche → **SQL Editor** → **New query**
6. Copiez-collez le contenu du fichier `supabase_schema.sql` et cliquez **Run**
7. Récupérez l'URL de connexion :
   - Menu gauche → **Settings** → **Database**
   - Section **Connection string** → mode **URI**
   - Copiez la chaîne (commence par `postgresql://postgres:...`)
   - **Remplacez `[YOUR-PASSWORD]` par votre mot de passe**

---

## Étape 2 — Déployer sur Netlify

### Option A : Via GitHub (recommandée)

1. Créez un compte sur [github.com](https://github.com) si besoin
2. Créez un nouveau repository (ex: `doneo-app`) et uploadez tous les fichiers
3. Allez sur [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
4. Sélectionnez votre repository GitHub
5. Netlify détecte automatiquement `netlify.toml` → cliquez **Deploy**

### Option B : Drag & Drop (plus simple)

1. Allez sur [netlify.com](https://netlify.com) → connectez-vous
2. Sur le dashboard → glissez-déposez le dossier **entier** `doneo-netlify/`
   > ⚠️ Drag & drop ne supporte pas les Netlify Functions. Utilisez GitHub pour une install complète.

---

## Étape 3 — Configurer la variable d'environnement

1. Dans Netlify → votre site → **Site configuration** → **Environment variables**
2. Cliquez **Add a variable** :
   - Key : `DATABASE_URL`
   - Value : la chaîne PostgreSQL copiée à l'étape 1
3. Cliquez **Save** puis **Trigger deploy** pour redéployer

---

## Étape 4 — Tester

1. Ouvrez l'URL Netlify de votre site (ex: `https://doneo-xyz.netlify.app`)
2. Admin : importez votre PDF de tournée
3. Opérateur (mobile) : ouvrez la même URL depuis le téléphone

---

## Structure des fichiers

```
doneo-netlify/
├── netlify.toml                  ← Configuration Netlify (redirects)
├── supabase_schema.sql           ← À exécuter dans Supabase une fois
├── public/                       ← Pages web (hébergées statiquement)
│   ├── index.html                  Page d'accueil
│   ├── admin.html                  Back-office admin
│   └── operateur.html              Interface opérateur mobile
└── netlify/functions/api/        ← API serverless Python
    ├── api.py                      Toute la logique métier
    └── requirements.txt            pdfplumber + psycopg2
```

---

## Limites à connaître

| Contrainte | Valeur | Impact |
|---|---|---|
| Taille PDF uploadable | ≤ 4.5 MB | Compresser si nécessaire sur ilovepdf.com |
| Timeout API | 10 secondes | Suffisant pour la plupart des PDFs |
| Requêtes/mois (Netlify gratuit) | 125 000 | Très largement suffisant |
| DB Supabase (gratuit) | 500 MB | Suffisant pour des années d'utilisation |

---

## Dépannage

**"DATABASE_URL non configurée"** → Vérifiez la variable d'environnement dans Netlify et redéployez.

**"Erreur parsing PDF"** → Vérifiez que le PDF est bien généré par le logiciel CChezVous (texte natif, pas un scan).

**Timeout sur PDF volumineux** → Compressez le PDF ou divisez-le en plusieurs fichiers par batch de tournées.
