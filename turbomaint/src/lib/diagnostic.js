// ============================================================
//  Module de diagnostic IA — TurboMaint
//  À partir du RUL prédit (Remaining Useful Life, en cycles),
//  produit une classification, un diagnostic, une recommandation
//  et une date de maintenance estimée.
//
//  NOTE : logique déterministe basée sur des règles métier.
//  Pour brancher un vrai LLM (Groq, Anthropic, OpenAI…), il
//  suffit de remplacer `repondreAssistant` par un appel API.
// ============================================================

// Classification en 3 états, identiques à ceux du modèle M2
// (Sain / Dégradation / Critique). Seuils alignés sur config_deploy.json :
// Critique <= SEUIL_CRITIQUE (~24), Dégradation <= SEUIL_DEGRADATION (~61).
export function classifierRUL(rul) {
  if (rul <= 25) return 'Critique'
  if (rul <= 65) return 'Dégradation'
  return 'Sain'
}

// Styles de badge Tailwind par niveau (classes explicites, pas d'interpolation)
export const niveauStyle = {
  Sain: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  Dégradation: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  Critique: 'border-red-500/30 bg-red-500/15 text-red-400',
}

// Couleurs hex (pour les SVG : jauge, donut, etc.)
export const niveauHex = {
  Sain: '#34d399',
  Dégradation: '#fbbf24',
  Critique: '#f87171',
}

const CONTENU = {
  Sain: {
    resume:
      'Le moteur fonctionne dans ses paramètres nominaux. Aucune dégradation significative détectée par le modèle.',
    recommandation:
      'Aucune action immédiate requise. Poursuivre la surveillance de routine.',
    marge: 0.15,
  },
  Dégradation: {
    resume:
      'Une dégradation est détectée. Le moteur reste exploitable mais sa trajectoire d’usure doit être suivie de près.',
    recommandation:
      'Renforcer la surveillance des capteurs et planifier une inspection préventive.',
    marge: 0.2,
  },
  Critique: {
    resume:
      'Usure avancée, fin de vie proche. Le risque de défaillance augmente sensiblement et la sécurité opérationnelle est en jeu.',
    recommandation:
      'Immobiliser le moteur et programmer une intervention prioritaire. Inspection boroscopique du compresseur HP.',
    marge: 0.35,
  },
}

// Estime une date de maintenance à partir du RUL.
// Hypothèse illustrative : 1 cycle ≈ 1 jour d'exploitation.
export function dateMaintenance(rul) {
  const niveau = classifierRUL(rul)
  const marge = CONTENU[niveau].marge
  const joursAvant = Math.max(0, Math.round(rul * (1 - marge)))
  const d = new Date()
  d.setDate(d.getDate() + joursAvant)
  return {
    joursAvant,
    date: d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
  }
}

// Marge de sécurité en vols (cohérente avec l'API et le chatbot)
export const MARGE_VOLS = 10

// Combien de VOLS reste-t-il avant la panne, à partir du RUL prédit ?
// Le RUL est directement un nombre de vols (1 vol = 1 cycle). On expose donc :
//  - volsRestants : l'estimation brute
//  - volsPlanif   : l'échéance à ne pas dépasser (marge de sécurité déduite)
export function volsAvantPanne(rul) {
  const volsRestants = Math.max(0, Math.round(rul))
  const volsPlanif = Math.max(0, Math.round(rul - MARGE_VOLS))
  return { volsRestants, volsPlanif }
}

// Diagnostic complet
export function diagnostiquer(rul) {
  const niveau = classifierRUL(rul)
  const { resume, recommandation } = CONTENU[niveau]
  const vols = volsAvantPanne(rul)
  const maint = dateMaintenance(rul)
  return {
    niveau,
    rul,
    resume,
    recommandation,
    volsRestants: vols.volsRestants,
    volsPlanif: vols.volsPlanif,
    joursAvant: maint.joursAvant, // conservé pour la console admin
    dateMaintenance: maint.date,
  }
}

// Note : l'ancien assistant à base de règles (repondreAssistant) a été retiré.
// Le portail s'appuie désormais exclusivement sur le service IA (LLM + RAG)
// via src/lib/api.js (askAssistant).
