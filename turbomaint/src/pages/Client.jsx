import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  diagnostiquer,
  classifierRUL,
  niveauStyle,
  niveauHex,
} from '../lib/diagnostic.js'
import {
  askAssistant,
  apiDisponible,
  diagnoseEngine,
  urlRapportPdf,
} from '../lib/api.js'
import { getUser, resolveFirstVisit, logout } from '../lib/auth.js'
import {
  getMoteurs,
  addMoteur,
  removeMoteur,
  updateMoteurDiag,
  getHistorique,
  getReleves,
} from '../lib/moteurs.js'
import {
  getAlertes,
  marquerToutesLues,
  supprimerAlerte,
  genererAlertesDiagnostic,
} from '../lib/alertes.js'
import {
  getMecaniciens,
  getOrdres,
  ordreActif,
  creerOrdre,
  setStatutOrdre,
  STATUT_LABELS,
  STATUT_STYLES,
} from '../lib/atelier.js'
import {
  IconeAccueil,
  IconeMoteur,
  IconeLoupe,
  IconeMessage,
  IconeCloche,
  IconeHorloge,
  IconeCle,
  IconeDocument,
  IconePaquet,
  IconePlus,
  IconePoubelle,
  IconeAlerte,
  IconeInfo,
  IconeCheck,
} from '../components/Icones.jsx'

const SECTIONS = [
  { id: 'apercu', label: 'Vue d’ensemble', Icone: IconeAccueil },
  { id: 'moteurs', label: 'Mes moteurs', Icone: IconeMoteur },
  { id: 'diagnostic', label: 'Diagnostic', Icone: IconeLoupe },
  { id: 'assistant', label: 'Assistant IA', Icone: IconeMessage },
  { id: 'alertes', label: 'Alertes', Icone: IconeCloche },
  { id: 'historique', label: 'Historique', Icone: IconeHorloge },
]

// Style des cartes d'alerte selon la sévérité
const SEVERITE_STYLES = {
  critique: { bord: 'border-red-500/40', fond: 'bg-red-500/10', badge: 'border-red-500/30 bg-red-500/15 text-red-400', Icone: IconeAlerte, label: 'CRITIQUE' },
  elevee: { bord: 'border-orange-500/40', fond: 'bg-orange-500/10', badge: 'border-orange-500/30 bg-orange-500/15 text-orange-400', Icone: IconeAlerte, label: 'ÉLEVÉE' },
  moyenne: { bord: 'border-amber-500/40', fond: 'bg-amber-500/5', badge: 'border-amber-500/30 bg-amber-500/15 text-amber-400', Icone: IconePaquet, label: 'MOYENNE' },
  info: { bord: 'border-sky-500/40', fond: 'bg-sky-500/5', badge: 'border-sky-500/30 bg-sky-500/15 text-sky-400', Icone: IconeInfo, label: 'INFO' },
}

const inputClass =
  'w-full rounded-md border border-white/15 bg-neutral-900 px-4 py-3 text-white placeholder-white/40 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400'

const etatLiveStyle = {
  Sain: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  Dégradation: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  Critique: 'border-red-500/30 bg-red-500/15 text-red-400',
}

// Les 14 capteurs utilisés par les modèles, avec leur nom réel d'ingénierie.
// [code interne, nom réel, signification] — l'ordre = colonnes envoyées à l'API.
// Ce sont les mêmes valeurs que remontera l'équipement embarqué (Raspberry Pi).
const CAPTEURS = [
  ['s2', 'T24', 'Température sortie compresseur BP'],
  ['s3', 'T30', 'Température sortie compresseur HP'],
  ['s4', 'T50', 'Température sortie turbine BP'],
  ['s7', 'P30', 'Pression sortie compresseur HP'],
  ['s8', 'Nf', 'Vitesse du fan'],
  ['s9', 'Nc', 'Vitesse corps haute pression'],
  ['s11', 'Ps30', 'Pression statique compresseur HP'],
  ['s12', 'phi', 'Débit carburant / Ps30'],
  ['s13', 'NRf', 'Vitesse corrigée du fan'],
  ['s14', 'NRc', 'Vitesse corrigée corps HP'],
  ['s15', 'BPR', 'Taux de dilution'],
  ['s17', 'htBleed', 'Enthalpie de prélèvement'],
  ['s20', 'W31', 'Refroidissement turbine HP'],
  ['s21', 'W32', 'Refroidissement turbine BP'],
]

// Détail par capteur : nom réel, ce qu'il mesure et cause probable de la dérive.
// Sert à présenter un diagnostic clair (nom + cause) plutôt que le code interne.
const CAPTEUR_DETAIL = {
  s2:  { nom: 'T24', mesure: 'température sortie compresseur BP', cause: 'échauffement compensatoire du moteur' },
  s3:  { nom: 'T30', mesure: 'température sortie compresseur HP', cause: 'perte d’efficacité du compresseur haute pression' },
  s4:  { nom: 'T50', mesure: 'température sortie turbine BP', cause: 'gaz plus chauds liés à l’usure du compresseur' },
  s7:  { nom: 'P30', mesure: 'pression sortie compresseur HP', cause: 'compression devenue insuffisante' },
  s8:  { nom: 'Nf', mesure: 'vitesse du fan', cause: 'compensation de la régulation' },
  s9:  { nom: 'Nc', mesure: 'vitesse corps haute pression', cause: 'ajustement du régime moteur' },
  s11: { nom: 'Ps30', mesure: 'pression statique compresseur HP', cause: 'signature caractéristique d’usure du compresseur' },
  s12: { nom: 'phi', mesure: 'rapport carburant / pression', cause: 'surconsommation de carburant' },
  s13: { nom: 'NRf', mesure: 'vitesse corrigée du fan', cause: 'compensation de la régulation' },
  s14: { nom: 'NRc', mesure: 'vitesse corrigée corps HP', cause: 'usure avancée du compresseur' },
  s15: { nom: 'BPR', mesure: 'taux de dilution', cause: 'déséquilibre entre les flux d’air' },
  s17: { nom: 'htBleed', mesure: 'enthalpie de prélèvement d’air', cause: 'prélèvement d’air perturbé' },
  s20: { nom: 'W31', mesure: 'refroidissement turbine HP', cause: 'moins d’air de refroidissement (risque thermique)' },
  s21: { nom: 'W32', mesure: 'refroidissement turbine BP', cause: 'moins d’air de refroidissement (risque thermique)' },
}

// Nettoie le texte du briefing généré par l'IA pour un rendu professionnel :
// retire le markdown (**gras**), supprime la ligne d'avertissement sur le
// nombre de cycles, et remplace le vocabulaire « cycles » par « vols ».
function nettoyerBriefing(txt) {
  if (!txt) return ''
  return txt
    .split('\n')
    .filter((l) => !/pr[ée]diction indicative|cycle.? fourni|plus de cycles/i.test(l))
    .join('\n')
    .replace(/\*\*/g, '')
    .replace(/\(intervalle[^)]*\)/gi, '')
    .replace(/\bcycles?\b/gi, (m) => (m[0] === 'C' ? 'Vols' : 'vols'))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Exemple de cycle sain (moteur 24, début de vie) pour pré-remplir la saisie
const EXEMPLE_CYCLE = {
  s2: 642.27, s3: 1579.49, s4: 1392.25, s7: 554.8, s8: 2388.01, s9: 9062.42,
  s11: 47.24, s12: 522.65, s13: 2388.0, s14: 8142.68, s15: 8.3943, s17: 391,
  s20: 39.01, s21: 23.4534,
}

/* Anneau de progression RUL */
function Ring({ rul, color }) {
  const R = 52
  const C = 2 * Math.PI * R
  const len = Math.min(1, rul / 130) * C
  return (
    <svg viewBox="0 0 140 140" className="h-40 w-40">
      <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} />
      </g>
      <text x="70" y="66" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="700">{rul}</text>
      <text x="70" y="86" textAnchor="middle" fill="#9ca3af" fontSize="10">vols restants</text>
    </svg>
  )
}

/* Sélecteur de moteur réutilisable */
function SelecteurMoteur({ moteurs, moteur, onSelect, label = 'Moteur suivi :' }) {
  if (moteurs.length === 0) return null
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <span className="text-sm text-white/60">{label}</span>
      {moteurs.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m)}
          className={`rounded-md border px-4 py-2 font-mono text-sm transition ${
            moteur?.id === m.id
              ? 'border-sky-400 bg-sky-500/15 text-white'
              : 'border-white/15 text-white/70 hover:bg-white/5'
          }`}
        >
          {m.id}
        </button>
      ))}
    </div>
  )
}

/* Carte d'invitation quand la flotte est vide (onboarding) */
function OnboardingMoteur({ onAller }) {
  return (
    <div className="glass rounded-xl border border-sky-400/30 p-10 text-center">
      <IconeMoteur className="mx-auto h-10 w-10 text-sky-400" />
      <h2 className="mt-4 text-xl font-semibold text-white">
        Commencez par enregistrer votre premier moteur
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
        Créez la fiche de votre moteur (identifiant, modèle, mise en service).
        Vous pourrez ensuite uploader ses relevés capteurs pour obtenir son
        diagnostic complet : RUL, état de santé et capteurs à surveiller.
      </p>
      <button
        onClick={onAller}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
      >
        <IconePlus className="h-4 w-4" /> Enregistrer mon moteur
      </button>
    </div>
  )
}

export default function Client() {
  // Compte connecté (créé à l'inscription sur la page d'accueil)
  const [compte] = useState(() => getUser())
  const [premiereVisite] = useState(() => resolveFirstVisit())
  const prenom = compte?.nom || 'invité'
  const salutation = premiereVisite ? `Bienvenue ${prenom}` : `Salut ${prenom}`

  const [section, setSection] = useState('apercu')

  // ---------- Flotte du client (PostgreSQL via API) ----------
  const email = compte?.email
  const [moteurs, setMoteurs] = useState([])
  const [moteur, setMoteur] = useState(null)
  const [historique, setHistorique] = useState([])

  // ---------- Alertes + atelier ----------
  const [alertes, setAlertes] = useState([])
  const [ordres, setOrdres] = useState([])
  const [mecaniciens, setMecaniciens] = useState([])
  const [envoiPour, setEnvoiPour] = useState(null) // moteur en cours d'envoi à l'atelier
  const nonLues = alertes.filter((a) => !a.lu).length

  // Chargements (depuis l'API)
  const rechargerFlotte = async () => {
    if (!email) return
    const [ms, hs] = await Promise.all([getMoteurs(email), getHistorique()])
    setMoteurs(ms)
    setHistorique(hs)
    setMoteur((prev) =>
      prev ? ms.find((m) => m.id === prev.id) ?? ms[0] ?? null : ms[0] ?? null
    )
  }
  const rechargerAtelier = async () => {
    if (!email) return
    const [ords, mecs] = await Promise.all([getOrdres({ client: email }), getMecaniciens()])
    setOrdres(ords)
    setMecaniciens(mecs)
  }
  const rechargerAlertes = async () => {
    if (!email) return
    setAlertes(await getAlertes(email))
  }

  useEffect(() => {
    rechargerFlotte()
  }, [])

  useEffect(() => {
    if (!email) return
    // Le mécanicien a pu agir entre-temps ; en entrant dans « Alertes »,
    // on marque tout comme lu puis on recharge.
    rechargerAtelier()
    if (section === 'alertes') {
      ;(async () => {
        await marquerToutesLues(email)
        await rechargerAlertes()
      })()
    } else {
      rechargerAlertes()
    }
  }, [section])

  const envoyerEnMaintenance = async (m, mecanicienId) => {
    await creerOrdre({
      moteurId: m.id,
      clientEmail: email,
      clientNom: compte?.nom,
      rul: m.rul,
      etat: m.etat,
      mecanicienId,
      pdfUrl: m.dernierDiag ? urlRapportPdf(m.id) : null,
    })
    await rechargerAtelier()
    setEnvoiPour(null)
  }

  const recupererMoteur = async (m, ordre) => {
    await setStatutOrdre(ordre.id, 'clos')
    // Après maintenance, le RUL n'est plus valable : re-diagnostic nécessaire
    await updateMoteurDiag(email, m.id, { rul: null, etat: null })
    await rechargerFlotte()
    await rechargerAtelier()
    await rechargerAlertes()
  }

  // Formulaire d'ajout de moteur
  const [formMoteur, setFormMoteur] = useState({ id: '', modele: '', miseEnService: '', cyclesCumules: '' })
  const [erreurMoteur, setErreurMoteur] = useState('')

  const ajouterMoteur = async () => {
    const id = formMoteur.id.trim()
    if (!id) {
      setErreurMoteur('L’identifiant du moteur est obligatoire.')
      return
    }
    try {
      const liste = await addMoteur(email, {
        id,
        modele: formMoteur.modele.trim() || 'Turbofan',
        miseEnService: formMoteur.miseEnService || null,
      })
      setMoteurs(liste)
      if (!moteur) setMoteur(liste[liste.length - 1])
      setFormMoteur({ id: '', modele: '', miseEnService: '', cyclesCumules: '' })
      setErreurMoteur('')
    } catch (e) {
      setErreurMoteur(e.message)
    }
  }

  const supprimerMoteur = async (id) => {
    if (!window.confirm(`Retirer le moteur « ${id} » de votre flotte ?`)) return
    const liste = await removeMoteur(email, id)
    setMoteurs(liste)
    if (moteur?.id === id) setMoteur(liste[0] ?? null)
  }

  // Diagnostic du moteur sélectionné (règles locales, pour la vue d'ensemble)
  const diag = moteur?.rul != null ? diagnostiquer(moteur.rul) : null

  // ---------- Diagnostic live (saisie capteurs -> API) ----------
  const [diagEnCours, setDiagEnCours] = useState(false)
  const [resultat, setResultat] = useState(null) // { diagnostic, briefing }
  const [erreurDiag, setErreurDiag] = useState('')

  // Saisie des 14 valeurs capteurs du moteur
  const [valeurs, setValeurs] = useState({})

  // Auto-remplissage des 2 capteurs mesurés par l'ESP32 (s2 = température, s7 = pression)
  const [esp32Info, setEsp32Info] = useState('')
  useEffect(() => {
    if (!moteur) return
    let actif = true
    const charger = async () => {
      try {
        const releves = await getReleves(email, moteur.id)
        const dernier = releves?.[releves.length - 1]
        if (actif && Array.isArray(dernier) && dernier.length >= 2) {
          setValeurs((v) => ({ ...v, s2: String(dernier[0]), s7: String(dernier[1]) }))
          setEsp32Info(`Capteurs ESP32 reçus · s2 = ${dernier[0]} · s7 = ${dernier[1]}`)
        }
      } catch {
        /* pas de relevé ESP32 : on laisse la saisie manuelle */
      }
    }
    charger()
    const t = setInterval(charger, 5000) // rafraîchit toutes les 5 s
    return () => { actif = false; clearInterval(t) }
  }, [moteur?.id, email])

  const executerDiagnostic = async (file) => {
    setDiagEnCours(true)
    setErreurDiag('')
    setResultat(null)
    try {
      const res = await diagnoseEngine(file, moteur.id)
      setResultat(res)
      const d = res.diagnostic
      // Analyse précédente du même moteur (avant mise à jour) pour comparaison
      const precedent = historique.find((h) => h.moteur === moteur.id) ?? null
      // Mise à jour de la fiche moteur en base
      const liste = await updateMoteurDiag(email, moteur.id, {
        rul: d.rul_predit,
        etat: d.etat_predit,
      })
      setMoteurs(liste)
      setMoteur(liste.find((m) => m.id === moteur.id) ?? null)
      // Alertes intelligentes (créées en base), puis rechargement
      await genererAlertesDiagnostic(email, d, precedent)
      await rechargerAlertes()
      // L'historique est dérivé des diagnostics enregistrés côté API
      setHistorique(await getHistorique())
    } catch (e) {
      setErreurDiag(`Diagnostic impossible : ${e.message}`)
    } finally {
      setDiagEnCours(false)
    }
  }

  const lancerDiagnosticManuel = () => {
    const manquants = CAPTEURS.filter(
      ([c]) => valeurs[c] === undefined || valeurs[c] === '' || isNaN(Number(valeurs[c]))
    )
    if (manquants.length) {
      setErreurDiag(`Valeurs manquantes ou invalides : ${manquants.map(([, nom]) => nom).join(', ')}`)
      return
    }
    // Les 14 valeurs saisies forment le relevé, envoyé comme un CSV d'une ligne
    const ligne = CAPTEURS.map(([c]) => Number(valeurs[c]))
    const csv = [CAPTEURS.map(([c]) => c).join(','), ligne.join(',')].join('\n')
    executerDiagnostic(new File([csv], `releve_${moteur.id}.csv`, { type: 'text/csv' }))
  }

  // ---------- Assistant conversationnel ----------
  const [messages, setMessages] = useState([
    { role: 'bot', text: `Bonjour ${prenom} 👋 Je suis l’assistant de diagnostic TurboMaint. Sélectionnez un moteur et posez-moi vos questions.` },
  ])
  const [chatInput, setChatInput] = useState('')
  const [enAttente, setEnAttente] = useState(false)
  const chatEnd = useRef(null)

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, enAttente])

  const envoyer = async (texte) => {
    const q = (texte ?? chatInput).trim()
    if (!q || enAttente) return
    setChatInput('')
    setMessages((m) => [...m, { role: 'user', text: q }])

    // L'assistant s'appuie exclusivement sur le service IA (LLM + RAG).
    if (!apiDisponible()) {
      setMessages((m) => [...m, { role: 'bot', text:
        'L’assistant IA n’est pas disponible : le service de diagnostic n’est pas configuré (VITE_API_URL).' }])
      return
    }

    let reponse
    setEnAttente(true)
    try {
      // Moteur déjà diagnostiqué en direct -> son id est connu du service ;
      // sinon, un id se terminant par un nombre (FD001-012) renvoie vers le
      // moteur correspondant de la base historique (12).
      let engineId = null
      if (moteur) {
        const num = moteur.id.match(/(\d+)\s*$/)
        engineId =
          moteur.dernierDiag != null ? moteur.id : num ? String(parseInt(num[1], 10)) : moteur.id
      }
      reponse = await askAssistant(q, engineId)
    } catch {
      reponse =
        'L’assistant IA est momentanément indisponible (le service se réveille peut-être). Réessayez dans une minute.'
    } finally {
      setEnAttente(false)
    }
    setMessages((m) => [...m, { role: 'bot', text: reponse }])
  }

  const suggestions = ['Quel est le RUL ?', 'Quand faire la maintenance ?', 'Quel est le risque ?', 'Pourquoi cette dégradation ?']

  // ---------- Indicateurs de la vue d'ensemble ----------
  const analyses = moteurs.filter((m) => m.rul != null)
  const nbAlertes = analyses.filter((m) => classifierRUL(m.rul) !== 'Sain').length
  const prochaine = analyses.length
    ? analyses.map((m) => ({ ...m, d: diagnostiquer(m.rul) }))
        .reduce((a, b) => (a.d.volsPlanif <= b.d.volsPlanif ? a : b))
    : null

  const titres = {
    apercu: ['Vue d’ensemble', 'État de vos moteurs et diagnostic IA en un coup d’œil.'],
    moteurs: ['Mes moteurs', 'Enregistrez et gérez la flotte de moteurs que vous suivez.'],
    diagnostic: ['Diagnostic', 'Uploadez les relevés capteurs d’un moteur pour l’analyser.'],
    assistant: ['Assistant IA', 'Posez vos questions : RUL, maintenance, risques, capteurs.'],
    alertes: ['Alertes', 'Notifications intelligentes générées par l’analyse de vos diagnostics.'],
    historique: ['Mon historique', 'Toutes vos analyses passées, de la plus récente à la plus ancienne.'],
  }

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

  const dResultat = resultat?.diagnostic
  // Ordre de maintenance actif du moteur sélectionné (le cas échéant)
  const ordreMoteurCourant = moteur
    ? ordres.find((o) => o.moteurId === moteur.id && o.statut !== 'clos') || null
    : null

  return (
    <div className="min-h-screen pt-[64px]">
      <div className="flex min-h-[calc(100vh-64px)]">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="glass hidden w-64 shrink-0 flex-col border-y-0 border-l-0 border-r border-white/10 px-5 py-8 md:flex">
          <div className="mb-8 px-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
            Portail
          </div>
          <nav className="flex-1 space-y-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-medium transition ${
                  section === s.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <s.Icone className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1">{s.label}</span>
                {s.id === 'alertes' && nonLues > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {nonLues}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Compte en bas de sidebar */}
          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="px-2">
              <div className="truncate text-sm font-medium text-white">{compte?.nom || 'Invité'}</div>
              <div className="truncate text-xs text-white/40">{compte?.email || '—'}</div>
              {compte?.phone && (
                <div className="truncate text-xs text-white/40">{compte.phone}</div>
              )}
            </div>
            {compte && (
              <button
                onClick={() => {
                  logout()
                  window.location.href = '/'
                }}
                className="mt-3 w-full rounded-md border border-white/15 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                Se déconnecter
              </button>
            )}
            <Link to="/" className="mt-2 block rounded-md px-4 py-2 text-xs font-medium text-white/40 hover:text-white">
              ← Retour au site
            </Link>
          </div>
        </aside>

        {/* ---------- Contenu ---------- */}
        <main className="min-w-0 flex-1 px-6 py-8 md:px-10">
          {/* Navigation mobile (la sidebar est masquée) */}
          <div className="mb-6 flex gap-2 overflow-x-auto pb-1 md:hidden">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition ${
                  section === s.id
                    ? 'border-sky-400 bg-sky-500/15 text-white'
                    : 'border-white/15 text-white/60'
                }`}
              >
                <s.Icone className="h-4 w-4" /> {s.label}
                {s.id === 'alertes' && nonLues > 0 && (
                  <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {nonLues}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* En-tête de section */}
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-white md:text-3xl">
              {section === 'apercu' ? `${salutation} 👋` : titres[section][0]}
            </h1>
            <p className="mt-1 text-sm text-white/50">{titres[section][1]}</p>
          </header>

          {/* ===== VUE D'ENSEMBLE ===== */}
          <div className={section === 'apercu' ? '' : 'hidden'}>
            {moteurs.length === 0 ? (
              <OnboardingMoteur onAller={() => setSection('moteurs')} />
            ) : (
              <>
                {/* Indicateurs */}
                <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
                  <div className="glass rounded-xl border border-white/10 p-5">
                    <div className="text-xs uppercase tracking-wider text-white/50">Moteurs suivis</div>
                    <div className="mt-3 text-3xl font-bold text-white">{moteurs.length}</div>
                    <div className="mt-1 text-xs text-white/40">
                      {analyses.length}/{moteurs.length} analysés
                    </div>
                  </div>
                  <div className="glass rounded-xl border border-white/10 p-5">
                    <div className="text-xs uppercase tracking-wider text-white/50">Alertes actives</div>
                    <div className="mt-3 text-3xl font-bold text-white">{nbAlertes}</div>
                    <div className="mt-1 text-xs text-white/40">moteurs hors état normal</div>
                  </div>
                  <div className="col-span-2 glass rounded-xl border border-white/10 p-5 lg:col-span-1">
                    <div className="text-xs uppercase tracking-wider text-white/50">Prochaine maintenance</div>
                    {prochaine ? (
                      <>
                        <div className="mt-3 text-3xl font-bold text-white">
                          {prochaine.d.volsPlanif} vols
                        </div>
                        <div className="mt-1 text-xs text-white/40">
                          {prochaine.id} · à intervenir avant (marge incluse)
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 text-sm text-white/40">Aucun moteur analysé pour l’instant</div>
                    )}
                  </div>
                </section>

                <SelecteurMoteur moteurs={moteurs} moteur={moteur} onSelect={setMoteur} />

                {/* État du moteur sélectionné */}
                {moteur?.rul != null && diag ? (
                  <section>
                    <div className="flex items-center gap-6 glass rounded-xl border border-white/10 p-6">
                      <Ring rul={Math.round(moteur.rul)} color={niveauHex[diag.niveau]} />
                      <div>
                        <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${niveauStyle[diag.niveau]}`}>{diag.niveau}</span>
                        <h2 className="mt-3 font-mono text-lg text-white">{moteur.id}</h2>
                        <p className="mt-2 flex items-center gap-2 text-sm text-white/60"><IconeHorloge className="h-4 w-4 text-white/40" /> Il reste ~{diag.volsRestants} vols avant la panne</p>
                        <p className="mt-1 flex items-center gap-2 text-sm text-white/60"><IconeCle className="h-4 w-4 text-white/40" /> Intervenir avant {diag.volsPlanif} vols (marge de sécurité incluse)</p>
                        <p className="mt-1 text-xs text-white/40">Dernière analyse : {fmtDate(moteur.dernierDiag)}</p>
                      </div>
                    </div>
                  </section>
                ) : (
                  moteur && (
                    <section className="rounded-xl glass border border-dashed border-white/20 p-8 text-center">
                      <p className="text-white/70">
                        Le moteur <span className="font-mono text-white">{moteur.id}</span> n’a pas encore été analysé.
                      </p>
                      <p className="mt-1 text-sm text-white/50">
                        Uploadez ses relevés capteurs pour obtenir son RUL, son état et ses capteurs à surveiller.
                      </p>
                      <button
                        onClick={() => setSection('diagnostic')}
                        className="mt-5 inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                      >
                        <IconeLoupe className="h-4 w-4" /> Lancer son premier diagnostic
                      </button>
                    </section>
                  )
                )}
              </>
            )}
          </div>

          {/* ===== MES MOTEURS ===== */}
          <div className={section === 'moteurs' ? '' : 'hidden'}>
            {/* Formulaire d'ajout : la fiche d'identité du moteur */}
            <section className="mb-6 glass rounded-xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white">Enregistrer un moteur</h2>
              <p className="mt-1 text-xs text-white/50">
                Créez la fiche du moteur. Ses relevés capteurs (14 capteurs, un CSV par période
                d’exploitation) seront ensuite uploadés dans l’onglet Diagnostic.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-2 block text-sm text-white/70">Identifiant *</label>
                  <input
                    type="text"
                    value={formMoteur.id}
                    onChange={(e) => setFormMoteur({ ...formMoteur, id: e.target.value })}
                    placeholder="ex. CFM56-A320-01"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-white/70">Modèle</label>
                  <input
                    type="text"
                    value={formMoteur.modele}
                    onChange={(e) => setFormMoteur({ ...formMoteur, modele: e.target.value })}
                    placeholder="ex. Turbofan CFM56-7B"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-white/70">Mise en service</label>
                  <input
                    type="date"
                    value={formMoteur.miseEnService}
                    onChange={(e) => setFormMoteur({ ...formMoteur, miseEnService: e.target.value })}
                    className={`${inputClass} [color-scheme:dark]`}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-white/70">Vols effectués</label>
                  <input
                    type="number"
                    min="0"
                    value={formMoteur.cyclesCumules}
                    onChange={(e) => setFormMoteur({ ...formMoteur, cyclesCumules: e.target.value })}
                    placeholder="ex. 340"
                    className={inputClass}
                  />
                </div>
              </div>
              {erreurMoteur && <p className="mt-3 text-sm text-red-400">{erreurMoteur}</p>}
              <button
                onClick={ajouterMoteur}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                <IconePlus className="h-4 w-4" /> Ajouter à ma flotte
              </button>
            </section>

            {/* Liste des moteurs de la flotte */}
            {moteurs.length === 0 ? (
              <p className="text-sm text-white/40">
                Aucun moteur enregistré pour l’instant — ajoutez votre premier moteur ci-dessus.
              </p>
            ) : (
              <div className="space-y-3">
                {moteurs.map((m) => {
                  const niveau = m.rul != null ? classifierRUL(m.rul) : null
                  const ordre = ordres.find((o) => o.moteurId === m.id && o.statut !== 'clos') || null
                  const mecsDispo = mecaniciens.filter((x) => x.disponible)
                  return (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center gap-4 glass rounded-xl border border-white/10 p-4 transition hover:border-white/20"
                    >
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
                        style={{
                          borderColor: niveau ? `${niveauHex[niveau]}55` : 'rgba(255,255,255,0.15)',
                          backgroundColor: niveau ? `${niveauHex[niveau]}22` : 'rgba(255,255,255,0.05)',
                        }}
                      >
                        <IconeMoteur className="h-5 w-5" style={{ color: niveau ? niveauHex[niveau] : 'rgba(255,255,255,0.5)' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <span className="font-mono text-sm font-semibold text-white">{m.id}</span>
                          <span className="text-xs text-white/40">{m.modele}</span>
                        </div>
                        <div className="mt-1 text-xs text-white/60">
                          {m.rul != null ? (
                            <>Vols restants : <span className="font-medium text-white/90">{m.rul} vols</span> · analysé le {fmtDate(m.dernierDiag)}</>
                          ) : (
                            <span className="text-white/40">Pas encore analysé</span>
                          )}
                          {m.cyclesCumules != null && <> · ~{m.cyclesCumules} vols cumulés</>}
                          {m.miseEnService && <> · en service depuis le {fmtDate(m.miseEnService)}</>}
                        </div>
                      </div>
                      {niveau ? (
                        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${niveauStyle[niveau]}`}>
                          {niveau}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/40">
                          NON ANALYSÉ
                        </span>
                      )}
                      {/* Statut atelier du moteur, le cas échéant */}
                      {ordre && (
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${STATUT_STYLES[ordre.statut]}`}>
                          <IconeCle className="h-3.5 w-3.5" /> {STATUT_LABELS[ordre.statut]} · {ordre.mecanicienNom}
                        </span>
                      )}

                      <div className="flex shrink-0 gap-2">
                        {!ordre && (
                          <button
                            onClick={() => {
                              setMoteur(m)
                              setSection('diagnostic')
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 px-3 py-1.5 text-xs font-medium text-sky-300 transition hover:bg-sky-500/10"
                          >
                            <IconeLoupe className="h-3.5 w-3.5" /> Diagnostiquer
                          </button>
                        )}
                        {!ordre && m.rul != null && (
                          <button
                            onClick={() => setEnvoiPour(envoiPour === m.id ? null : m.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/10"
                          >
                            <IconeCle className="h-3.5 w-3.5" /> Envoyer en maintenance
                          </button>
                        )}
                        {ordre?.statut === 'pret' && (
                          <button
                            onClick={() => recupererMoteur(m, ordre)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-400"
                          >
                            <IconePaquet className="h-3.5 w-3.5" /> Récupérer le moteur
                          </button>
                        )}
                        {!ordre && (
                          <button
                            onClick={() => supprimerMoteur(m.id)}
                            className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
                          >
                            Retirer
                          </button>
                        )}
                      </div>

                      {/* Choix du mécanicien (uniquement parmi les DISPONIBLES) */}
                      {envoiPour === m.id && !ordre && (
                        <div className="w-full rounded-lg border border-white/10 bg-white/5 p-4">
                          <div className="mb-3 text-xs uppercase tracking-wider text-white/40">
                            Envoyer {m.id} avec son rapport de diagnostic à :
                          </div>
                          {mecsDispo.length === 0 ? (
                            <p className="text-sm text-white/50">
                              Aucun mécanicien disponible actuellement — réessayez plus tard.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {mecsDispo.map((mec) => (
                                <button
                                  key={mec.id}
                                  onClick={() => envoyerEnMaintenance(m, mec.id)}
                                  className="rounded-lg border border-white/15 px-4 py-2.5 text-left transition hover:border-sky-400 hover:bg-sky-500/10"
                                >
                                  <div className="flex items-center gap-1.5 text-sm font-medium text-white"><IconeCle className="h-4 w-4 text-white/50" /> {mec.nom}</div>
                                  <div className="text-xs text-white/50">{mec.specialite}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ===== DIAGNOSTIC ===== */}
          <div className={section === 'diagnostic' ? '' : 'hidden'}>
            {!apiDisponible() ? (
              <div className="glass rounded-xl border border-white/10 p-8 text-sm text-white/50">
                Le diagnostic en direct nécessite la connexion à l’API TurboMaint
                (variable VITE_API_URL non configurée).
              </div>
            ) : moteurs.length === 0 ? (
              <OnboardingMoteur onAller={() => setSection('moteurs')} />
            ) : (
              <>
                <SelecteurMoteur
                  moteurs={moteurs}
                  moteur={moteur}
                  onSelect={setMoteur}
                  label="Moteur à analyser :"
                />
                <section className="glass rounded-xl border border-white/10">
                  <div className="border-b border-white/10 px-6 py-4">
                    <h2 className="text-lg font-semibold text-white">
                      Relevés capteurs de <span className="font-mono text-sky-300">{moteur?.id}</span>
                    </h2>
                    <p className="mt-2 text-xs text-white/50">
                      Saisissez la valeur relevée sur chacun des 14 capteurs, puis lancez
                      le diagnostic. Ce sont les mêmes mesures que remontera votre
                      équipement embarqué (Raspberry Pi) via l’API.
                    </p>
                  </div>

                  {/* Saisie des valeurs des 14 capteurs (noms réels) */}
                  <div className="px-6 py-5">
                      <div className="mb-4 rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
                        🛰️ Les capteurs <b>s2</b> (température) et <b>s7</b> (pression) sont remplis
                        automatiquement depuis l’ESP32. Saisissez manuellement les 12 autres.
                        {esp32Info && <span className="mt-1 block text-sky-300/80">{esp32Info}</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {CAPTEURS.map(([code, nom, signification]) => (
                          <div key={code}>
                            <label className="mb-1 block text-xs text-white/60">
                              <span className="font-semibold text-white/90">{nom}</span>
                              <span className="ml-1 hidden text-white/40 xl:inline">· {signification}</span>
                            </label>
                            <input
                              type="number"
                              step="any"
                              value={valeurs[code] ?? ''}
                              onChange={(e) => setValeurs((v) => ({ ...v, [code]: e.target.value }))}
                              placeholder={String(EXEMPLE_CYCLE[code])}
                              title={`${nom} — ${signification}`}
                              className="w-full rounded-md border border-white/15 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-white/25 outline-none transition focus:border-sky-400"
                            />
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => setValeurs(Object.fromEntries(Object.entries(EXEMPLE_CYCLE).map(([k, v]) => [k, String(v)])))}
                          className="rounded-md border border-white/15 px-4 py-2 text-xs text-white/70 transition hover:bg-white/10"
                        >
                          Pré-remplir (exemple)
                        </button>
                        <button
                          onClick={() => setValeurs({})}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:bg-white/10"
                        >
                          <IconePoubelle className="h-3.5 w-3.5" /> Effacer
                        </button>
                        <button
                          onClick={lancerDiagnosticManuel}
                          disabled={diagEnCours}
                          className="ml-auto inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
                        >
                          <IconeLoupe className="h-4 w-4" />
                          {diagEnCours ? 'Analyse en cours…' : 'Diagnostiquer'}
                        </button>
                      </div>
                    </div>

                  {erreurDiag && <p className="px-6 pb-4 text-sm text-red-400">{erreurDiag}</p>}
                  {diagEnCours && (
                    <p className="px-6 pb-4 text-sm text-white/50">
                      Les modèles analysent les relevés… (jusqu’à 1 min si le serveur se réveille)
                    </p>
                  )}

                  {dResultat && (
                    <div className="space-y-5 border-t border-white/10 px-6 py-5">
                      {/* Verdict — phrase claire */}
                      <div>
                        <div className="mb-2 flex items-center gap-3">
                          <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${etatLiveStyle[dResultat.etat_predit] || ''}`}>
                            {dResultat.etat_predit}
                          </span>
                          <span className="text-xs uppercase tracking-wider text-white/40">Résultat du diagnostic</span>
                        </div>
                        <p className="text-sm leading-relaxed text-white/90">
                          Le moteur <span className="font-mono text-white">{dResultat.moteur}</span> est
                          en état <b className="text-white">{dResultat.etat_predit}</b>. Il reste
                          {' '}<b className="text-white">~{Math.round(dResultat.rul_predit)} vols</b> avant
                          la panne ; prévoyez l’intervention avant{' '}
                          <b className="text-white">{Math.max(0, Math.round(dResultat.rul_predit - 10))} vols</b>{' '}
                          (marge de sécurité incluse).
                        </p>
                      </div>

                      {/* Capteurs signalés — liste avec cause probable */}
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-wider text-white/40">
                          Capteurs signalés
                        </div>
                        {dResultat.capteurs_anormaux.length === 0 ? (
                          <p className="text-sm text-white/60">Aucun capteur ne sort de l’ordinaire.</p>
                        ) : (
                          <ul className="space-y-2">
                            {dResultat.capteurs_anormaux.map((s) => {
                              const info = CAPTEUR_DETAIL[s.capteur] || { nom: s.capteur, mesure: s.description, cause: '' }
                              const anomalie = s.niveau === 'anomalie'
                              const sens = s.derive === 'capteur figé' ? 'figé' : s.derive
                              return (
                                <li key={s.capteur} className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
                                  <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${anomalie ? 'border-red-500/30 bg-red-500/15 text-red-400' : 'border-amber-500/30 bg-amber-500/15 text-amber-400'}`}>
                                    {anomalie ? 'ANOMALIE' : 'SURVEILLANCE'}
                                  </span>
                                  <div className="text-sm text-white/85">
                                    <span className="font-semibold text-white">{info.nom}</span>
                                    <span className="text-white/50"> — {info.mesure}</span>
                                    {' · '}<span className="text-white/70">{sens}</span>
                                    {info.cause && (
                                      <div className="mt-0.5 text-xs text-white/50">Cause probable : {info.cause}.</div>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Analyse et recommandations (briefing IA nettoyé) */}
                      {resultat.briefing && (
                        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                          <div className="mb-2 text-xs uppercase tracking-wider text-white/40">
                            Analyse et recommandations
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                            {nettoyerBriefing(resultat.briefing)}
                          </p>
                        </div>
                      )}

                      {/* Rapport PDF */}
                      <div>
                        <a
                          href={urlRapportPdf(dResultat.moteur)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-md border border-sky-400/40 px-4 py-2 text-sm text-sky-300 transition hover:bg-sky-500/10"
                        >
                          <IconeDocument className="h-4 w-4" /> Télécharger le rapport PDF
                        </a>
                      </div>

                      {/* Consulter un mécanicien : envoi du moteur + rapport
                          à un mécanicien selon sa disponibilité */}
                      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                        <div className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/40">
                          <IconeCle className="h-4 w-4" /> Consulter un mécanicien
                        </div>
                        {ordreMoteurCourant ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUT_STYLES[ordreMoteurCourant.statut]}`}>
                              {STATUT_LABELS[ordreMoteurCourant.statut]}
                            </span>
                            <p className="text-sm text-white/70">
                              Le moteur <span className="font-mono text-white">{moteur?.id}</span> et son
                              rapport ont été confiés à <b className="text-white">{ordreMoteurCourant.mecanicienNom}</b>.
                              {ordreMoteurCourant.statut === 'pret' && ' Vous pouvez le récupérer dans « Mes moteurs ».'}
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="mb-3 text-sm text-white/60">
                              Envoyez ce moteur et son rapport de diagnostic au département
                              maintenance — seuls les mécaniciens <b className="text-emerald-400">disponibles</b> peuvent
                              être sélectionnés.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {mecaniciens.map((mec) => (
                                <button
                                  key={mec.id}
                                  disabled={!mec.disponible}
                                  onClick={() => envoyerEnMaintenance(moteur, mec.id)}
                                  className={`rounded-lg border px-4 py-2.5 text-left transition ${
                                    mec.disponible
                                      ? 'border-white/15 hover:border-sky-400 hover:bg-sky-500/10'
                                      : 'cursor-not-allowed border-white/10 opacity-40'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="flex items-center gap-1.5 text-sm font-medium text-white"><IconeCle className="h-4 w-4 text-white/50" /> {mec.nom}</span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                        mec.disponible
                                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                                          : 'border-red-500/30 bg-red-500/15 text-red-400'
                                      }`}
                                    >
                                      {mec.disponible ? 'DISPONIBLE' : 'INDISPONIBLE'}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-white/50">{mec.specialite}</div>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          {/* ===== ASSISTANT IA ===== */}
          <div className={section === 'assistant' ? '' : 'hidden'}>
            <SelecteurMoteur
              moteurs={moteurs}
              moteur={moteur}
              onSelect={setMoteur}
              label="Moteur concerné :"
            />

            <section className="glass rounded-xl border border-white/10">
              <div className="max-h-[26rem] space-y-3 overflow-y-auto px-6 py-5">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === 'user' ? 'bg-sky-500 text-white' : 'bg-neutral-800 text-white/90'
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {enAttente && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl bg-neutral-800 px-4 py-2.5 text-sm text-white/50">
                      L’assistant réfléchit…
                    </div>
                  </div>
                )}
                <div ref={chatEnd} />
              </div>

              {/* Suggestions rapides */}
              <div className="flex flex-wrap gap-2 px-6 pb-3">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => envoyer(s)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10">
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 border-t border-white/10 p-4">
                <input
                  className={inputClass}
                  placeholder="Posez votre question…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && envoyer()}
                />
                <button onClick={() => envoyer()} disabled={enAttente} className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
                  Envoyer
                </button>
              </div>
            </section>
          </div>

          {/* ===== ALERTES INTELLIGENTES ===== */}
          <div className={section === 'alertes' ? '' : 'hidden'}>
            {alertes.length === 0 ? (
              <div className="rounded-xl glass border border-dashed border-white/20 p-10 text-center">
                <IconeCloche className="mx-auto h-10 w-10 text-white/30" />
                <p className="mt-4 text-white/70">Aucune alerte pour l’instant.</p>
                <p className="mt-1 text-sm text-white/50">
                  Les alertes sont générées automatiquement après chaque diagnostic :
                  état critique, capteurs en anomalie, usure accélérée, fenêtre
                  logistique et fiabilité des données.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {alertes.map((a) => {
                  const st = SEVERITE_STYLES[a.severite] || SEVERITE_STYLES.info
                  return (
                    <div
                      key={a.id}
                      className={`rounded-xl border ${st.bord} ${st.fond} p-4 ${a.lu ? 'opacity-80' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <st.Icone className={`h-5 w-5 ${st.badge.split(' ').find((c) => c.startsWith('text-'))}`} />
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${st.badge}`}>
                          {st.label}
                        </span>
                        <span className="font-semibold text-white">{a.titre}</span>
                        <span className="ml-auto text-xs text-white/40">
                          {new Date(a.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-white/75">{a.message}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            const cible = moteurs.find((m) => m.id === a.moteur)
                            if (cible) setMoteur(cible)
                            setChatInput(`Explique-moi l'alerte sur le moteur ${a.moteur} : ${a.titre}. Que dois-je faire ?`)
                            setSection('assistant')
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/10"
                        >
                          <IconeMessage className="h-3.5 w-3.5" /> Demander à l’assistant
                        </button>
                        <button
                          onClick={async () => {
                            await supprimerAlerte(a.id)
                            await rechargerAlertes()
                          }}
                          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/50 transition hover:bg-white/10"
                        >
                          Ignorer
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ===== HISTORIQUE (liste de cartes) ===== */}
          <div className={section === 'historique' ? '' : 'hidden'}>
            {historique.length === 0 ? (
              <div className="rounded-xl glass border border-dashed border-white/20 p-10 text-center">
                <IconeHorloge className="mx-auto h-10 w-10 text-white/30" />
                <p className="mt-4 text-white/70">Aucune analyse pour l’instant.</p>
                <p className="mt-1 text-sm text-white/50">
                  Chaque diagnostic effectué apparaîtra ici, avec son rapport PDF.
                </p>
                <button
                  onClick={() => setSection('diagnostic')}
                  className="mt-5 inline-flex items-center gap-2 rounded-md bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  <IconeLoupe className="h-4 w-4" /> Lancer un diagnostic
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {historique.map((row, i) => {
                  const niveau = classifierRUL(row.rul)
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-4 glass rounded-xl border border-white/10 p-4 transition hover:border-white/20 hover:bg-white/5"
                    >
                      {/* Pastille d'état */}
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
                        style={{
                          borderColor: `${niveauHex[niveau]}55`,
                          backgroundColor: `${niveauHex[niveau]}22`,
                        }}
                      >
                        <IconeMoteur className="h-5 w-5" style={{ color: niveauHex[niveau] }} />
                      </div>

                      {/* Infos principales */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <span className="font-mono text-sm font-semibold text-white">{row.moteur}</span>
                          <span className="text-xs text-white/40">Analyse du {fmtDate(row.dateISO)}</span>
                        </div>
                        <div className="mt-1 text-xs text-white/60">
                          Vols restants : <span className="font-medium text-white/90">{row.rul} vols</span>
                          {row.etat && <> · état modèle : {row.etat}</>}
                          {row.confiance != null && <> · confiance {Math.round(row.confiance * 100)}%</>}
                        </div>
                        {/* Mini barre de progression RUL */}
                        <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, (row.rul / 130) * 100)}%`,
                              backgroundColor: niveauHex[niveau],
                            }}
                          />
                        </div>
                      </div>

                      {/* Badge + rapport */}
                      <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${niveauStyle[niveau]}`}>
                        {niveau}
                      </span>
                      {row.pdfUrl && (
                        <a
                          href={row.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-sky-400/40 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/10"
                        >
                          <IconeDocument className="h-3.5 w-3.5" /> PDF
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </main>
      </div>
    </div>
  )
}
