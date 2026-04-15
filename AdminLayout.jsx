import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import {
  LayoutDashboard, Truck, Upload, Users, Search, FileSearch, LogOut, Menu, X
} from 'lucide-react'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
  { to: '/admin/tours', label: 'Tournées', icon: <Truck size={16} /> },
  { to: '/admin/upload', label: 'Importer un PDF', icon: <Upload size={16} /> },
]

const navItems2 = [
  { to: '/admin/search-parcel', label: 'Recherche colis', icon: <Search size={16} /> },
  { to: '/admin/search-tours', label: 'Recherche tournées', icon: <FileSearch size={16} /> },
  { to: '/admin/users', label: 'Utilisateurs', icon: <Users size={16} /> },
]

export default function AdminLayout() {
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

  function closeSidebar() { setSidebarOpen(false) }

  return (
    <div className="app-layout">

      {/* Overlay mobile */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={closeSidebar}
      />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>CCV<span>.</span></h1>
            <p>Administration</p>
          </div>
          <button className="sidebar-close" onClick={closeSidebar}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Principal</span>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          <span className="sidebar-section-label" style={{ marginTop: '8px' }}>Outils</span>
          {navItems2.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Administrateur</div>
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
