import { useState } from 'react'

const COCKPIT =
  'https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=1920&q=85'
const OVERLAY = 'rgba(0,0,0,0.45)'

const inputClass =
  'w-full rounded-md border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/50 outline-none transition focus:border-white focus:bg-white/15'

export default function Contact() {
  const [form, setForm] = useState({
    nom: '',
    email: '',
    sujet: '',
    message: '',
  })
  const [sent, setSent] = useState(false)

  const update = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  const handleSend = () => {
    // Aucune API : on affiche simplement une confirmation visuelle.
    setSent(true)
  }

  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-cover bg-center bg-no-repeat px-6 py-28"
      style={{
        backgroundImage: `linear-gradient(${OVERLAY}, ${OVERLAY}), url(${COCKPIT})`,
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-black/40 p-8 backdrop-blur-md md:p-10">
        {sent ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-3xl text-emerald-400">
              ✓
            </div>
            <h2 className="text-2xl font-bold text-white">Message envoyé</h2>
            <p className="mt-3 text-white/70">
              Merci {form.nom || 'pour votre message'}. Notre équipe vous
              répondra à {form.email || 'votre adresse'} sous 48 h.
            </p>
            <button
              onClick={() => {
                setSent(false)
                setForm({ nom: '', email: '', sujet: '', message: '' })
              }}
              className="mt-8 rounded-md border border-white/40 px-6 py-2.5 text-sm font-semibold uppercase tracking-wider text-white transition hover:bg-white hover:text-black"
            >
              Envoyer un autre message
            </button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-white/60">
              Contact
            </p>
            <h1 className="text-3xl font-bold text-white">Parlons de votre flotte</h1>
            <p className="mt-2 text-sm text-white/70">
              Une question sur la maintenance prédictive ? Écrivez-nous.
            </p>

            <div className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm text-white/80">Nom</label>
                <input
                  type="text"
                  value={form.nom}
                  onChange={update('nom')}
                  placeholder="Votre nom"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/80">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  placeholder="vous@exemple.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/80">Sujet</label>
                <input
                  type="text"
                  value={form.sujet}
                  onChange={update('sujet')}
                  placeholder="Objet de votre demande"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-white/80">
                  Message
                </label>
                <textarea
                  rows={4}
                  value={form.message}
                  onChange={update('message')}
                  placeholder="Votre message…"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <button
                onClick={handleSend}
                className="w-full rounded-md bg-white px-7 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-white/90"
              >
                Envoyer
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
