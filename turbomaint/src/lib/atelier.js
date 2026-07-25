// ============================================================
//  Atelier de maintenance — mécaniciens + ordres de travail.
//  Workflow : le client envoie son moteur (avec rapport) à un
//  mécanicien DISPONIBLE ; le mécanicien le prend en charge puis
//  le marque « prêt » ; le client le récupère ; l'admin supervise.
//  Persistance : PostgreSQL via l'API (fonctions asynchrones).
//  Seule la SESSION du mécanicien connecté reste en localStorage.
// ============================================================
import {
  apiListeMecaniciens,
  apiAjouterMecanicien,
  apiLoginMecanicien,
  apiSetDispoMecanicien,
  apiListeOrdres,
  apiCreerOrdre,
  apiMajStatutOrdre,
} from './api.js'

// ---------- Mécaniciens ----------
export function getMecaniciens() {
  return apiListeMecaniciens()
}

export function addMecanicien({ nom, specialite, login, motDePasse }) {
  return apiAjouterMecanicien({
    nom,
    specialite,
    login,
    mot_de_passe: motDePasse,
  })
}

export function setDisponibilite(id, disponible) {
  return apiSetDispoMecanicien(id, disponible)
}

// ---------- Session mécanicien (espace Maintenance) ----------
// On stocke la fiche complète à la connexion : getSessionMecanicien
// reste synchrone (lecture localStorage), l'identité vérifiée en base.
const K_SESSION = 'tm_mec_session'

export async function loginMecanicien(login, motDePasse) {
  try {
    const mec = await apiLoginMecanicien(login, motDePasse)
    localStorage.setItem(K_SESSION, JSON.stringify(mec))
    return mec
  } catch {
    return null
  }
}

export function getSessionMecanicien() {
  try {
    return JSON.parse(localStorage.getItem(K_SESSION))
  } catch {
    return null
  }
}

export function logoutMecanicien() {
  localStorage.removeItem(K_SESSION)
}

// ---------- Ordres de maintenance ----------
// statut : 'en_attente' -> 'en_maintenance' -> 'pret' -> 'clos'
// Conversion API (snake_case) -> forme frontend (camelCase).
const ordreVersFront = (o) => ({
  id: o.id,
  moteurId: o.moteur_id,
  client: o.client_nom,
  clientEmail: o.client_email,
  rul: o.rul,
  etat: o.etat,
  mecanicienId: o.mecanicien_id,
  mecanicienNom: o.mecanicien_nom,
  pdfUrl: o.pdf_url,
  statut: o.statut,
  dateEnvoi: o.date_envoi,
  dateFin: o.date_fin,
})

/** Liste des ordres. `filtre` : {} | { client } | { mecanicien }. */
export async function getOrdres(filtre = {}) {
  const liste = await apiListeOrdres(filtre)
  return liste.map(ordreVersFront)
}

/** Ordre actif (non clos) pour un moteur donné, s'il existe. */
export async function ordreActif(moteurId, clientEmail = null) {
  const liste = await getOrdres(clientEmail ? { client: clientEmail } : {})
  return liste.find((o) => o.moteurId === moteurId && o.statut !== 'clos') || null
}

export async function creerOrdre({ moteurId, clientEmail, clientNom, rul, etat, mecanicienId, pdfUrl }) {
  const o = await apiCreerOrdre({
    moteur_id: moteurId,
    client_email: clientEmail,
    client_nom: clientNom,
    rul,
    etat,
    mecanicien_id: mecanicienId,
    pdf_url: pdfUrl,
  })
  return ordreVersFront(o)
}

// L'alerte « moteur prêt » destinée au client est créée côté serveur.
export function setStatutOrdre(id, statut) {
  return apiMajStatutOrdre(id, statut)
}

export const STATUT_LABELS = {
  en_attente: 'En attente',
  en_maintenance: 'En maintenance',
  pret: 'Prêt',
  clos: 'Clôturé',
}

export const STATUT_STYLES = {
  en_attente: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  en_maintenance: 'border-sky-500/30 bg-sky-500/15 text-sky-400',
  pret: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  clos: 'border-white/15 bg-white/5 text-white/40',
}
