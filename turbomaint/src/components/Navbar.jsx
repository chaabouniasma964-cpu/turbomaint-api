import { useState, useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Accueil' },
  { to: '/console', label: 'Console' },
  { to: '/portail', label: 'Portail' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/contact', label: 'Contact' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Pages avec hero plein écran : transparent en haut, opaque au scroll.
  // Autres pages (dashboards) : navbar toujours opaque pour rester lisible.
  const hasHero = location.pathname === '/' || location.pathname === '/contact'
  const opaque = scrolled || !hasHero

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        backgroundColor: opaque ? 'rgba(0,0,0,0.9)' : 'transparent',
        backdropFilter: opaque ? 'blur(8px)' : 'none',
      }}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-extrabold tracking-tight text-white">
          Turbo<span className="font-light">Maint</span>
        </Link>

        <ul className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `text-sm font-medium tracking-wide text-white transition-opacity hover:opacity-70 ${
                    isActive ? 'opacity-100' : 'opacity-90'
                  }`
                }
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center text-white md:hidden"
          aria-label="Ouvrir le menu"
          aria-expanded={menuOpen}
        >
          <div className="space-y-1.5">
            <span className="block h-0.5 w-6 bg-white" />
            <span className="block h-0.5 w-6 bg-white" />
            <span className="block h-0.5 w-6 bg-white" />
          </div>
        </button>
      </nav>

      {menuOpen && (
        <ul
          className="flex flex-col gap-1 px-6 pb-4 md:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
        >
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.to === '/'}
                className="block py-2 text-sm font-medium text-white hover:opacity-70"
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}
