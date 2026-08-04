import { useState, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { markSignup, inscrireClient, connecterClient } from '../lib/auth.js'
import { IconeChevronGauche, IconeChevronDroite } from '../components/Icones.jsx'

const IMG = {
  hero: 'https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=1920&q=85',
  moteur: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=85',
  hangar: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1200&q=85',
  technicien:
    'https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?w=1200&q=85',
  cockpit:
    'https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=1200&q=85',
}

const OVERLAY = 'rgba(0,0,0,0.45)'

// Indicateurs orientés client : concrets et compréhensibles sans bagage technique
const stats = [
  { value: '14', label: 'Capteurs analysés' },
  { value: '± 10', label: 'Vols de marge' },
  { value: '3', label: 'Niveaux d’alerte' },
  { value: '24/7', label: 'Surveillance continue' },
]

const solutions = [
  {
    img: '/solutions/maintenance.jpg',
    categorie: 'Prédiction',
    title: 'Pronostic RUL',
    text: 'Estimation du nombre de vols restants avant intervention pour chaque moteur, à partir de ses relevés capteurs.',
    lien: '/portail',
    action: 'Accéder au portail',
  },
  {
    img: '/solutions/prediction.webp',
    categorie: 'Supervision',
    title: 'Supervision de flotte',
    text: 'Tableau de bord temps réel des moteurs en hangar : état Sain, Dégradation ou Critique, et alerte anticipée avant la zone de risque.',
    lien: '/console',
    action: 'Ouvrir la console',
  },
  {
    img: IMG.hangar,
    categorie: 'Intervention',
    title: 'Maintenance ciblée',
    text: 'Planification des interventions au bon moment et suivi des ordres de travail par l’atelier, du diagnostic au moteur remis en service.',
    lien: '/maintenance',
    action: 'Espace maintenance',
  },
]

// Bénéfices de la maintenance prédictive (chiffres indicatifs, à ajuster)
const benefits = [
  {
    img: IMG.hangar,
    stat: '−30 %',
    title: 'Moins d’immobilisation',
    text: 'Anticiper les défaillances permet de planifier les interventions hors exploitation et de supprimer la majorité des arrêts non programmés.',
  },
  {
    img: IMG.moteur,
    stat: '−25 %',
    title: 'Coûts maîtrisés',
    text: 'Remplacer une pièce au bon moment évite les réparations lourdes en cascade et prolonge la durée de vie utile des moteurs.',
  },
  {
    img: IMG.hero,
    stat: '−70 %',
    title: 'Sécurité renforcée',
    text: 'Détecter une dégradation bien avant la zone critique réduit drastiquement le risque d’incident en vol et de panne imprévue.',
  },
]

// Style commun des champs de saisie (formulaires connexion / inscription)
const inputClass =
  'w-full rounded-md border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 outline-none transition focus:border-white focus:bg-white/15'

/* Carrousel de solutions type Tesla : grandes cartes plein-cadre,
   défilement horizontal aimanté, navigation par flèches et points. */
function SolutionsCarousel() {
  const scroller = useRef(null)
  const [index, setIndex] = useState(0)

  const allerA = (i) => {
    const el = scroller.current
    if (!el) return
    const clamp = Math.max(0, Math.min(solutions.length - 1, i))
    const carte = el.children[clamp]
    if (carte) el.scrollTo({ left: carte.offsetLeft, behavior: 'smooth' })
    setIndex(clamp)
  }

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    let proche = 0
    let min = Infinity
    Array.from(el.children).forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - el.scrollLeft)
      if (d < min) {
        min = d
        proche = i
      }
    })
    setIndex(proche)
  }

  return (
    <section className="bg-black py-20">
      <div className="mx-auto max-w-7xl px-6 text-center">
        <h2 className="text-3xl font-bold text-white md:text-4xl">Nos solutions</h2>
      </div>

      <div className="relative mt-12">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {solutions.map((card) => (
            <article
              key={card.title}
              className="relative flex aspect-[4/5] w-[80%] shrink-0 snap-center flex-col justify-between overflow-hidden rounded-2xl bg-cover bg-center sm:aspect-[16/9] md:w-[60%] lg:w-[50%]"
              style={{
                backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0.35) 100%), url(${card.img})`,
              }}
            >
              <div className="mt-auto p-8">
                <h3 className="text-3xl font-bold text-white md:text-4xl">{card.title}</h3>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/80 md:text-base">
                  {card.text}
                </p>
              </div>
            </article>
          ))}
        </div>

        {/* Flèches de navigation */}
        <button
          onClick={() => allerA(index - 1)}
          disabled={index === 0}
          aria-label="Précédent"
          className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white disabled:opacity-0 md:flex"
        >
          <IconeChevronGauche className="h-5 w-5" />
        </button>
        <button
          onClick={() => allerA(index + 1)}
          disabled={index === solutions.length - 1}
          aria-label="Suivant"
          className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition hover:bg-white disabled:opacity-0 md:flex"
        >
          <IconeChevronDroite className="h-5 w-5" />
        </button>

        {/* Points indicateurs */}
        <div className="mt-6 flex justify-center gap-2.5">
          {solutions.map((_, i) => (
            <button
              key={i}
              onClick={() => allerA(i)}
              aria-label={`Aller à la solution ${i + 1}`}
              className={`h-2.5 rounded-full transition-all ${
                index === i ? 'w-7 bg-white' : 'w-2.5 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Redirigé depuis le portail sans compte : ouvrir directement l'inscription
  const authRequise = params.get('auth') === 'required'
  // modal vaut null, 'signin' ou 'signup'
  const [modal, setModal] = useState(authRequise ? 'signup' : null)

  // Champs des formulaires (données fictives, aucune API)
  const [signin, setSignin] = useState({ email: '', password: '' })
  const [signup, setSignup] = useState({
    nom: '',
    email: '',
    password: '',
    confirm: '',
    phone: '',
  })
  const [erreur, setErreur] = useState('')
  // Message d'information (ex. compte en attente de validation) affiché en vert/ambre.
  const [infoMsg, setInfoMsg] = useState('')

  const fermer = () => {
    setModal(null)
    setErreur('')
    setInfoMsg('')
  }

  const EMAIL_RE = /^\S+@\S+\.\S+$/

  const handleSignin = async () => {
    if (!EMAIL_RE.test(signin.email)) {
      setErreur('Adresse email invalide.')
      return
    }
    if (!signin.password) {
      setErreur('Le mot de passe est obligatoire.')
      return
    }
    // Connexion : identifiants vérifiés côté PostgreSQL, puis ouverture
    // de la session locale.
    try {
      await connecterClient(signin.email, signin.password)
      navigate('/portail')
    } catch (e) {
      setErreur(e.message || 'Connexion impossible.')
    }
  }

  const handleSignup = async () => {
    // Toutes les informations du profil sont exigées AVANT l'accès au portail
    if (!signup.nom.trim()) {
      setErreur('Le nom complet est obligatoire.')
      return
    }
    if (!EMAIL_RE.test(signup.email)) {
      setErreur('Adresse email invalide.')
      return
    }
    if (signup.password.length < 6) {
      setErreur('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }
    if (signup.password !== signup.confirm) {
      setErreur('Les deux mots de passe ne correspondent pas.')
      return
    }
    if (!signup.phone.trim()) {
      setErreur('Le numéro de téléphone est obligatoire.')
      return
    }
    // Inscription : crée le compte (statut « En attente »). Le client NE PEUT PAS
    // encore accéder au portail : l'administrateur doit d'abord valider le compte.
    try {
      await inscrireClient({
        nom: signup.nom.trim(),
        email: signup.email,
        telephone: signup.phone.trim(),
        motDePasse: signup.password,
      })
      markSignup()
      setSignup({ nom: '', email: '', password: '', confirm: '', phone: '' })
      setErreur('')
      setInfoMsg(
        'Votre compte a bien été créé. Il doit être validé par l’administrateur ' +
        'avant votre première connexion. Vous pourrez ensuite vous connecter avec ' +
        'votre email et votre mot de passe.'
      )
      setModal('signin')
    } catch (e) {
      setErreur(e.message || 'Inscription impossible.')
    }
  }

  return (
    <main className="bg-black">
      {/* 1. HERO PLEIN ÉCRAN */}
      <section
        className="relative flex h-screen items-center justify-center bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `linear-gradient(${OVERLAY}, ${OVERLAY}), url(${IMG.hero})`,
        }}
      >
        <div className="px-6 text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.3em] text-white/80">
            Maintenance prédictive aéronautique
          </p>
          <h1 className="mx-auto max-w-4xl text-5xl font-extrabold leading-tight text-white sm:text-6xl md:text-7xl">
            Anticipez chaque panne moteur
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/85">
            TurboMaint estime la durée de vie restante de vos moteurs et vous
            alerte bien avant la panne.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => {
                setErreur('')
                setModal('signin')
              }}
              className="w-64 rounded-md bg-white px-8 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-white/90 sm:w-auto"
            >
              Sign in
            </button>
            <button
              onClick={() => {
                setErreur('')
                setModal('signup')
              }}
              className="w-64 rounded-md border border-white/70 bg-white/10 px-8 py-3 text-sm font-semibold uppercase tracking-wider text-white backdrop-blur transition hover:bg-white/20 sm:w-auto"
            >
              Sign up
            </button>
          </div>
        </div>
      </section>

      {/* 2. BARRE DE STATS */}
      <section className="bg-black py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl font-bold text-white md:text-5xl">
                {s.value}
              </div>
              <div className="mt-2 text-sm uppercase tracking-wider text-white/60">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. NOS SOLUTIONS — carrousel plein-cadre */}
      <SolutionsCarousel />

      {/* 4. À PROPOS — photo hangar à gauche, texte à droite */}
      <section className="bg-black">
        <div className="grid items-stretch md:grid-cols-2">
          <div
            className="min-h-[360px] bg-cover bg-center md:min-h-[520px]"
            style={{
              backgroundImage: `linear-gradient(${OVERLAY}, ${OVERLAY}), url(/solutions/supervision.jpg)`,
            }}
          />
          <div className="flex items-center bg-neutral-950 px-8 py-16 md:px-16">
            <div>
              <p className="mb-4 text-sm font-medium uppercase tracking-[0.25em] text-white/50">
                À propos
              </p>
              <h2 className="text-3xl font-bold text-white md:text-4xl">
                L'intelligence au plus près du moteur
              </h2>
              <p className="mt-6 text-white/70">
                TurboMaint analyse en continu les relevés de vos moteurs pour
                estimer leur durée de vie restante et repérer les premiers
                signes d'usure — bien avant qu'une panne ne survienne.
              </p>
              <p className="mt-4 text-white/70">
                Chaque analyse vous donne un état de santé clair, les capteurs à
                surveiller et une recommandation d'intervention. Vos données
                restent confidentielles et ne servent qu'au suivi de votre
                flotte.
              </p>
              <Link
                to="/contact"
                className="mt-8 inline-block rounded-md border border-white/40 px-7 py-3 text-sm font-semibold uppercase tracking-wider text-white transition hover:bg-white hover:text-black"
              >
                En savoir plus
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 5. POURQUOI LA MAINTENANCE PRÉDICTIVE ? */}
      <section className="bg-black py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-14 text-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.25em] text-white/50">
              Les bénéfices
            </p>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              Pourquoi la maintenance prédictive ?
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-white/60">
              Anticiper plutôt que subir : moins de temps perdu, moins de coûts,
              et surtout plus de sécurité.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {benefits.map((b) => (
              <article
                key={b.title}
                className="group relative flex min-h-[340px] flex-col justify-end overflow-hidden rounded-xl border border-white/10 bg-cover bg-center p-8"
                style={{
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.8)), url(${b.img})`,
                }}
              >
                <div className="text-5xl font-extrabold text-white">
                  {b.stat}
                </div>
                <h3 className="mt-3 text-xl font-semibold text-white">
                  {b.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/80">
                  {b.text}
                </p>
              </article>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-white/40">
            Chiffres indicatifs issus de retours d’expérience du secteur, donnés
            à titre illustratif.
          </p>
        </div>
      </section>

      {/* 6. FOOTER */}
      <footer className="bg-black py-16">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-3">
          <div>
            <div className="text-xl font-extrabold text-white">
              Turbo<span className="font-light">Maint</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-white/60">
              Maintenance prédictive pour moteurs d'avion : durée de vie
              restante, supervision de flotte et alerte anticipée.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">
              Navigation
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-white/60">
              <li>
                <Link to="/" className="hover:text-white">
                  Accueil
                </Link>
              </li>
              <li>
                <Link to="/console" className="hover:text-white">
                  Console
                </Link>
              </li>
              <li>
                <Link to="/portail" className="hover:text-white">
                  Portail
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-white">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">
              Contact
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-white/60">
              <li>contact@turbomaint.io</li>
              <li>+216 00 000 000</li>
              <li>Tunis, Tunisie</li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-12 max-w-7xl border-t border-white/10 px-6 pt-6 text-xs text-white/40">
          © {new Date().getFullYear()} TurboMaint. Projet de maintenance
          prédictive — tous droits réservés.
        </div>
      </footer>

      {/* ===== POP-UP SIGN IN / SIGN UP ===== */}
      {modal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6 py-10 backdrop-blur-sm"
          onClick={fermer}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-white/15 bg-black/60 p-8 backdrop-blur-md md:p-10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bouton fermer */}
            <button
              onClick={fermer}
              className="absolute right-5 top-5 text-2xl leading-none text-white/60 hover:text-white"
              aria-label="Fermer"
            >
              ×
            </button>

            {authRequise && (
              <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                🔒 Un compte est nécessaire pour accéder au portail client.
              </div>
            )}
            {infoMsg && (
              <div className="mb-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                ✅ {infoMsg}
              </div>
            )}
            {modal === 'signin' ? (
              <>
                <h2 className="text-2xl font-bold text-white">Sign in</h2>
                <p className="mt-2 text-sm text-white/70">
                  Connectez-vous à votre espace client.
                </p>
                <div className="mt-7 space-y-5">
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Email
                    </label>
                    <input
                      type="email"
                      value={signin.email}
                      onChange={(e) =>
                        setSignin({ ...signin, email: e.target.value })
                      }
                      placeholder="vous@exemple.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Mot de passe
                    </label>
                    <input
                      type="password"
                      value={signin.password}
                      onChange={(e) =>
                        setSignin({ ...signin, password: e.target.value })
                      }
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </div>
                  {erreur && (
                    <p className="text-sm font-medium text-red-400">{erreur}</p>
                  )}
                  <button
                    onClick={handleSignin}
                    className="w-full rounded-md bg-white px-7 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-white/90"
                  >
                    Sign in
                  </button>
                  <p className="text-center text-sm text-white/60">
                    Pas encore de compte ?{' '}
                    <button
                      onClick={() => {
                        setErreur('')
                        setInfoMsg('')
                        setModal('signup')
                      }}
                      className="font-semibold text-white underline hover:no-underline"
                    >
                      Sign up
                    </button>
                  </p>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-white">Sign up</h2>
                <p className="mt-2 text-sm text-white/70">
                  Créez votre compte pour accéder à vos prédictions.
                </p>
                <div className="mt-7 space-y-5">
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Nom complet
                    </label>
                    <input
                      type="text"
                      value={signup.nom}
                      onChange={(e) =>
                        setSignup({ ...signup, nom: e.target.value })
                      }
                      placeholder="Ex. Asma Bensalah"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Email
                    </label>
                    <input
                      type="email"
                      value={signup.email}
                      onChange={(e) =>
                        setSignup({ ...signup, email: e.target.value })
                      }
                      placeholder="vous@exemple.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Mot de passe
                    </label>
                    <input
                      type="password"
                      value={signup.password}
                      onChange={(e) =>
                        setSignup({ ...signup, password: e.target.value })
                      }
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Confirmer le mot de passe
                    </label>
                    <input
                      type="password"
                      value={signup.confirm}
                      onChange={(e) =>
                        setSignup({ ...signup, confirm: e.target.value })
                      }
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-white/80">
                      Numéro de téléphone
                    </label>
                    <input
                      type="tel"
                      value={signup.phone}
                      onChange={(e) =>
                        setSignup({ ...signup, phone: e.target.value })
                      }
                      placeholder="+216 00 000 000"
                      className={inputClass}
                    />
                  </div>
                  {erreur && (
                    <p className="text-sm font-medium text-red-400">{erreur}</p>
                  )}
                  <button
                    onClick={handleSignup}
                    className="w-full rounded-md bg-white px-7 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-white/90"
                  >
                    Créer mon compte
                  </button>
                  <p className="text-center text-sm text-white/60">
                    Déjà inscrit ?{' '}
                    <button
                      onClick={() => {
                        setErreur('')
                        setModal('signin')
                      }}
                      className="font-semibold text-white underline hover:no-underline"
                    >
                      Sign in
                    </button>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
