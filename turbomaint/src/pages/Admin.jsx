import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  diagnostiquer,
  classifierRUL,
  niveauStyle,
  niveauHex,
} from '../lib/diagnostic.js'
import { getMecaniciens, addMecanicien, getOrdres } from '../lib/atelier.js'
import { apiListeClients, apiMajStatutClient, apiSupprimerClient } from '../lib/api.js'
import { IconeUtilisateur } from '../components/Icones.jsx'

// Moteurs : on ne stocke que l'ID et le RUL prédit ; le niveau est
// dérivé par le module de diagnostic IA (cohérence garantie).
const enginesRaw = [
  { id: 'FD001-012', rul: 118 },
  { id: 'FD001-047', rul: 64 },
  { id: 'FD001-003', rul: 22 },
  { id: 'FD001-088', rul: 101 },
  { id: 'FD001-056', rul: 38 },
  { id: 'FD001-071', rul: 14 },
  { id: 'FD001-029', rul: 95 },
  { id: 'FD001-064', rul: 47 },
  { id: 'FD001-015', rul: 130 },
  { id: 'FD001-082', rul: 55 },
  { id: 'FD001-007', rul: 31 },
  { id: 'FD001-093', rul: 9 },
]
const engines = enginesRaw.map((e) => ({ ...e, niveau: classifierRUL(e.rul) }))

const navItems = ['Vue d’ensemble', 'Clients', 'Moteurs', 'Mécaniciens']

// Image de fond de la console (aviation), affichée floutée
const CONSOLE_BG =
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1600&q=80'

const inputClass =
  'w-full rounded-md border border-white/15 bg-neutral-900 px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400'

export default function Admin() {
  const [active, setActive] = useState('Vue d’ensemble')

  return (
    <div className="relative min-h-screen pt-[64px]">
      {/* Fond aviation légèrement flouté + voile sombre pour la lisibilité */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage: `url(${CONSOLE_BG})`,
          filter: 'blur(6px)',
          transform: 'scale(1.06)',
        }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10"
        style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
      />

      <div className="flex min-h-screen">
        <aside className="glass hidden w-64 shrink-0 flex-col border-y-0 border-l-0 border-r border-white/10 px-5 py-8 md:flex">
          <div className="mb-8 px-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
            Console
          </div>
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => (
              <button
                key={item}
                onClick={() => setActive(item)}
                className={`block w-full rounded-md px-4 py-2.5 text-left text-sm font-medium transition ${
                  active === item ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
          <Link to="/" className="mt-6 rounded-md px-4 py-2.5 text-sm font-medium text-white/50 hover:text-white">
            ← Retour au site
          </Link>
        </aside>

        <main className="flex-1 px-6 py-10 md:px-10">
          {active === 'Vue d’ensemble' && <Overview />}
          {active === 'Clients' && <Clients />}
          {active === 'Moteurs' && <MoteursView />}
          {active === 'Mécaniciens' && <Mecaniciens />}
        </main>
      </div>
    </div>
  )
}

/* ---------- DONUT SVG (répartition par niveau) ---------- */
function Donut({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0
  return (
    <svg viewBox="0 0 120 120" className="h-44 w-44">
      <g transform="rotate(-90 60 60)">
        {data.map((d, i) => {
          const len = (d.value / total) * C
          const seg = (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          )
          offset += len
          return seg
        })}
      </g>
      <text x="60" y="57" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="700">{total}</text>
      <text x="60" y="72" textAnchor="middle" fill="#9ca3af" fontSize="8">moteurs</text>
    </svg>
  )
}

/* ---------- VUE D'ENSEMBLE ---------- */
function Overview() {
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState('TOUS')
  const [tri, setTri] = useState('rul-asc')

  const niveaux = ['Sain', 'Dégradation', 'Critique']
  const repartition = niveaux.map((n) => ({
    label: n,
    value: engines.filter((e) => e.niveau === n).length,
    color: niveauHex[n],
  }))

  // Indicateurs de la plateforme : clients, moteurs, équipe maintenance
  const [clients, setClients] = useState([])
  const [mecs, setMecs] = useState([])
  useEffect(() => {
    apiListeClients().then(setClients).catch(() => {})
    getMecaniciens().then(setMecs).catch(() => {})
  }, [])

  const clientsActifs = clients.filter((c) => c.statut === 'Actif').length
  const clientsEnAttente = clients.length - clientsActifs
  const kpis = [
    { label: 'Clients actifs', value: clientsActifs, sub: `sur ${clients.length} comptes` },
    { label: 'Clients en attente', value: clientsEnAttente, sub: 'comptes suspendus' },
    { label: 'Moteurs suivis', value: engines.length, sub: 'flotte supervisée' },
    { label: 'Mécaniciens', value: mecs.length, sub: `${mecs.filter((m) => m.disponible).length} disponibles` },
  ]

  const moteursAffiches = useMemo(() => {
    let list = engines.filter((e) => e.id.toLowerCase().includes(recherche.toLowerCase()))
    if (filtre !== 'TOUS') list = list.filter((e) => e.niveau === filtre)
    list = [...list].sort((a, b) => (tri === 'rul-asc' ? a.rul - b.rul : b.rul - a.rul))
    return list
  }, [recherche, filtre, tri])

  const exporterCSV = () => {
    const head = ['ID', 'RUL', 'Niveau', 'Maintenance estimée']
    const lignes = moteursAffiches.map((e) => {
      const d = diagnostiquer(e.rul)
      return [e.id, e.rul, d.niveau, d.dateMaintenance].join(',')
    })
    const csv = [head.join(','), ...lignes].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'moteurs_turbomaint.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white md:text-3xl">Vue d’ensemble de la flotte</h1>
        <p className="mt-1 text-sm text-white/50">Supervision temps réel, prédiction RUL et diagnostic IA.</p>
      </header>

      {/* KPIs */}
      <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-white/10 bg-neutral-900/70 backdrop-blur-sm p-5">
            <div className="text-xs uppercase tracking-wider text-white/50">{k.label}</div>
            <div className="mt-3 text-3xl font-bold text-white">{k.value}</div>
            <div className="mt-1 text-xs text-white/40">{k.sub}</div>
          </div>
        ))}
      </section>

      {/* Santé de la flotte (répartition par niveau) */}
      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-neutral-900/70 backdrop-blur-sm p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Santé de la flotte</h2>
          <div className="flex items-center gap-6">
            <Donut data={repartition} />
            <ul className="space-y-2 text-sm">
              {repartition.map((r) => (
                <li key={r.label} className="flex items-center gap-2 text-white/80">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
                  {r.label} <span className="text-white/40">· {r.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Tableau moteurs */}
      <div>
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-lg font-semibold text-white">Moteurs</h2>
            <input className={`${inputClass} w-44`} placeholder="Rechercher ID…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            <select className={`${inputClass} w-40`} value={filtre} onChange={(e) => setFiltre(e.target.value)}>
              <option value="TOUS">Tous niveaux</option>
              {niveaux.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select className={`${inputClass} w-40`} value={tri} onChange={(e) => setTri(e.target.value)}>
              <option value="rul-asc">RUL croissant</option>
              <option value="rul-desc">RUL décroissant</option>
            </select>
            <button onClick={exporterCSV} className="rounded-md border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10">
              Export CSV
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-white/50">
                <tr>
                  <th className="px-5 py-3 font-medium uppercase tracking-wider">ID moteur</th>
                  <th className="px-5 py-3 font-medium uppercase tracking-wider">RUL</th>
                  <th className="px-5 py-3 font-medium uppercase tracking-wider">Niveau</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-neutral-950">
                {moteursAffiches.map((e) => (
                  <tr key={e.id} className="transition hover:bg-white/5">
                    <td className="px-5 py-3.5 font-mono text-white">{e.id}</td>
                    <td className="px-5 py-3.5 text-white/80">{e.rul}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${niveauStyle[e.niveau]}`}>{e.niveau}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </>
  )
}

/* ---------- VUE MOTEURS (raccourci vers la même table détaillée) ---------- */
function MoteursView() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white md:text-3xl">Parc moteurs</h1>
        <p className="mt-1 text-sm text-white/50">Liste complète avec diagnostic IA par moteur.</p>
      </header>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-white/50">
            <tr>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">ID</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">RUL</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Niveau</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Maintenance estimée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-neutral-950">
            {engines.map((e) => {
              const d = diagnostiquer(e.rul)
              return (
                <tr key={e.id} className="hover:bg-white/5">
                  <td className="px-5 py-3.5 font-mono text-white">{e.id}</td>
                  <td className="px-5 py-3.5 text-white/80">{e.rul}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${niveauStyle[e.niveau]}`}>{e.niveau}</span>
                  </td>
                  <td className="px-5 py-3.5 text-white/70">{d.dateMaintenance}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------- GESTION DES CLIENTS ---------- */
function Clients() {
  const [clients, setClients] = useState([])
  const [recherche, setRecherche] = useState('')

  const charger = async () => setClients(await apiListeClients())
  useEffect(() => {
    charger()
  }, [])

  const filtres = clients.filter((c) => {
    const q = recherche.toLowerCase()
    return c.nom.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  const supprimer = async (email) => {
    const client = clients.find((c) => c.email === email)
    if (window.confirm(`Supprimer le client « ${client.nom} » ? Cette action est définitive.`)) {
      await apiSupprimerClient(email)
      await charger()
    }
  }
  const basculerStatut = async (email) => {
    const c = clients.find((x) => x.email === email)
    await apiMajStatutClient(email, c.statut === 'Actif' ? 'Suspendu' : 'Actif')
    await charger()
  }

  const actifs = clients.filter((c) => c.statut === 'Actif').length

  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white md:text-3xl">Gestion des clients</h1>
        <p className="mt-1 text-sm text-white/50">
          Consultez, suspendez ou supprimez les comptes clients. Les comptes sont
          créés par les clients eux-mêmes à l’inscription sur le site.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Total clients', value: clients.length },
          { label: 'Actifs', value: actifs },
          { label: 'Suspendus', value: clients.length - actifs },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-neutral-900/70 backdrop-blur-sm p-4">
            <div className="text-xs uppercase tracking-wider text-white/50">{s.label}</div>
            <div className="mt-2 text-2xl font-bold text-white">{s.value}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 max-w-sm">
        <input className={inputClass} placeholder="Rechercher par nom ou email…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-neutral-900 text-white/50">
            <tr>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Client</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Email</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Téléphone</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Moteur</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Statut</th>
              <th className="px-5 py-3 text-right font-medium uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-neutral-950">
            {filtres.map((c) => (
              <tr key={c.email} className="hover:bg-white/5">
                <td className="px-5 py-3.5 font-medium text-white">{c.nom}</td>
                <td className="px-5 py-3.5 text-white/70">{c.email}</td>
                <td className="px-5 py-3.5 text-white/70">{c.telephone}</td>
                <td className="px-5 py-3.5 font-mono text-white/80">{c.nb_moteurs} moteur{c.nb_moteurs > 1 ? 's' : ''}</td>
                <td className="px-5 py-3.5">
                  <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${
                    c.statut === 'Actif' ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400' : 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                  }`}>{c.statut}</span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => basculerStatut(c.email)} className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10">
                      {c.statut === 'Actif' ? 'Suspendre' : 'Réactiver'}
                    </button>
                    <button onClick={() => supprimer(c.email)} className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-500/20">
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtres.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-white/40">Aucun client ne correspond à votre recherche.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------- ATELIER : MÉCANICIENS + ORDRES DE MAINTENANCE ---------- */
function Mecaniciens() {
  const [mecs, setMecs] = useState([])
  const [ordres, setOrdres] = useState([])
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [nouveau, setNouveau] = useState({ nom: '', specialite: '', login: '', motDePasse: '' })

  const rafraichir = async () => {
    const [ms, ords] = await Promise.all([getMecaniciens(), getOrdres()])
    setMecs(ms)
    setOrdres(ords)
  }

  useEffect(() => {
    rafraichir()
  }, [])

  const enCours = (id) =>
    ordres.filter((o) => o.mecanicienId === id && ['en_attente', 'en_maintenance'].includes(o.statut)).length
  const prets = (id) => ordres.filter((o) => o.mecanicienId === id && o.statut === 'pret').length

  const ajouter = async () => {
    if (!nouveau.nom.trim()) return
    await addMecanicien({
      nom: nouveau.nom.trim(),
      specialite: nouveau.specialite.trim(),
      login: nouveau.login,
      motDePasse: nouveau.motDePasse,
    })
    setNouveau({ nom: '', specialite: '', login: '', motDePasse: '' })
    setAjoutOuvert(false)
    await rafraichir()
  }

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

  const disponibles = mecs.filter((m) => m.disponible).length
  const moteursEnAtelier = ordres.filter((o) => ['en_attente', 'en_maintenance'].includes(o.statut)).length
  const moteursPrets = ordres.filter((o) => o.statut === 'pret').length

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">Département mécaniciens</h1>
          <p className="mt-1 text-sm text-white/50">
            Équipe de l’atelier, disponibilités et moteurs en maintenance.
          </p>
        </div>
        <button
          onClick={() => setAjoutOuvert((v) => !v)}
          className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
        >
          {ajoutOuvert ? 'Annuler' : '+ Ajouter un mécanicien'}
        </button>
      </header>

      {/* Indicateurs de l'atelier */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Mécaniciens', value: mecs.length },
          { label: 'Disponibles', value: disponibles },
          { label: 'Moteurs en atelier', value: moteursEnAtelier },
          { label: 'Moteurs prêts', value: moteursPrets },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-neutral-900/70 p-4 backdrop-blur-sm">
            <div className="text-xs uppercase tracking-wider text-white/50">{s.label}</div>
            <div className="mt-2 text-2xl font-bold text-white">{s.value}</div>
          </div>
        ))}
      </section>

      {ajoutOuvert && (
        <section className="mb-6 rounded-xl border border-white/10 bg-black p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/70">
            Nouveau mécanicien
          </h2>
          <div className="grid gap-4 md:grid-cols-5">
            <input
              className={inputClass}
              placeholder="Nom complet"
              value={nouveau.nom}
              onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Spécialité (ex. Compresseur HP)"
              value={nouveau.specialite}
              onChange={(e) => setNouveau({ ...nouveau, specialite: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Login (ex. karim)"
              value={nouveau.login}
              onChange={(e) => setNouveau({ ...nouveau, login: e.target.value })}
            />
            <input
              className={inputClass}
              type="password"
              placeholder="Mot de passe"
              value={nouveau.motDePasse}
              onChange={(e) => setNouveau({ ...nouveau, motDePasse: e.target.value })}
            />
            <button
              onClick={ajouter}
              className="rounded-md bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400"
            >
              Enregistrer
            </button>
          </div>
        </section>
      )}

      {/* Équipe */}
      <div className="mb-8 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-neutral-900 text-white/50">
            <tr>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Mécanicien</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Spécialité</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Login</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Disponibilité</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">En charge</th>
              <th className="px-5 py-3 font-medium uppercase tracking-wider">Prêts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-neutral-950">
            {mecs.map((m) => (
              <tr key={m.id} className="hover:bg-white/5">
                <td className="px-5 py-3.5 font-medium text-white"><span className="flex items-center gap-2"><IconeUtilisateur className="h-4 w-4 text-white/50" /> {m.nom}</span></td>
                <td className="px-5 py-3.5 text-white/70">{m.specialite}</td>
                <td className="px-5 py-3.5 font-mono text-white/70">{m.login}</td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${
                      m.disponible
                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                        : 'border-red-500/30 bg-red-500/15 text-red-400'
                    }`}
                  >
                    {m.disponible ? 'Disponible' : 'Indisponible'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-white/80">{enCours(m.id)}</td>
                <td className="px-5 py-3.5 text-white/80">{prets(m.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/40">
        L’avancement des maintenances (en attente → en maintenance → prêt) est géré
        exclusivement par les mécaniciens dans leur espace « Maintenance » — la
        console n’offre qu’une vue de supervision (colonnes « En charge » et « Prêts »).
      </p>
    </>
  )
}

function Placeholder({ titre }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-2xl font-bold text-white md:text-3xl">{titre}</h1>
      <p className="mt-3 max-w-md text-white/50">Section en cours de construction. Le contenu de « {titre} » arrive bientôt.</p>
    </div>
  )
}
