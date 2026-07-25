# TurboMaint API — Backend (FastAPI + PostgreSQL)

API FastAPI **allégée** qui sert les 3 modèles TurboMaint (M1 RUL, M2 état,
M3 anomalies) + le chatbot Groq LLaMA 3.3 70B, et qui **persiste toutes les
données métier dans PostgreSQL** (clients, mécaniciens, moteurs, ordres,
alertes, diagnostics).

Pourquoi « allégée » : l'inférence utilise du **NumPy pur** (validé identique à
Keras) au lieu de TensorFlow, et la base de connaissances (~5 Ko) est injectée
directement dans le prompt au lieu d'un RAG ChromaDB. Empreinte : ~150 Mo.

## Contenu du dossier

```
app.py               API FastAPI (chat, diagnostic, conseil, rapport PDF, CRUD métier)
numpy_models.py      Inférence NumPy des LSTM (remplace TensorFlow)
convert_colab.py     Cellule à exécuter UNE FOIS dans Colab (export des poids)
requirements.txt     Dépendances légères
kb/                  Base de connaissances (injectée dans le prompt)
artifacts/           Poids .npz, scaler.json, config, base historique
```

## Prérequis

- Python 3.11+
- Un PostgreSQL accessible (local ou distant) → variable `DATABASE_URL`
- Une clé Groq → variable `GROQ_API_KEY`

## Lancer en local

```bash
# 1. Dépendances
pip install -r requirements.txt

# 2. Variables d'environnement
export DATABASE_URL="postgresql://turbomaint:turbomaint_secret@localhost:5432/turbomaint"
export GROQ_API_KEY="ta_cle_groq"

# 3. Démarrer l'API (port 7860)
uvicorn app:app --host 0.0.0.0 --port 7860 --reload
```

Au démarrage, l'API crée automatiquement les tables manquantes dans PostgreSQL.
Sans `DATABASE_URL`, l'API démarre quand même mais **sans persistance** (mode
dégradé, à éviter).

## Endpoints principaux

```
GET  /health                       → statut + modèles chargés
POST /chat        {"question": "Quel est l'état du moteur 24 ?"}
POST /diagnose    multipart : file=<csv relevés>, engine_id=CLIENT-001
POST /conseil     {"engine_id": "CLIENT-001", "cycles": 15}
GET  /rapport/CLIENT-001           → PDF téléchargeable
GET  /moteurs/24                   → fiche base historique

# CRUD métier (persistance PostgreSQL)
POST /clients            /clients/login          GET /clients/{email}
GET  /mecaniciens        POST /mecaniciens       POST /mecaniciens/login
GET  /flotte?client=     POST /flotte            DELETE /flotte/{id}
GET  /ordres             POST /ordres            PATCH /ordres/{id}/statut
GET  /alertes            POST /alertes           PATCH /alertes/{id}/lu
```

Documentation interactive : `/docs`

## Brancher le site

Dans le projet React (`turbomaint/`), fichier `.env` :

```
VITE_API_URL=http://localhost:7860
```

## Notes

- La base de connaissances vit dans `kb/*.md` (injectée dans le prompt Groq).
- Les fichiers `.keras` d'origine ne sont plus nécessaires au runtime
  (remplacés par les `_poids.npz`).
- Le déploiement en conteneurs (PostgreSQL + API + site) sera ajouté
  ultérieurement, étape par étape.
