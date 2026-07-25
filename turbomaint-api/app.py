# ============================================================================
# TurboMaint API — VERSION ALLÉGÉE (empreinte mémoire ~150 Mo)
#
# Chatbot + diagnostic live + conseil d'exploitation + rapport PDF, avec :
#   - Inférence des 3 LSTM en NumPy pur (poids .npz)  -> pas de TensorFlow
#   - Base de connaissances (4 fichiers .md, ~5 Ko) injectée directement
#     dans le prompt Groq                              -> pas de ChromaDB/RAG
#   - Appel REST direct à l'API Groq                   -> pas de LangChain
#   - Persistance PostgreSQL (clients, mécaniciens, moteurs, ordres, alertes,
#     diagnostics) via la variable DATABASE_URL
# ============================================================================
import os, re, io, json, glob, tempfile, time
import numpy as np
import pandas as pd
import requests
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from numpy_models import RegresseurLSTM, AutoencoderLSTM, ScalerMinMax

# ---------------------------------------------------------------------------
# Chemins + configuration
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
ART  = os.path.join(ROOT, "artifacts")
KB   = os.path.join(ROOT, "kb")

MAE_MODELE = 10
GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

with open(os.path.join(ART, "config_deploy.json"), encoding="utf-8") as f:
    CFG = json.load(f)
FEATURES = CFG["FEATURES"]
W        = CFG["WINDOW"]
RUL_CAP  = CFG["RUL_CAP"]
LABELS   = ["Sain", "Dégradation", "Critique"]

SENSOR_INFO = {
    "s2": "T24 temp. sortie compresseur BP", "s3": "T30 temp. sortie compresseur HP",
    "s4": "T50 temp. sortie turbine BP",     "s7": "P30 pression sortie compresseur HP",
    "s8": "Nf vitesse fan",                  "s9": "Nc vitesse corps HP",
    "s11": "Ps30 pression statique HPC",     "s12": "phi débit carburant/Ps30",
    "s13": "NRf vitesse corrigée fan",       "s14": "NRc vitesse corrigée HP",
    "s15": "BPR taux de dilution",           "s17": "htBleed enthalpie prélèvement",
    "s20": "W31 refroidissement turbine HP", "s21": "W32 refroidissement turbine BP",
}

# ---------------------------------------------------------------------------
# Chargement des modèles (poids NumPy) + stats + base historique
# ---------------------------------------------------------------------------
print("Chargement des modèles (NumPy)…")
m1 = RegresseurLSTM(os.path.join(ART, "modele1_rul_poids.npz"))
m2 = RegresseurLSTM(os.path.join(ART, "modele2_etat_lstm_poids.npz"), softmax=True)
ae = AutoencoderLSTM(os.path.join(ART, "modele3_anomalies_poids.npz"))
with open(os.path.join(ART, "scaler.json"), encoding="utf-8") as f:
    scaler = ScalerMinMax(json.load(f))
stats = np.load(os.path.join(ART, "stats_anomalies.npz"))
mu_err, sd_err = stats["mu_err"].astype(np.float64), stats["sd_err"].astype(np.float64)
mu_h,   sd_h   = stats["mu_h"].astype(np.float64),   stats["sd_h"].astype(np.float64)
print("Modèles chargés.")

recap_df = pd.read_csv(os.path.join(ART, "recap_final.csv"))
with open(os.path.join(ART, "diagnostics_anomalies_capteurs.json"), encoding="utf-8") as f:
    diag_map = {d["moteur"]: d for d in json.load(f)}

# ---------------------------------------------------------------------------
# Base de données PostgreSQL (via DATABASE_URL)
# En développement local : lancer un PostgreSQL et exporter DATABASE_URL.
# Sans DATABASE_URL, l'API démarre mais sans persistance (mode dégradé).
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL")

def _db():
    import psycopg2
    return psycopg2.connect(DATABASE_URL)

def _run(sql, params=(), fetch=None):
    """Exécute une requête SQL. fetch : None | 'one' | 'all'.
    Renvoie un dict (one), une liste de dicts (all) ou None.
    Gère commit / rollback / fermeture de la connexion."""
    from psycopg2.extras import RealDictCursor
    conn = _db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            out = (cur.fetchone() if fetch == "one"
                   else cur.fetchall() if fetch == "all" else None)
        conn.commit()
        return out
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

# Équipe de mécaniciens de démonstration (insérée au premier démarrage).
SEED_MECANICIENS = [
    ("mec-1", "Karim Haddad",     "Compresseur HP",             True,  "karim",   "mec123"),
    ("mec-2", "Sara Mejri",       "Turbines & refroidissement", True,  "sara",    "mec123"),
    ("mec-3", "Youssef Trabelsi", "Régulation & capteurs",      False, "youssef", "mec123"),
    ("mec-4", "Leïla Gharbi",     "Révision générale",          True,  "leila",   "mec123"),
]

def db_init():
    with _db() as conn, conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS diagnostics (
            id SERIAL PRIMARY KEY,
            moteur TEXT NOT NULL,
            date TIMESTAMPTZ NOT NULL DEFAULT now(),
            rul_predit REAL,
            etat TEXT,
            confiance REAL,
            fiable BOOLEAN,
            details JSONB)""")

        cur.execute("""CREATE TABLE IF NOT EXISTS clients (
            email TEXT PRIMARY KEY,
            nom TEXT NOT NULL,
            telephone TEXT,
            mot_de_passe TEXT NOT NULL,
            date_creation TIMESTAMPTZ NOT NULL DEFAULT now())""")

        cur.execute("""CREATE TABLE IF NOT EXISTS mecaniciens (
            id TEXT PRIMARY KEY,
            nom TEXT NOT NULL,
            specialite TEXT,
            disponible BOOLEAN NOT NULL DEFAULT true,
            login TEXT UNIQUE NOT NULL,
            mot_de_passe TEXT NOT NULL)""")

        cur.execute("""CREATE TABLE IF NOT EXISTS flotte (
            id TEXT NOT NULL,
            client_email TEXT NOT NULL REFERENCES clients(email) ON DELETE CASCADE,
            modele TEXT,
            mise_en_service TEXT,
            rul REAL,
            etat TEXT,
            dernier_diag TIMESTAMPTZ,
            PRIMARY KEY (client_email, id))""")

        cur.execute("""CREATE TABLE IF NOT EXISTS releves (
            id SERIAL PRIMARY KEY,
            client_email TEXT NOT NULL,
            moteur_id TEXT NOT NULL,
            valeurs JSONB NOT NULL,
            date TIMESTAMPTZ NOT NULL DEFAULT now())""")

        cur.execute("""CREATE TABLE IF NOT EXISTS ordres (
            id TEXT PRIMARY KEY,
            moteur_id TEXT NOT NULL,
            client_email TEXT,
            client_nom TEXT,
            rul REAL,
            etat TEXT,
            mecanicien_id TEXT,
            mecanicien_nom TEXT,
            pdf_url TEXT,
            statut TEXT NOT NULL DEFAULT 'en_attente',
            date_envoi TIMESTAMPTZ NOT NULL DEFAULT now(),
            date_fin TIMESTAMPTZ)""")

        cur.execute("""CREATE TABLE IF NOT EXISTS alertes (
            id TEXT PRIMARY KEY,
            client_email TEXT,
            severite TEXT,
            titre TEXT,
            message TEXT,
            moteur TEXT,
            ts TIMESTAMPTZ NOT NULL DEFAULT now(),
            lu BOOLEAN NOT NULL DEFAULT false)""")

        # Colonne ajoutée après coup : idempotent pour les bases existantes.
        cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS "
                    "statut TEXT NOT NULL DEFAULT 'Actif'")

        for m in SEED_MECANICIENS:
            cur.execute("INSERT INTO mecaniciens (id, nom, specialite, disponible, "
                        "login, mot_de_passe) VALUES (%s,%s,%s,%s,%s,%s) "
                        "ON CONFLICT (id) DO NOTHING", m)

def db_save_diagnostic(diag):
    """Enregistre un diagnostic ; silencieux si pas de BD configurée."""
    if not DATABASE_URL:
        return
    try:
        try:
            with _db() as conn, conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO diagnostics (moteur, rul_predit, etat, confiance, "
                    "fiable, details) VALUES (%s, %s, %s, %s, %s, %s)",
                    (diag["moteur"], diag["rul_predit"], diag["etat_predit"],
                     diag["confiance"], diag["fiable"],
                     json.dumps(diag, ensure_ascii=False)))
        except Exception:
            # La BD démarrait peut-être encore : (re)créer la table et réessayer
            db_init()
            with _db() as conn, conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO diagnostics (moteur, rul_predit, etat, confiance, "
                    "fiable, details) VALUES (%s, %s, %s, %s, %s, %s)",
                    (diag["moteur"], diag["rul_predit"], diag["etat_predit"],
                     diag["confiance"], diag["fiable"],
                     json.dumps(diag, ensure_ascii=False)))
    except Exception as e:
        print(f"BD : sauvegarde impossible ({e}) — diagnostic non persisté.")

if DATABASE_URL:
    # La base (conteneur "db") peut mettre quelques secondes à accepter les
    # connexions après le démarrage. On réessaie plutôt que d'abandonner.
    for tentative in range(1, 16):
        try:
            db_init()
            print("Base de données prête (clients, mécaniciens, flotte, relevés, "
                  "ordres, alertes, diagnostics).")
            break
        except Exception as e:
            print(f"BD pas encore prête (essai {tentative}/15) : {e}")
            time.sleep(2)
    else:
        print("BD injoignable après 15 essais — l'API démarre sans tables.")
else:
    print("Pas de DATABASE_URL — API sans persistance (mode dégradé).")

# Base de connaissances : tout le contenu des .md (petit) va dans le prompt
KB_TEXT = "\n\n".join(
    open(p, encoding="utf-8").read() for p in sorted(glob.glob(os.path.join(KB, "*.md"))))
print(f"Base de connaissances : {len(KB_TEXT)} caractères (dans le prompt).")

# ---------------------------------------------------------------------------
# M3 : scores d'anomalie + capteurs suspects (logique du pipeline Colab)
# ---------------------------------------------------------------------------
def scores_anomalie(fenetre):
    rec = ae.predict(fenetre)
    err = np.mean((fenetre - rec) ** 2, axis=0)
    score_recon = (err - mu_err) / sd_err
    var_ratio   = fenetre[-15:].std(axis=0) / (sd_h + 1e-9)
    score_stuck = np.clip((0.5 - var_ratio) / 0.5, 0, None) * 4.0
    return np.maximum(score_recon, score_stuck)

def capteurs_suspects(fenetre, top_k=3):
    s = scores_anomalie(fenetre)
    sens = fenetre[-10:].mean(axis=0) - mu_h
    var_ratio = fenetre[-15:].std(axis=0) / (sd_h + 1e-9)
    out = []
    for j in np.argsort(-s)[:top_k]:
        if s[j] >= CFG["SEUIL_SURVEILLANCE"]:
            niveau = ("anomalie" if s[j] >= CFG["SEUIL_ANOMALIE_CONFIRMEE"]
                      else "surveillance")
            derive = ("capteur figé" if var_ratio[j] < 0.5 else
                      "hausse" if sens[j] > 0 else "chute")
            out.append({"capteur": FEATURES[j], "description": SENSOR_INFO[FEATURES[j]],
                        "score_anomalie": round(float(s[j]), 2),
                        "niveau": niveau, "derive": derive})
    return out

# ---------------------------------------------------------------------------
# Diagnostic live (M1 + M2 + M3)
# ---------------------------------------------------------------------------
live_registry = {}

def diagnostiquer_nouveau_moteur(engine_id, donnees_brutes):
    manquants = [f for f in FEATURES if f not in donnees_brutes.columns]
    if manquants:
        raise ValueError(f"Colonnes capteurs manquantes : {manquants}")
    X_raw = donnees_brutes[FEATURES].values.astype(np.float64)
    n_cycles = len(X_raw)
    if np.isnan(X_raw).any():
        raise ValueError("Valeurs manquantes (NaN) dans les relevés.")

    X_scaled = scaler.transform(X_raw)
    if n_cycles < W:
        X_scaled = np.vstack([np.repeat(X_scaled[:1], W - n_cycles, axis=0), X_scaled])
    fen = X_scaled[-W:]

    # Note : on n'émet plus d'avertissement sur le nombre de cycles. La saisie
    # se fait volontairement sur un relevé unique (complété par répétition) ;
    # signaler « prédiction indicative » n'a pas de sens côté client.
    avertissements = []
    lo, hi = scaler.data_min, scaler.data_max
    recent = X_raw[-min(n_cycles, W):]
    for j, feat in enumerate(FEATURES):
        marge = 0.05 * (hi[j] - lo[j])
        if np.mean((recent[:, j] < lo[j] - marge) | (recent[:, j] > hi[j] + marge)) > 0.2:
            avertissements.append(f"Capteur {feat} hors domaine d'entraînement "
                                  f"— prédiction NON fiable.")

    rul = float(np.clip(m1.predict(fen), 0, RUL_CAP))
    probas = m2.predict(fen)
    etat, conf = LABELS[int(np.argmax(probas))], float(probas.max())

    diag = {"moteur": str(engine_id), "rul_predit": round(rul, 1),
            "intervalle": [round(max(0, rul - MAE_MODELE)), round(rul + MAE_MODELE)],
            "etat_predit": etat, "confiance": round(conf, 3),
            "nb_cycles_fournis": int(n_cycles),
            "fiable": not any("NON fiable" in a for a in avertissements),
            "avertissements": avertissements,
            "capteurs_anormaux": capteurs_suspects(fen)}
    live_registry[str(engine_id)] = diag
    db_save_diagnostic(diag)
    return diag

# ---------------------------------------------------------------------------
# Lookups (base historique + registre live)
# ---------------------------------------------------------------------------
def lookup_moteur(num):
    row = recap_df[recap_df["Moteur"] == num]
    if row.empty:
        return None
    r = row.iloc[0]
    txt = (f"Moteur {num} (base historique) : RUL prédit (M1) = "
           f"{r['RUL prédit (M1)']} cycles (réel : {r['RUL réel']}). "
           f"État prédit (M2) = {r['État (LSTM)']} (réel : {r['État réel']}). "
           f"Erreur RUL = {r['Erreur RUL']} cycles.")
    d = diag_map.get(num)
    if d and d["capteurs_anormaux"]:
        caps = " ; ".join(
            f"{s['capteur']} ({s['description']}) : {s['derive']}, "
            f"score {s['score_anomalie']}, niveau {s['niveau'].upper()}"
            for s in d["capteurs_anormaux"])
        txt += f"\nDiagnostic capteurs (M3) : {caps}."
    else:
        txt += "\nDiagnostic capteurs (M3) : aucun capteur signalé."
    return txt

def lookup_live(engine_id):
    d = live_registry.get(str(engine_id))
    if not d:
        return None
    txt = (f"Moteur client {d['moteur']} (diagnostic EN DIRECT) : RUL prédit = "
           f"{d['rul_predit']} cycles (intervalle {d['intervalle'][0]}-"
           f"{d['intervalle'][1]}). État = {d['etat_predit']} "
           f"(confiance {d['confiance']:.0%}). {d['nb_cycles_fournis']} cycles fournis.")
    if d["avertissements"]:
        txt += f"\nAvertissements : {' | '.join(d['avertissements'])}"
    if d["capteurs_anormaux"]:
        caps = " ; ".join(f"{s['capteur']} ({s['description']}) : {s['derive']}, "
                          f"score {s['score_anomalie']}, niveau {s['niveau'].upper()}"
                          for s in d["capteurs_anormaux"])
        txt += f"\nDiagnostic capteurs (M3) : {caps}."
    else:
        txt += "\nDiagnostic capteurs (M3) : aucun capteur signalé."
    return txt

# ---------------------------------------------------------------------------
# LLM Groq (appel REST direct) + prompt système avec connaissances intégrées
# ---------------------------------------------------------------------------
def groq_chat(messages, temperature=0.2, max_tokens=1024):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY manquante (à définir dans l'environnement de l'API).")
    r = requests.post(GROQ_URL,
                      headers={"Authorization": f"Bearer {key}"},
                      json={"model": GROQ_MODEL, "messages": messages,
                            "temperature": temperature, "max_tokens": max_tokens},
                      timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

SYSTEM_PROMPT = f"""Tu es TurboMaint Assistant, l'assistant de diagnostic du système
de maintenance prédictive TurboMaint pour moteurs turbofan (NASA C-MAPSS FD001).

Tu disposes de : RUL prédit (M1), état de santé (M2 : Sain/Dégradation/Critique),
diagnostic capteurs (M3 : "surveillance" = dérive débutante, "anomalie" =
confirmée). Les moteurs viennent de la base historique (1-100) ou d'un
diagnostic EN DIRECT d'un moteur client.

Règles :
1. Réponds UNIQUEMENT depuis la BASE DE CONNAISSANCES ci-dessous et les DONNÉES
   MOTEUR fournies. Si l'information manque, dis-le — n'invente jamais de chiffres.
2. Pour un diagnostic : RUL avec intervalle, état, capteurs signalés avec sens
   de dérive, cause probable, action recommandée. Rappelle la marge (~10 cycles).
3. Distingue "surveillance" (alerte précoce) et "anomalie" (confirmée).
   Un moteur Sain avec capteurs en surveillance est normal.
4. Si des avertissements existent, mentionne-les et nuance la fiabilité.
5. Les causes sont des hypothèses (mode de panne HPC documenté) : recommande
   toujours l'inspection pour confirmer.
6. Réponds en français, concis, technique mais clair.

=== BASE DE CONNAISSANCES ===
{KB_TEXT}
=== FIN DE LA BASE DE CONNAISSANCES ==="""

# ---------------------------------------------------------------------------
# Routage hybride : live -> historique, historique de conversation par session
# ---------------------------------------------------------------------------
sessions = {}   # session_id -> {"history": [...], "last_engine": str|None}
ID_RE = re.compile(r"moteur\s+([A-Za-z0-9\-_]+)", re.IGNORECASE)

def _engine_info(ident):
    info = lookup_live(ident)
    if info is None and str(ident).isdigit():
        info = lookup_moteur(int(ident))
    return info

def answer(question, session_id="default", engine_id=None):
    sess = sessions.setdefault(session_id, {"history": [], "last_engine": None})
    engine_context = ""
    m = ID_RE.search(question)
    ident = m.group(1) if m else engine_id
    if ident:
        info = _engine_info(ident)
        if info:
            sess["last_engine"] = ident
            engine_context = f"\n\nDONNÉES MOTEUR :\n{info}"
        elif m:
            engine_context = (f"\n\nDONNÉES MOTEUR : moteur '{ident}' inconnu — "
                              f"ni diagnostiqué en direct, ni dans la base 1-100.")
    elif sess["last_engine"] and re.search(r"\b(il|ce moteur|lui|son|sa|ses)\b",
                                           question, re.IGNORECASE):
        info = _engine_info(sess["last_engine"])
        if info:
            engine_context = f"\n\nDONNÉES MOTEUR (suivi) :\n{info}"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for role, content in sess["history"][-6:]:
        messages.append({"role": role, "content": content})
    messages.append({"role": "user",
                     "content": f"{engine_context}\n\nQUESTION : {question}".strip()})
    response = groq_chat(messages)
    sess["history"] += [("user", question), ("assistant", response)]
    return response

# ---------------------------------------------------------------------------
# Copilote : briefing + conseil d'exploitation
# ---------------------------------------------------------------------------
BRIEFING_PROMPT = f"""Tu es TurboMaint Assistant. Génère un BRIEFING DE DIAGNOSTIC
proactif et structuré (8-12 lignes max) pour l'ingénieur de maintenance, à partir
du diagnostic JSON fourni et de la base de connaissances ci-dessous. Structure :
1. Verdict : état + nombre de VOLS restants avant la panne, et le nombre de vols
   à ne pas dépasser avant intervention (durée de vie estimée moins 10 vols).
2. Capteurs signalés : lesquels, sens de dérive, niveau, interprétation physique
   (chaîne causale du compresseur haute pression si pertinente).
3. Recommandation opérationnelle selon l'état, en intégrant la logistique :
   si le délai de commande de pièces (20-40 vols) dépasse la réserve restante,
   signale le risque d'immobilisation prolongée.

RÈGLES DE FORME (impératives) :
- Parle toujours en VOLS, jamais en « cycles ».
- N'affiche jamais d'intervalle chiffré (pas de « 115-135 ») : une seule valeur.
- N'utilise AUCUN formatage markdown : pas de **, pas de #, pas de tirets de liste
  en début de ligne. Rédige en phrases et paragraphes simples.
- Ne mentionne jamais le nombre de relevés fournis ni la « fiabilité » liée au
  volume de données : ce point ne concerne pas le client.
Reste factuel, aucune invention. Marge d'erreur : environ 10 vols.

=== BASE DE CONNAISSANCES ===
{KB_TEXT}
=== FIN ==="""

def briefing_auto(engine_id):
    d = live_registry.get(str(engine_id))
    if not d:
        return f"Aucun diagnostic pour le moteur {engine_id}."
    return groq_chat([{"role": "system", "content": BRIEFING_PROMPT},
                      {"role": "user",
                       "content": f"DIAGNOSTIC JSON :\n{json.dumps(d, ensure_ascii=False)}"}])

def conseil_vol(engine_id, cycles_demandes):
    d = live_registry.get(str(engine_id))
    if not d:
        return f"Aucun diagnostic pour le moteur {engine_id}."
    rul, etat = d["rul_predit"], d["etat_predit"]
    rul_prudent = max(0, rul - MAE_MODELE)
    marge_apres = rul_prudent - cycles_demandes
    caps_anomalie = [s["capteur"] for s in d["capteurs_anormaux"]
                     if s["niveau"] == "anomalie"]
    caps_surv = [s["capteur"] for s in d["capteurs_anormaux"]
                 if s["niveau"] == "surveillance"]

    if etat == "Critique":
        return (
            f"❌ RECOMMANDATION FERME : NE PAS exploiter le moteur {engine_id} "
            f"{cycles_demandes} cycles supplémentaires.\n"
            f"Moteur en état CRITIQUE : RUL estimé {rul} cycles, sous le seuil "
            f"critique ({CFG['SEUIL_CRITIQUE']} cycles). La marge d'erreur "
            f"(±{MAE_MODELE} cycles) ne couvre plus le risque : le RUL réel "
            f"pourrait être aussi bas que {rul_prudent} cycles.\n"
            f"Actions : immobilisation et inspection immédiate"
            + (f" — inspection prioritaire guidée par les capteurs en anomalie : "
               f"{', '.join(caps_anomalie)}." if caps_anomalie else "."))
    if etat == "Dégradation":
        if marge_apres > 0:
            return (
                f"⚠️ EXPLOITATION POSSIBLE SOUS CONDITIONS pour {cycles_demandes} "
                f"cycles.\nMoteur {engine_id} en DÉGRADATION. RUL estimé {rul} "
                f"cycles ; borne prudente (RUL − {MAE_MODELE}) = {rul_prudent} "
                f"cycles. Après {cycles_demandes} cycles, réserve restante "
                f"~{marge_apres} cycles.\nConditions : (1) planifier DÈS "
                f"MAINTENANT la maintenance préventive avant le cycle "
                f"{rul_prudent} (pièces : délai 20-40 cycles) ; (2) surveillance "
                f"renforcée des capteurs : "
                f"{', '.join(caps_anomalie + caps_surv) or 'aucun'} ; "
                f"(3) re-diagnostiquer à mi-parcours (cycle +{cycles_demandes // 2}).")
        return (
            f"❌ DÉCONSEILLÉ : {cycles_demandes} cycles dépassent la réserve "
            f"prudente du moteur {engine_id}.\nRUL estimé {rul} cycles, borne "
            f"prudente {rul_prudent} cycles ({marge_apres} cycles de marge). "
            f"Recommandation : limiter à {max(0, int(rul_prudent) - 5)} cycles "
            f"maximum et planifier l'atelier immédiatement. Surveillance "
            f"renforcée : {', '.join(caps_anomalie + caps_surv) or 'aucun capteur signalé'}.")
    return (
        f"✅ EXPLOITATION NORMALE : moteur {engine_id} SAIN "
        f"(RUL estimé {rul} cycles, borne prudente {rul_prudent}). "
        f"{cycles_demandes} cycles supplémentaires ne posent pas de problème."
        + (f" Note : capteurs en surveillance précoce ({', '.join(caps_surv)}) "
           f"— dérive débutante sans impact, à suivre." if caps_surv else ""))

# ---------------------------------------------------------------------------
# Rapport PDF (reportlab)
# ---------------------------------------------------------------------------
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, HRFlowable)
from reportlab.lib import colors

RAPPORT_PROMPT = f"""Rédige les sections texte d'un rapport de maintenance
professionnel à partir du diagnostic JSON et de la base de connaissances
ci-dessous. Réponds UNIQUEMENT en JSON avec ces clés :
{{"synthese": "3-4 phrases : verdict, RUL, gravité, urgence",
 "interpretation": "4-6 phrases : interprétation physique des capteurs signalés,
  chaîne causale probable, en distinguant anomalies confirmées et surveillances",
 "plan_action": ["action 1 avec échéance", "action 2", "action 3"],
 "reserves": "2-3 phrases : marge d'erreur, avertissements, limites"}}
Aucune invention. Ton factuel d'ingénieur.

=== BASE DE CONNAISSANCES ===
{KB_TEXT}
=== FIN ==="""

def rapport_pdf(engine_id, chemin):
    d = live_registry.get(str(engine_id))
    if not d:
        return None
    rep = groq_chat([{"role": "system", "content": RAPPORT_PROMPT},
                     {"role": "user",
                      "content": f"DIAGNOSTIC :\n{json.dumps(d, ensure_ascii=False)}"}])
    try:
        sections = json.loads(rep.replace("```json", "").replace("```", "").strip())
    except Exception:
        sections = {"synthese": rep[:400], "interpretation": "",
                    "plan_action": [], "reserves": f"Marge ±{MAE_MODELE} cycles."}

    styles = getSampleStyleSheet()
    titre_style = ParagraphStyle("T", parent=styles["Title"], fontSize=16)
    h_style = ParagraphStyle("H", parent=styles["Heading2"],
                             textColor=colors.HexColor("#1a5276"))
    doc = SimpleDocTemplate(chemin, pagesize=A4, topMargin=1.5*cm, bottomMargin=1.5*cm)
    el = [Paragraph("RAPPORT DE DIAGNOSTIC — TurboMaint", titre_style),
          Paragraph(f"Moteur : <b>{d['moteur']}</b> — "
                    f"{datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]),
          HRFlowable(width="100%", color=colors.grey), Spacer(1, 8)]

    etat_coul = {"Sain": "#1e8449", "Dégradation": "#b9770e",
                 "Critique": "#c0392b"}[d["etat_predit"]]
    resume = Table([
        ["État prédit", "RUL estimé", "Intervalle", "Confiance", "Cycles fournis"],
        [d["etat_predit"], f"{d['rul_predit']} cycles",
         f"{d['intervalle'][0]}–{d['intervalle'][1]}",
         f"{d['confiance']:.0%}", str(d["nb_cycles_fournis"])]],
        colWidths=[3.4*cm]*5)
    resume.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a5276")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (0, 1), colors.HexColor(etat_coul)),
        ("TEXTCOLOR", (0, 1), (0, 1), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    el += [resume, Spacer(1, 12),
           Paragraph("1. Synthèse exécutive", h_style),
           Paragraph(sections.get("synthese", ""), styles["Normal"]), Spacer(1, 8),
           Paragraph("2. Capteurs signalés (module M3)", h_style)]

    if d["capteurs_anormaux"]:
        rows = [["Capteur", "Description", "Dérive", "Score", "Niveau"]]
        for s in d["capteurs_anormaux"]:
            rows.append([s["capteur"], s["description"][:34], s["derive"],
                         str(s["score_anomalie"]), s["niveau"].upper()])
        t = Table(rows, colWidths=[1.8*cm, 7.2*cm, 2.8*cm, 1.8*cm, 3.2*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a5276")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 8)]))
        el.append(t)
    else:
        el.append(Paragraph("Aucun capteur signalé.", styles["Normal"]))

    el += [Spacer(1, 8), Paragraph("3. Interprétation physique", h_style),
           Paragraph(sections.get("interpretation", ""), styles["Normal"]),
           Spacer(1, 8), Paragraph("4. Plan d'action recommandé", h_style)]
    for i, action in enumerate(sections.get("plan_action", []), 1):
        el.append(Paragraph(f"{i}. {action}", styles["Normal"]))
    el += [Spacer(1, 8), Paragraph("5. Réserves méthodologiques", h_style),
           Paragraph(sections.get("reserves", ""), styles["Normal"])]
    if d.get("avertissements"):
        el.append(Paragraph("Avertissements système : " +
                            " | ".join(d["avertissements"]), styles["Normal"]))
    el += [Spacer(1, 10), HRFlowable(width="100%", color=colors.grey),
           Paragraph("Généré automatiquement par TurboMaint. Diagnostic "
                     "indicatif à confirmer par inspection. Réf. capteurs : "
                     "Saxena et al., PHM08 2008.",
                     ParagraphStyle("F", parent=styles["Normal"], fontSize=7,
                                    textColor=colors.grey))]
    doc.build(el)
    return chemin

# ---------------------------------------------------------------------------
# API FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(title="TurboMaint API", version="2.0-lite")

# CORS : autoriser le site front (mettre l'URL exacte du site en production)
origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_methods=["*"], allow_headers=["*"])

class ChatIn(BaseModel):
    question: str
    session_id: str = "default"
    engine_id: str | None = None   # contexte moteur optionnel envoyé par le site

class ConseilIn(BaseModel):
    engine_id: str
    cycles: int

@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0-lite",
            "modeles": ["M1 LSTM RUL (NumPy)", "M2 LSTM état (NumPy)",
                        "M3 AE anomalies (NumPy)"],
            "kb_chars": len(KB_TEXT)}

@app.post("/chat")
def chat(body: ChatIn):
    try:
        return {"answer": answer(body.question, body.session_id, body.engine_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/diagnose")
async def diagnose(file: UploadFile = File(...), engine_id: str = Form(...)):
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
        diag = diagnostiquer_nouveau_moteur(engine_id, df)
        return {"diagnostic": diag, "briefing": briefing_auto(engine_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/conseil")
def conseil(body: ConseilIn):
    return {"conseil": conseil_vol(body.engine_id, body.cycles)}

@app.get("/rapport/{engine_id}")
def rapport(engine_id: str):
    chemin = os.path.join(tempfile.gettempdir(), f"rapport_{engine_id}.pdf")
    if rapport_pdf(engine_id, chemin) is None:
        raise HTTPException(status_code=404,
                            detail=f"Moteur '{engine_id}' non diagnostiqué.")
    return FileResponse(chemin, media_type="application/pdf",
                        filename=f"rapport_{engine_id}.pdf")

@app.get("/historique")
def historique(moteur: str | None = None, limit: int = 50):
    """Diagnostics passés enregistrés en base (nécessite DATABASE_URL)."""
    if not DATABASE_URL:
        raise HTTPException(status_code=501,
                            detail="Base de données non configurée sur ce déploiement.")
    try:
        with _db() as conn, conn.cursor() as cur:
            if moteur:
                cur.execute("SELECT moteur, date, rul_predit, etat, confiance, fiable "
                            "FROM diagnostics WHERE moteur = %s "
                            "ORDER BY date DESC LIMIT %s", (moteur, limit))
            else:
                cur.execute("SELECT moteur, date, rul_predit, etat, confiance, fiable "
                            "FROM diagnostics ORDER BY date DESC LIMIT %s", (limit,))
            rows = cur.fetchall()
        return {"historique": [
            {"moteur": r[0], "date": r[1].isoformat(), "rul_predit": r[2],
             "etat": r[3], "confiance": r[4], "fiable": r[5]} for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/moteurs/{num}")
def moteur_historique(num: int):
    info = lookup_moteur(num)
    if info is None:
        raise HTTPException(status_code=404, detail=f"Moteur {num} inconnu.")
    return {"info": info, "diagnostic": diag_map.get(num)}

# ===========================================================================
# CRUD métier persisté dans PostgreSQL
# (clients, mécaniciens, flotte, relevés, ordres, alertes)
# ---------------------------------------------------------------------------
# Auth « démo » : mots de passe stockés/comparés en clair (projet de
# démonstration). Pour de la production, hacher avec bcrypt/argon2.
# ===========================================================================

def _besoin_bd():
    if not DATABASE_URL:
        raise HTTPException(status_code=503,
                            detail="Base de données non configurée (DATABASE_URL).")

class ClientIn(BaseModel):
    email: str
    nom: str
    telephone: str | None = None
    mot_de_passe: str

class LoginIn(BaseModel):
    email: str
    mot_de_passe: str

class MecanicienIn(BaseModel):
    nom: str
    specialite: str | None = None
    login: str
    mot_de_passe: str

class MecLoginIn(BaseModel):
    login: str
    mot_de_passe: str

class DispoIn(BaseModel):
    disponible: bool

class MoteurIn(BaseModel):
    client: str
    id: str
    modele: str | None = None
    mise_en_service: str | None = None

class DiagMajIn(BaseModel):
    client: str
    rul: float | None = None
    etat: str | None = None

class ReleveIn(BaseModel):
    client: str
    valeurs: list

class OrdreIn(BaseModel):
    moteur_id: str
    client_email: str | None = None
    client_nom: str | None = None
    rul: float | None = None
    etat: str | None = None
    mecanicien_id: str
    pdf_url: str | None = None

class StatutIn(BaseModel):
    statut: str

class AlerteIn(BaseModel):
    client: str
    severite: str
    titre: str
    message: str
    moteur: str | None = None

# ----------------------------- Clients -------------------------------------
@app.post("/clients")
def creer_client(c: ClientIn):
    _besoin_bd()
    if _run("SELECT email FROM clients WHERE email=%s", (c.email,), "one"):
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email.")
    _run("INSERT INTO clients (email, nom, telephone, mot_de_passe) VALUES (%s,%s,%s,%s)",
         (c.email, c.nom, c.telephone, c.mot_de_passe))
    return {"email": c.email, "nom": c.nom, "telephone": c.telephone}

@app.post("/clients/login")
def login_client(c: LoginIn):
    _besoin_bd()
    row = _run("SELECT email, nom, telephone, mot_de_passe FROM clients WHERE email=%s",
               (c.email,), "one")
    if not row or row["mot_de_passe"] != c.mot_de_passe:
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect.")
    return {"email": row["email"], "nom": row["nom"], "telephone": row["telephone"]}

@app.get("/clients")
def liste_clients():
    _besoin_bd()
    return {"clients": _run(
        "SELECT c.email, c.nom, c.telephone, c.statut, "
        "       COUNT(f.id) AS nb_moteurs "
        "FROM clients c LEFT JOIN flotte f ON f.client_email = c.email "
        "GROUP BY c.email, c.nom, c.telephone, c.statut, c.date_creation "
        "ORDER BY c.date_creation DESC", (), "all")}

@app.get("/clients/{email}")
def get_client(email: str):
    _besoin_bd()
    row = _run("SELECT email, nom, telephone, statut FROM clients WHERE email=%s",
               (email,), "one")
    if not row:
        raise HTTPException(status_code=404, detail="Client inconnu.")
    return row

class StatutClientIn(BaseModel):
    statut: str

@app.patch("/clients/{email}/statut")
def maj_statut_client(email: str, s: StatutClientIn):
    _besoin_bd()
    row = _run("UPDATE clients SET statut=%s WHERE email=%s RETURNING email, statut",
               (s.statut, email), "one")
    if not row:
        raise HTTPException(status_code=404, detail="Client inconnu.")
    return row

@app.delete("/clients/{email}")
def supprimer_client(email: str):
    _besoin_bd()
    _run("DELETE FROM clients WHERE email=%s", (email,))  # cascade -> flotte
    return {"ok": True}

# --------------------------- Mécaniciens -----------------------------------
@app.get("/mecaniciens")
def liste_mecaniciens():
    _besoin_bd()
    return {"mecaniciens": _run("SELECT id, nom, specialite, disponible, login "
                                "FROM mecaniciens ORDER BY id", (), "all")}

@app.post("/mecaniciens")
def ajouter_mecanicien(m: MecanicienIn):
    _besoin_bd()
    login = m.login.strip().lower()
    if _run("SELECT id FROM mecaniciens WHERE login=%s", (login,), "one"):
        raise HTTPException(status_code=409, detail="Ce login est déjà pris.")
    mid = f"mec-{int(time.time() * 1000)}"
    _run("INSERT INTO mecaniciens (id, nom, specialite, disponible, login, mot_de_passe) "
         "VALUES (%s,%s,%s,true,%s,%s)",
         (mid, m.nom, m.specialite or "Généraliste", login, m.mot_de_passe))
    return {"id": mid, "nom": m.nom, "specialite": m.specialite or "Généraliste",
            "disponible": True, "login": login}

@app.post("/mecaniciens/login")
def login_mecanicien(m: MecLoginIn):
    _besoin_bd()
    row = _run("SELECT id, nom, specialite, disponible, login, mot_de_passe "
               "FROM mecaniciens WHERE login=%s", (m.login.strip().lower(),), "one")
    if not row or row["mot_de_passe"] != m.mot_de_passe:
        raise HTTPException(status_code=401, detail="Login ou mot de passe incorrect.")
    row.pop("mot_de_passe", None)
    return row

@app.patch("/mecaniciens/{mid}/disponibilite")
def set_disponibilite(mid: str, d: DispoIn):
    _besoin_bd()
    row = _run("UPDATE mecaniciens SET disponible=%s WHERE id=%s "
               "RETURNING id, disponible", (d.disponible, mid), "one")
    if not row:
        raise HTTPException(status_code=404, detail="Mécanicien inconnu.")
    return row

# ------------------------ Flotte (moteurs client) --------------------------
@app.get("/flotte")
def liste_flotte(client: str):
    _besoin_bd()
    return {"moteurs": _run("SELECT id, modele, mise_en_service, rul, etat, dernier_diag "
                            "FROM flotte WHERE client_email=%s ORDER BY id", (client,), "all")}

@app.post("/flotte")
def ajouter_moteur(mo: MoteurIn):
    _besoin_bd()
    if _run("SELECT id FROM flotte WHERE client_email=%s AND id=%s", (mo.client, mo.id), "one"):
        raise HTTPException(status_code=409, detail=f"Le moteur « {mo.id} » existe déjà.")
    _run("INSERT INTO flotte (id, client_email, modele, mise_en_service) VALUES (%s,%s,%s,%s)",
         (mo.id, mo.client, mo.modele, mo.mise_en_service))
    return {"id": mo.id, "modele": mo.modele, "mise_en_service": mo.mise_en_service,
            "rul": None, "etat": None, "dernier_diag": None}

@app.delete("/flotte/{moteur_id}")
def supprimer_moteur(moteur_id: str, client: str):
    _besoin_bd()
    _run("DELETE FROM flotte WHERE client_email=%s AND id=%s", (client, moteur_id))
    return {"ok": True}

@app.patch("/flotte/{moteur_id}/diag")
def maj_moteur_diag(moteur_id: str, d: DiagMajIn):
    _besoin_bd()
    row = _run("UPDATE flotte SET rul=%s, etat=%s, dernier_diag=now() "
               "WHERE client_email=%s AND id=%s "
               "RETURNING id, rul, etat, dernier_diag", (d.rul, d.etat, d.client, moteur_id), "one")
    if not row:
        raise HTTPException(status_code=404, detail="Moteur inconnu pour ce client.")
    return row

# --------------------------- Relevés capteurs ------------------------------
@app.get("/releves/{moteur_id}")
def liste_releves(moteur_id: str, client: str):
    _besoin_bd()
    rows = _run("SELECT valeurs FROM releves WHERE client_email=%s AND moteur_id=%s "
                "ORDER BY id", (client, moteur_id), "all")
    return {"releves": [r["valeurs"] for r in rows]}

@app.post("/releves/{moteur_id}")
def ajouter_releve(moteur_id: str, r: ReleveIn):
    _besoin_bd()
    _run("INSERT INTO releves (client_email, moteur_id, valeurs) VALUES (%s,%s,%s)",
         (r.client, moteur_id, json.dumps(r.valeurs)))
    rows = _run("SELECT valeurs FROM releves WHERE client_email=%s AND moteur_id=%s "
                "ORDER BY id", (r.client, moteur_id), "all")
    return {"releves": [x["valeurs"] for x in rows]}

@app.delete("/releves/{moteur_id}")
def vider_releves(moteur_id: str, client: str):
    _besoin_bd()
    _run("DELETE FROM releves WHERE client_email=%s AND moteur_id=%s", (client, moteur_id))
    return {"ok": True}

# ------------------------ Ordres de maintenance ----------------------------
@app.get("/ordres")
def liste_ordres(client: str | None = None, mecanicien: str | None = None):
    _besoin_bd()
    if client:
        rows = _run("SELECT * FROM ordres WHERE client_email=%s ORDER BY date_envoi DESC",
                    (client,), "all")
    elif mecanicien:
        rows = _run("SELECT * FROM ordres WHERE mecanicien_id=%s ORDER BY date_envoi DESC",
                    (mecanicien,), "all")
    else:
        rows = _run("SELECT * FROM ordres ORDER BY date_envoi DESC", (), "all")
    return {"ordres": rows}

@app.post("/ordres")
def creer_ordre(o: OrdreIn):
    _besoin_bd()
    mec = _run("SELECT nom FROM mecaniciens WHERE id=%s", (o.mecanicien_id,), "one")
    oid = f"ord-{int(time.time() * 1000)}"
    _run("INSERT INTO ordres (id, moteur_id, client_email, client_nom, rul, etat, "
         "mecanicien_id, mecanicien_nom, pdf_url, statut) "
         "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'en_attente')",
         (oid, o.moteur_id, o.client_email, o.client_nom, o.rul, o.etat,
          o.mecanicien_id, mec["nom"] if mec else "?", o.pdf_url))
    return _run("SELECT * FROM ordres WHERE id=%s", (oid,), "one")

@app.patch("/ordres/{oid}/statut")
def maj_statut_ordre(oid: str, s: StatutIn):
    _besoin_bd()
    date_fin = "now()" if s.statut == "pret" else "date_fin"
    row = _run(f"UPDATE ordres SET statut=%s, date_fin={date_fin} WHERE id=%s "
               "RETURNING *", (s.statut, oid), "one")
    if not row:
        raise HTTPException(status_code=404, detail="Ordre inconnu.")
    # Quand le mécanicien termine : alerte automatique pour le client concerné.
    if s.statut == "pret" and row.get("client_email"):
        aid = f"al-{int(time.time() * 1000)}-{os.urandom(2).hex()}"
        _run("INSERT INTO alertes (id, client_email, severite, titre, message, moteur) "
             "VALUES (%s,%s,%s,%s,%s,%s)",
             (aid, row["client_email"], "info",
              f"✅ Moteur {row['moteur_id']} prêt",
              f"La maintenance a été terminée par {row.get('mecanicien_nom', '?')}. "
              "Vous pouvez récupérer le moteur (un nouveau diagnostic sera nécessaire "
              "pour ré-évaluer son RUL après intervention).",
              row["moteur_id"]))
    return row

# ------------------------------- Alertes -----------------------------------
@app.get("/alertes")
def liste_alertes(client: str):
    _besoin_bd()
    return {"alertes": _run("SELECT id, severite, titre, message, moteur, ts, lu "
                            "FROM alertes WHERE client_email=%s ORDER BY ts DESC",
                            (client,), "all")}

@app.post("/alertes")
def creer_alerte(a: AlerteIn):
    _besoin_bd()
    aid = f"al-{int(time.time() * 1000)}-{os.urandom(2).hex()}"
    _run("INSERT INTO alertes (id, client_email, severite, titre, message, moteur) "
         "VALUES (%s,%s,%s,%s,%s,%s)",
         (aid, a.client, a.severite, a.titre, a.message, a.moteur))
    return _run("SELECT id, severite, titre, message, moteur, ts, lu "
                "FROM alertes WHERE id=%s", (aid,), "one")

@app.patch("/alertes/lues")
def marquer_alertes_lues(client: str):
    _besoin_bd()
    _run("UPDATE alertes SET lu=true WHERE client_email=%s", (client,))
    return {"ok": True}

@app.patch("/alertes/{aid}/lu")
def marquer_alerte_lue(aid: str):
    _besoin_bd()
    _run("UPDATE alertes SET lu=true WHERE id=%s", (aid,))
    return {"ok": True}

@app.delete("/alertes/{aid}")
def supprimer_alerte(aid: str):
    _besoin_bd()
    _run("DELETE FROM alertes WHERE id=%s", (aid,))
    return {"ok": True}
