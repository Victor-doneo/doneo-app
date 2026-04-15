import { useState } from 'react'
import { useAuth } from './AuthContext'
import { Package, BarChart3, Users, CheckCircle } from 'lucide-react'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) {
      setError('Email ou mot de passe incorrect.')
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Panneau gauche (caché sur mobile) ── */}
      <div style={{
        width: '320px',
        flexShrink: 0,
        background: 'var(--navy)',
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 36px',
        position: 'relative',
        overflow: 'hidden',
      }}
        className="login-left-panel"
      >
        <div style={{
          position: 'absolute', top: '-100px', left: '-100px',
          width: '300px', height: '300px',
          background: 'radial-gradient(circle, rgba(79,70,229,0.3) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ marginBottom: 'auto' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: '26px',
            fontWeight: 800, color: 'white', letterSpacing: '-0.5px', marginBottom: '4px'
          }}>
            CCV<span style={{ color: 'var(--accent)' }}>.</span>
          </h1>
          <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
            Contrôle des tournées
          </p>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginBottom: '48px' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: '28px',
            fontWeight: 800, color: 'white', lineHeight: 1.2, marginBottom: '12px'
          }}>
            Gérez vos <span style={{ color: 'var(--accent)' }}>tournées</span> efficacement.
          </h2>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: '24px' }}>
            Vérifiez les colis, détectez les anomalies et suivez les contrôles en temps réel.
          </p>

          {[
            { icon: <BarChart3 size={15} />, text: 'Dashboard & statistiques en direct' },
            { icon: <Package size={15} />, text: 'Scan et contrôle des colis par tournée' },
            { icon: <CheckCircle size={15} />, text: 'Détection automatique des anomalies' },
            { icon: <Users size={15} />, text: 'Gestion des opérateurs et historique' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
              <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{item.icon}</span>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>{item.text}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)' }}>
          © 2026 CCV — Contrôle des tournées
        </p>
      </div>

      {/* ── Panneau droit (formulaire) ── */}
      <div style={{
        flex: 1,
        background: 'var(--gray-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        minHeight: '100vh',
      }}>

        {/* Logo visible uniquement sur mobile */}
        <div className="login-mobile-logo">
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: '28px',
            fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.5px',
            marginBottom: '4px',
          }}>
            CCV<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--gray-400)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '32px' }}>
            Contrôle des tournées
          </div>
        </div>

        <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '36px 32px' }}>
          <h3 style={{
            fontFamily: 'var(--font-display)', fontSize: '22px',
            fontWeight: 700, color: 'var(--gray-800)', marginBottom: '6px'
          }}>
            Connexion
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--gray-400)', marginBottom: '28px' }}>
            Accédez à votre espace de travail
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Adresse email</label>
              <input
                type="email"
                className="form-input"
                placeholder="vous@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Mot de passe</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div style={{
                background: 'var(--red-light)', color: '#991b1b',
                padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg w-full"
              disabled={loading}
              style={{ justifyContent: 'center', marginTop: '4px' }}
            >
              {loading ? <div className="spinner" /> : '→ Se connecter'}
            </button>
          </form>

          <p style={{ fontSize: '12px', color: 'var(--gray-400)', textAlign: 'center', marginTop: '20px' }}>
            Accès réservé aux utilisateurs <strong style={{ color: 'var(--accent)' }}>autorisés</strong>
          </p>
        </div>
      </div>

      {/* ── Styles responsive login ── */}
      <style>{`
        .login-mobile-logo { display: none; }

        @media (max-width: 768px) {
          .login-left-panel { display: none !important; }
          .login-mobile-logo { display: block; text-align: center; }
        }

        @media (max-width: 420px) {
          .card { padding: 24px 20px !important; }
        }
      `}</style>
    </div>
  )
}
