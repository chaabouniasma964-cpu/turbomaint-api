import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Home from './pages/Home.jsx'
import Admin from './pages/Admin.jsx'
import Client from './pages/Client.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Contact from './pages/Contact.jsx'
import { getUser } from './lib/auth.js'

// Garde d'accès : le portail exige un compte (créé via Sign up sur l'accueil).
// Sans compte, on renvoie vers l'accueil avec le formulaire d'inscription ouvert.
function RequireAuth({ children }) {
  return getUser() ? children : <Navigate to="/?auth=required" replace />
}

export default function App() {
  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Console = espace d'administration / supervision */}
        <Route path="/console" element={<Admin />} />
        {/* Portail = espace utilisateur / opérateur (accès protégé) */}
        <Route path="/portail" element={<RequireAuth><Client /></RequireAuth>} />
        {/* Services maintenance = espace mécanicien (login dédié) */}
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/contact" element={<Contact />} />
        {/* Redirections depuis les anciennes URL */}
        <Route path="/admin" element={<Navigate to="/console" replace />} />
        <Route path="/client" element={<Navigate to="/portail" replace />} />
        {/* Toute autre URL renvoie à l'accueil */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
