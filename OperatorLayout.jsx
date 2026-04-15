import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { LogOut, Menu, X } from 'lucide-react'

export default function OperatorLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-layout">

      {/* Overlay mobile */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>CCV<span>.</span></h1>
            <p>Opérateur</p>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
            <div style={{
              fontSize: '48px', fontFamily: 'var(--font-display)',
              fontWeight: 800, color: 'rgba(255,255,255,0.08)', lineHeight: 1
            }}>
              SCAN
            </div>
            <div style={{ fontSize: '12px', marginTop: '8px', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Mode opérateur
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Opérateur</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Topbar mobile */}
        <div className="mobile-topbar">
          <button className="btn-menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <span className="mobile-topbar-logo">CCV<span>.</span></span>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
            {initials}
          </div>
        </div>

        <Outlet />
      </main>
    </div>
  )
}
