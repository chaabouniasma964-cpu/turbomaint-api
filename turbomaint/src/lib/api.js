// ============================================================
//  Client API TurboMaint — appelle le backend FastAPI (models +
//  RAG/LLM + PostgreSQL). Aucun modèle installé côté navigateur.
//
//  Configuration : fichier .env à la racine du projet React :
//    VITE_API_URL=http://localhost:7860
//  Sans cette variable, les fonctionnalités IA (diagnostic,
//  chatbot) sont indisponibles côté site.
// ============================================================

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export const apiDisponible = () => Boolean(API_URL)

// Identifiant de session stable pour conserver le fil de conversation côté API
const SESSION_ID =
  sessionStorage.getItem('tm_session') ||
  (() => {
    const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem('tm_session', id)
    return id
  })()

async function post(path, body) {
  return req('POST', path, body)
}

// Helper générique GET/POST/PATCH/DELETE avec gestion d'erreur unifiée.
async function req(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(`${API_URL}${path}`, opts)
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Erreur API (${r.status})`)
  }
  return r.status === 204 ? null : r.json()
}

const enc = encodeURIComponent

/**
 * Question libre au chatbot RAG (Groq + ChromaDB + modèles).
 * `engineId` (optionnel) : moteur actuellement sélectionné sur la page,
 * transmis comme contexte si la question ne cite pas de moteur.
 */
export async function askAssistant(question, engineId = null) {
  const { answer } = await post('/chat', {
    question,
    session_id: SESSION_ID,
    engine_id: engineId,
  })
  return answer
}

/** Diagnostic live d'un nouveau moteur à partir d'un CSV de relevés bruts. */
export async function diagnoseEngine(file, engineId) {
  const form = new FormData()
  form.append('file', file)
  form.append('engine_id', engineId)
  const r = await fetch(`${API_URL}/diagnose`, { method: 'POST', body: form })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Erreur API (${r.status})`)
  }
  return r.json() // { diagnostic, briefing }
}

/** Conseil d'exploitation : « puis-je encore voler N cycles ? » */
export async function conseilExploitation(engineId, cycles) {
  const { conseil } = await post('/conseil', { engine_id: engineId, cycles })
  return conseil
}

/** URL de téléchargement du rapport PDF d'un moteur diagnostiqué en live. */
export const urlRapportPdf = (engineId) => `${API_URL}/rapport/${engineId}`

// ============================================================
//  CRUD métier persisté en PostgreSQL (via l'API FastAPI)
// ============================================================

// ---- Clients ----
export const apiInscrireClient = (c) => req('POST', '/clients', c) // {email, nom, telephone, mot_de_passe}
export const apiConnecterClient = (email, mot_de_passe) =>
  req('POST', '/clients/login', { email, mot_de_passe })
export const apiGetClient = (email) => req('GET', `/clients/${enc(email)}`)
export const apiListeClients = () => req('GET', '/clients').then((d) => d.clients)
export const apiMajStatutClient = (email, statut) =>
  req('PATCH', `/clients/${enc(email)}/statut`, { statut })
export const apiSupprimerClient = (email) => req('DELETE', `/clients/${enc(email)}`)

// ---- Mécaniciens ----
export const apiListeMecaniciens = () => req('GET', '/mecaniciens').then((d) => d.mecaniciens)
export const apiAjouterMecanicien = (m) => req('POST', '/mecaniciens', m) // {nom, specialite, login, mot_de_passe}
export const apiLoginMecanicien = (login, mot_de_passe) =>
  req('POST', '/mecaniciens/login', { login, mot_de_passe })
export const apiSetDispoMecanicien = (id, disponible) =>
  req('PATCH', `/mecaniciens/${enc(id)}/disponibilite`, { disponible })

// ---- Flotte (moteurs du client) ----
export const apiListeFlotte = (client) =>
  req('GET', `/flotte?client=${enc(client)}`).then((d) => d.moteurs)
export const apiAjouterMoteur = (m) => req('POST', '/flotte', m) // {client, id, modele, mise_en_service}
export const apiSupprimerMoteur = (client, id) =>
  req('DELETE', `/flotte/${enc(id)}?client=${enc(client)}`)
export const apiMajMoteurDiag = (client, id, rul, etat) =>
  req('PATCH', `/flotte/${enc(id)}/diag`, { client, rul, etat })

// ---- Relevés capteurs ----
export const apiListeReleves = (client, moteurId) =>
  req('GET', `/releves/${enc(moteurId)}?client=${enc(client)}`).then((d) => d.releves)
export const apiAjouterReleve = (client, moteurId, valeurs) =>
  req('POST', `/releves/${enc(moteurId)}`, { client, valeurs }).then((d) => d.releves)
export const apiViderReleves = (client, moteurId) =>
  req('DELETE', `/releves/${enc(moteurId)}?client=${enc(client)}`)

// ---- Ordres de maintenance ----
export const apiListeOrdres = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return req('GET', `/ordres${q ? '?' + q : ''}`).then((d) => d.ordres)
}
export const apiCreerOrdre = (o) => req('POST', '/ordres', o)
export const apiMajStatutOrdre = (id, statut) =>
  req('PATCH', `/ordres/${enc(id)}/statut`, { statut })

// ---- Alertes ----
export const apiListeAlertes = (client) =>
  req('GET', `/alertes?client=${enc(client)}`).then((d) => d.alertes)
export const apiAjouterAlerte = (a) => req('POST', '/alertes', a) // {client, severite, titre, message, moteur}
export const apiMarquerAlertesLues = (client) =>
  req('PATCH', `/alertes/lues?client=${enc(client)}`)
export const apiMarquerAlerteLue = (id) => req('PATCH', `/alertes/${enc(id)}/lu`)
export const apiSupprimerAlerte = (id) => req('DELETE', `/alertes/${enc(id)}`)

// ---- Historique des diagnostics ----
export const apiHistorique = (moteur) =>
  req('GET', `/historique${moteur ? '?moteur=' + enc(moteur) : ''}`).then((d) => d.historique)
