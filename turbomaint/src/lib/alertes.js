// ============================================================
//  Système d'alertes intelligentes — TurboMaint
//  5 règles croisant le diagnostic courant, l'historique et la
//  logistique. Persistance : PostgreSQL via l'API (asynchrone),
//  chaque alerte étant rattachée à l'email du client.
// ============================================================
import {
  apiListeAlertes,
  apiAjouterAlerte,
  apiMarquerAlertesLues,
  apiSupprimerAlerte,
} from './api.js'

export function getAlertes(email) {
  return apiListeAlertes(email)
}

export async function nbNonLues(email) {
  const liste = await getAlertes(email)
  return liste.filter((a) => !a.lu).length
}

export function marquerToutesLues(email) {
  return apiMarquerAlertesLues(email)
}

export function supprimerAlerte(id) {
  return apiSupprimerAlerte(id)
}

export function ajouterAlerte(email, alerte) {
  return apiAjouterAlerte({ client: email, ...alerte })
}

// ------------------------------------------------------------
// Moteur de règles : appelé après chaque diagnostic réussi.
// `precedent` = dernière entrée d'historique du MÊME moteur (ou null).
// Crée les alertes correspondantes en base (pour `email`).
// ------------------------------------------------------------
export async function genererAlertesDiagnostic(email, diag, precedent) {
  const m = diag.moteur
  const nouvelles = []

  // Règle 1 — État critique
  if (diag.etat_predit === 'Critique') {
    nouvelles.push({
      severite: 'critique',
      titre: `Moteur ${m} en état CRITIQUE`,
      message:
        `Il reste ~${Math.round(diag.rul_predit)} vols avant la panne. ` +
        `Immobilisation recommandée et inspection du compresseur haute ` +
        `pression en priorité.`,
      moteur: m,
    })
  }

  // Règle 2 — Capteurs en anomalie confirmée (M3)
  const anomalies = (diag.capteurs_anormaux || []).filter((c) => c.niveau === 'anomalie')
  if (anomalies.length) {
    nouvelles.push({
      severite: 'elevee',
      titre: `${anomalies.length} capteur${anomalies.length > 1 ? 's' : ''} en anomalie confirmée — ${m}`,
      message: anomalies
        .map((c) => `${c.capteur} (${c.description}) : ${c.derive}, score ${c.score_anomalie}`)
        .join(' · '),
      moteur: m,
    })
  }

  // Règle 3 — Usure accélérée : chute de RUL anormale entre deux analyses
  if (precedent && precedent.rul - diag.rul_predit > 20) {
    nouvelles.push({
      severite: 'elevee',
      titre: `Usure accélérée détectée — ${m}`,
      message:
        `Les vols restants sont passés de ${Math.round(precedent.rul)} à ` +
        `${Math.round(diag.rul_predit)} depuis l'analyse du ` +
        `${new Date(precedent.dateISO).toLocaleDateString('fr-FR')} ` +
        `(−${Math.round(precedent.rul - diag.rul_predit)} vols). Trajectoire de ` +
        `dégradation anormalement rapide : surveillance renforcée et nouveau ` +
        `diagnostic rapproché requis.`,
      moteur: m,
    })
  }

  // Règle 4 — Fenêtre logistique : réserve < délai de commande des pièces (20-40 cycles)
  if (diag.etat_predit === 'Dégradation' && diag.rul_predit - 10 < 40) {
    nouvelles.push({
      severite: 'moyenne',
      titre: `Fenêtre logistique courte — ${m}`,
      message:
        `Réserve prudente ~${Math.max(0, Math.round(diag.rul_predit - 10))} vols ` +
        `pour un délai de commande des pièces de 20 à 40 vols : lancer la commande ` +
        `MAINTENANT pour éviter une immobilisation prolongée.`,
      moteur: m,
    })
  }

  // Règle 5 — Fiabilité du diagnostic à vérifier.
  // On ignore l'avertissement automatique sur le nombre de cycles ; seuls les
  // avertissements de fond (capteur hors domaine, etc.) déclenchent une alerte.
  const avertPertinents = (diag.avertissements || []).filter(
    (a) => !/cycle|indicative/i.test(a)
  )
  if (avertPertinents.length > 0) {
    nouvelles.push({
      severite: 'info',
      titre: `Fiabilité du diagnostic à vérifier — ${m}`,
      message: avertPertinents.join(' | '),
      moteur: m,
    })
  }

  // Insertion en base (la plus ancienne d'abord pour l'ordre chronologique).
  for (const a of [...nouvelles].reverse()) {
    await apiAjouterAlerte({ client: email, ...a })
  }
  return nouvelles
}
