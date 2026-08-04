// ============================================================
//  Gestion de compte côté client — TurboMaint
//  Les comptes clients sont persistés dans PostgreSQL (via l'API).
//  Le localStorage ne conserve que la SESSION locale (client
//  connecté), pour éviter de redemander la connexion à chaque page.
// ============================================================

import { apiInscrireClient, apiConnecterClient } from './api.js'

const USER_KEY = 'turbomaint_user'
const VISIT_KEY = 'turbomaint_firstVisitDone'

// Inscription : crée le compte en base avec le statut « En attente ».
// AUCUNE session n'est ouverte : le client ne pourra se connecter qu'une fois
// son compte accepté par l'administrateur.
export async function inscrireClient({ nom, email, telephone, motDePasse }) {
  return apiInscrireClient({
    email,
    nom,
    telephone,
    mot_de_passe: motDePasse,
  })
}

// Connexion : vérifie les identifiants en base, puis ouvre la session locale.
export async function connecterClient(email, motDePasse) {
  const user = await apiConnecterClient(email, motDePasse)
  saveUser(user)
  return user
}

// Cache au niveau module : garantit un résultat stable même avec
// le double-montage de React.StrictMode en développement.
let firstVisitCache = null

export function saveUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch (e) {
    // localStorage indisponible (navigation privée, etc.)
  }
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY))
  } catch (e) {
    return null
  }
}

// À appeler à l'inscription : le prochain accès au portail
// sera considéré comme la toute première visite.
export function markSignup() {
  try {
    localStorage.removeItem(VISIT_KEY)
  } catch (e) {}
  firstVisitCache = null
}

// Renvoie true UNE seule fois (la première connexion), puis false.
export function resolveFirstVisit() {
  if (firstVisitCache !== null) return firstVisitCache
  let dejaVu = false
  try {
    dejaVu = !!localStorage.getItem(VISIT_KEY)
    localStorage.setItem(VISIT_KEY, 'true')
  } catch (e) {}
  firstVisitCache = !dejaVu
  return firstVisitCache
}

export function logout() {
  try {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(VISIT_KEY)
  } catch (e) {}
  firstVisitCache = null
}

// Déduit un nom d'affichage à partir de l'email si besoin
export function nomDepuisEmail(email) {
  if (!email) return 'invité'
  const local = email.split('@')[0]
  return local.charAt(0).toUpperCase() + local.slice(1)
}
