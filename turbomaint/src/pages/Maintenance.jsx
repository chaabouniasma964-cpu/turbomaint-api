import { useState, useEffect } from 'react'
import {
  getOrdres,
  setStatutOrdre,
  setDisponibilite,
  getMecaniciens,
  loginMecanicien,
  getSessionMecanicien,
  logoutMecanicien,
  STATUT_LABELS,
  STATUT_STYLES,
} from '../lib/atelier.js'
import { IconeCle, IconeMoteur, IconeDocument, IconeCheck, IconeUtilisateur } from '../components/Icones.jsx'

// ============================================================
//  Services maintenance — espace sécurisé du mécanicien.
//  Connexion par login + mot de passe ; chaque mécanicien ne
//  voit QUE les moteurs qui lui sont confiés, et lui seul fait
//  avancer leur statut : en attente → en maintenance → prêt.
// ============================================================

const inputClass =
  'w-full rounded-md border border-white/15 bg-neutral-900 px-4 py-3 text-white placeholder-white/40 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400'

export default function Maintenance() {
  const [mec, setMec] = useState(() => getSessionMecanicien())
  const [ordres, setOrdres] = useState([])
  const [mecaniciens, setMecaniciens] = useState([])
  const [form, setForm] = useState({ login: '', motDePasse: '' })
  const [erreur, setErreur] = useState('')

  const rafraichir = async () => {
    const [ords, mecs] = await Promise.all([getOrdres(), getMecaniciens()])
    setOrdres(ords)
    setMecaniciens(mecs)
    setMec(getSessionMecanicien())
  }

  useEffect(() => {
    rafraichir()
  }, [])

  const connecter = async () => {
    if (!form.login.trim() || !form.motDePasse) {
      setErreur('Login et mot de passe obligatoires.')
      return
    }
    const m = await loginMecanicien(form.login, form.motDePasse)
    if (!m) {
      setErreur('Login ou mot de passe incorrect.')
      return
    }
    setErreur('')
    setForm({ login: '', motDePasse: '' })
    setMec(m)
    await rafraichir()
  }

  const deconnecter = () => {
    logoutMecanicien()
    setMec(null)
  }

  const changerStatut = async (id, statut) => {
    await setStatutOrdre(id, statut)
    await rafraichir()
  }

  const basculerDispo = async () => {
    await setDisponibilite(mec.id, !mec.disponible)
    await rafraichir()
  }

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

  // Fiche à jour du mécanicien connecté (disponibilité)
  const fiche = mec ? mecaniciens.find((m) => m.id === mec.id) || mec : null
  const mesOrdres = mec ? ordres.filter((o) => o.mecanicienId === mec.id && o.statut !== 'clos') : []
  const enCours = mesOrdres.filter((o) => o.statut !== 'pret').length

  /* ---------- Écran de connexion ---------- */
  if (!mec) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 pt-16">
        <div className="w-full max-w-md glass-strong rounded-2xl border border-white/15 p-8 md:p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300">
            <IconeCle className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">Services maintenance</h1>
          <p className="mt-2 text-sm text-white/60">
            Espace réservé aux mécaniciens. Connectez-vous pour voir les moteurs
            qui vous sont confiés.
          </p>
          <div className="mt-7 space-y-5">
            <div>
              <label className="mb-2 block text-sm text-white/80">Login</label>
              <input
                type="text"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                placeholder="ex. karim"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-white/80">Mot de passe</label>
              <input
                type="password"
                value={form.motDePasse}
                onChange={(e) => setForm({ ...form, motDePasse: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && connecter()}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>
            {erreur && <p className="text-sm font-medium text-red-400">{erreur}</p>}
            <button
              onClick={connecter}
              className="w-full rounded-md bg-white px-7 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-white/90"
            >
              Se connecter
            </button>
          </div>
        </div>
      </main>
    )
  }

  /* ---------- Espace de travail du mécanicien connecté ---------- */
  return (
    <main className="min-h-screen px-6 pb-20 pt-28">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-white md:text-4xl">
              <IconeCle className="h-8 w-8 text-sky-400" /> Services maintenance
            </h1>
            <p className="mt-2 text-white/60">
              Bonjour {fiche.nom} — voici les moteurs qui vous sont confiés.
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 text-sm text-white/80"><IconeUtilisateur className="h-4 w-4 text-white/50" /> {fiche.nom}</div>
            <div className="text-xs text-white/40">{fiche.specialite}</div>
            <button
              onClick={deconnecter}
              className="mt-1 text-xs text-white/50 underline hover:text-white"
            >
              Se déconnecter
            </button>
          </div>
        </div>

        {/* Statut personnel */}
        <div className="mt-8 flex flex-wrap items-center gap-4 glass rounded-xl border border-white/10 p-5">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              fiche.disponible
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                : 'border-red-500/30 bg-red-500/15 text-red-400'
            }`}
          >
            {fiche.disponible ? 'DISPONIBLE' : 'INDISPONIBLE'}
          </span>
          <button
            onClick={basculerDispo}
            className="rounded-md border border-white/15 px-4 py-2 text-xs text-white/70 transition hover:bg-white/10"
          >
            {fiche.disponible ? 'Passer indisponible' : 'Passer disponible'}
          </button>
          <span className="ml-auto text-sm text-white/50">
            {enCours} moteur{enCours > 1 ? 's' : ''} en charge
          </span>
        </div>

        {/* Moteurs confiés */}
        <div className="mt-6 space-y-3">
          {mesOrdres.length === 0 ? (
            <div className="rounded-xl glass border border-dashed border-white/20 p-10 text-center">
              <IconeCle className="mx-auto h-10 w-10 text-white/30" />
              <p className="mt-4 text-white/70">Aucun moteur en attente pour vous.</p>
              <p className="mt-1 text-sm text-white/50">
                Les moteurs que les clients vous confient apparaîtront ici.
              </p>
            </div>
          ) : (
            mesOrdres.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center gap-4 glass rounded-xl border border-white/10 p-5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70">
                  <IconeMoteur className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono text-sm font-semibold text-white">{o.moteurId}</span>
                    <span className="text-xs text-white/40">
                      de {o.client} · reçu le {fmtDate(o.dateEnvoi)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    {o.rul != null && (
                      <>Vols restants au transfert : <span className="text-white/90">{o.rul} vols</span></>
                    )}
                    {o.etat && <> · état : {o.etat}</>}
                  </div>
                </div>

                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${STATUT_STYLES[o.statut]}`}>
                  {STATUT_LABELS[o.statut]}
                </span>

                <div className="flex shrink-0 gap-2">
                  {o.pdfUrl && (
                    <a
                      href={o.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/10"
                    >
                      <IconeDocument className="h-3.5 w-3.5" /> Rapport
                    </a>
                  )}
                  {o.statut === 'en_attente' && (
                    <button
                      onClick={() => changerStatut(o.id, 'en_maintenance')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-white px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-white/90"
                    >
                      <IconeCle className="h-3.5 w-3.5" /> Commencer la maintenance
                    </button>
                  )}
                  {o.statut === 'en_maintenance' && (
                    <button
                      onClick={() => changerStatut(o.id, 'pret')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-400"
                    >
                      <IconeCheck className="h-3.5 w-3.5" /> Moteur prêt
                    </button>
                  )}
                  {o.statut === 'pret' && (
                    <span className="text-xs text-white/40">En attente de récupération par le client</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
