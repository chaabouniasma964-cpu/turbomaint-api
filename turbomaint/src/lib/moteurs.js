// ============================================================
//  Flotte du client + relevés + historique.
//  Persistance : PostgreSQL via l'API (plus de localStorage).
//  Toutes les fonctions sont ASYNCHRONES et prennent l'email du
//  client connecté comme portée (multi-client).
// ============================================================
import {
  apiListeFlotte,
  apiListeFlotteGlobale,
  apiAjouterMoteur,
  apiSupprimerMoteur,
  apiMajMoteurDiag,
  apiListeReleves,
  apiAjouterReleve,
  apiViderReleves,
  apiHistorique,
} from './api.js'

// Convertit un moteur renvoyé par l'API (snake_case) vers la forme
// attendue par le frontend (camelCase).
const versFront = (m) => ({
  id: m.id,
  modele: m.modele,
  miseEnService: m.mise_en_service,
  rul: m.rul,
  etat: m.etat,
  dernierDiag: m.dernier_diag,
})

// ---------- Moteurs (flotte) ----------
export async function getMoteurs(email) {
  const liste = await apiListeFlotte(email)
  return liste.map(versFront)
}

// Vue admin : tous les moteurs de tous les clients (avec le client rattaché).
export async function getMoteursAdmin() {
  const liste = await apiListeFlotteGlobale()
  return liste.map((m) => ({
    ...versFront(m),
    clientEmail: m.client_email,
    clientNom: m.client_nom,
  }))
}

/** Ajoute un moteur { id, modele, miseEnService }. Refuse les doublons. */
export async function addMoteur(email, { id, modele, miseEnService }) {
  await apiAjouterMoteur({
    client: email,
    id,
    modele,
    mise_en_service: miseEnService,
  })
  return getMoteurs(email)
}

export async function removeMoteur(email, id) {
  await apiSupprimerMoteur(email, id)
  return getMoteurs(email)
}

/** Met à jour un moteur après un diagnostic (rul + état). */
export async function updateMoteurDiag(email, id, { rul, etat }) {
  await apiMajMoteurDiag(email, id, rul, etat)
  return getMoteurs(email)
}

// ---------- Relevés capteurs saisis cycle par cycle ----------
// Chaque relevé = un cycle : tableau de 14 valeurs (s2…s21).
export function getReleves(email, moteurId) {
  return apiListeReleves(email, moteurId)
}

export function addReleve(email, moteurId, valeurs) {
  return apiAjouterReleve(email, moteurId, valeurs)
}

export function clearReleves(email, moteurId) {
  return apiViderReleves(email, moteurId)
}

// ---------- Historique des analyses ----------
// Dérivé de la table `diagnostics` côté API. Forme frontend :
// { moteur, rul, etat, confiance, fiable, dateISO }.
export async function getHistorique(email = null, moteur = null) {
  const rows = await apiHistorique(moteur, email)
  return rows.map((r) => ({
    moteur: r.moteur,
    rul: r.rul_predit,
    etat: r.etat,
    confiance: r.confiance,
    fiable: r.fiable,
    dateISO: r.date,
  }))
}
