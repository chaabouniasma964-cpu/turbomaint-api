# ============================================================================
# TurboMaint — CHATBOT RAG + LLM (Groq LLaMA 3.3 70B + ChromaDB)
# Assistant orienté CLIENT : langage naturel et professionnel, sans jargon
# technique (pas de noms de modèles, de métriques ni de vocabulaire de labo).
# ============================================================================
# À exécuter d'abord :
# !pip install -q langchain langchain-groq langchain-community langchain-huggingface \
#     chromadb sentence-transformers pypdf gradio

import os, re, json, glob
import pandas as pd

# ---------------------- Configuration ----------------------
# ATTENTION : ne jamais publier cette clé. La révoquer sur console.groq.com
# si elle a circulé, puis la lire depuis les secrets Colab :
#   from google.colab import userdata
#   os.environ["GROQ_API_KEY"] = userdata.get("GROQ_API_KEY")
os.environ["GROQ_API_KEY"] = "VOTRE_NOUVELLE_CLE_GROQ"

BASE_DIR   = "/content/drive/MyDrive/Master_Asma/rag_turbomaint"
PDF_DIR    = f"{BASE_DIR}/pdfs"
CSV_PATH   = f"{BASE_DIR}/recap_final.csv"
DIAG_PATH  = f"{BASE_DIR}/diagnostics_anomalies_capteurs.json"
CHROMA_DIR = f"{BASE_DIR}/chroma_db"
MARGE = 10          # marge d'incertitude communiquée au client (en vols)

RAG_CONFIG = {
    "chunk_size": 800,
    "chunk_overlap": 100,
    "top_k": 5,               # extraits PDF récupérés (les fiches sont déjà dans le prompt)
    "temperature": 0.3,       # un peu de souplesse pour un ton naturel
    "max_tokens": 1024,
    "model": "llama-3.3-70b-versatile",
    "embedding_model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
}
os.makedirs(PDF_DIR, exist_ok=True)

# Noms réels des capteurs (ce que le client voit sur ses instruments)
NOMS_CAPTEURS = {
    "s2": "T24 — température en sortie du compresseur basse pression",
    "s3": "T30 — température en sortie du compresseur haute pression",
    "s4": "T50 — température en sortie de la turbine basse pression",
    "s7": "P30 — pression en sortie du compresseur haute pression",
    "s8": "Nf — vitesse de rotation du fan",
    "s9": "Nc — vitesse de rotation du corps haute pression",
    "s11": "Ps30 — pression statique du compresseur haute pression",
    "s12": "phi — rapport débit carburant / pression",
    "s13": "NRf — vitesse corrigée du fan",
    "s14": "NRc — vitesse corrigée du corps haute pression",
    "s15": "BPR — taux de dilution",
    "s17": "htBleed — enthalpie de prélèvement d'air",
    "s20": "W31 — débit d'air de refroidissement de la turbine haute pression",
    "s21": "W32 — débit d'air de refroidissement de la turbine basse pression",
}

# ============================================================================
# 1. Base de connaissances — rédigée pour un exploitant, pas pour un chercheur
# ============================================================================
CONNAISSANCES = {
"capteurs_moteur.md": """# Les capteurs suivis et ce qu'ils racontent

Quatorze capteurs sont relevés à chaque vol. Voici ce que chacun mesure, ce
qu'une dérive signifie et l'action qu'elle appelle.

| Capteur | Ce qu'il mesure | Dérive observée | Ce que cela indique | Action conseillée |
|---|---|---|---|---|
| T24 | Température sortie compresseur basse pression | en hausse | le moteur chauffe davantage pour un même régime | suivre l'évolution |
| T30 | Température sortie compresseur haute pression | en hausse | le compresseur perd de son efficacité | inspection du compresseur |
| T50 | Température sortie turbine basse pression | en hausse | les gaz arrivent plus chauds sur la turbine | inspection compresseur et turbine |
| P30 | Pression sortie compresseur haute pression | en baisse | la compression devient insuffisante | inspection des aubes du compresseur |
| Nf | Vitesse du fan | en hausse | la régulation compense une perte de performance | vérifier la chaîne de régulation |
| Nc | Vitesse du corps haute pression | variable | le régime s'ajuste pour maintenir la poussée | surveiller |
| Ps30 | Pression statique du compresseur haute pression | en hausse | signe le plus caractéristique d'usure du compresseur | inspection en priorité |
| phi | Rapport carburant / pression | en baisse | le moteur consomme davantage pour le même résultat | contrôler le circuit carburant |
| NRf | Vitesse corrigée du fan | en hausse | compensation de la régulation | vérifier la régulation |
| NRc | Vitesse corrigée du corps haute pression | en hausse | usure avancée quand la valeur plafonne | dégradation notable |
| BPR | Taux de dilution | en hausse | déséquilibre entre les flux d'air | surveiller |
| htBleed | Enthalpie de prélèvement d'air | en hausse | le prélèvement d'air est perturbé | contrôler le circuit d'air |
| W31 | Refroidissement turbine haute pression | en baisse | moins d'air pour refroidir la turbine | risque d'échauffement |
| W32 | Refroidissement turbine basse pression | en baisse | moins d'air pour refroidir la turbine | risque d'échauffement |

## Comment l'usure se propage
L'usure commence en général dans le compresseur haute pression. La pression Ps30
monte pendant que P30 baisse. Pour compenser, le moteur consomme plus de
carburant, ce qui fait monter la température T50 et baisser le rapport phi. Le
refroidissement de la turbine (W31, W32) diminue à son tour. Les vitesses du fan
(Nf, NRf) dérivent en dernier : elles subissent la compensation, elles ne sont
pas la cause.
""",

"niveaux_alerte.md": """# Comment lire les alertes capteurs

Chaque capteur est comparé à son comportement habituel sur un moteur en bonne
santé. Deux niveaux d'alerte existent.

## À surveiller
Le capteur commence à s'écarter de son comportement normal. C'est une alerte
précoce : aucune action immédiate n'est requise, mais il faut suivre l'évolution
lors des prochains relevés. Un moteur en bon état peut tout à fait présenter un
ou deux capteurs à surveiller : cela signifie simplement que l'usure commence,
sans conséquence sur l'exploitation.

## Anomalie confirmée
L'écart est net et sort clairement du comportement attendu. Le signalement doit
être pris au sérieux et croisé avec l'état général du moteur. Plusieurs anomalies
confirmées sur un même moteur indiquent une dégradation réelle.

## Capteur figé
Lorsqu'un capteur cesse de varier alors qu'il devrait bouger, c'est le signe soit
d'un organe de régulation arrivé en butée, soit d'un capteur défaillant. Dans ce
cas, il faut d'abord vérifier l'instrument avant de conclure sur le moteur.

## Fiabilité de la détection
Le système retrouve le capteur en cause dans plus de neuf cas sur dix lors des
essais de contrôle, et le nombre d'alertes augmente régulièrement à mesure que
la durée de vie restante diminue — ce qui confirme la cohérence du diagnostic.
""",

"guide_actions.md": """# Que faire selon l'état du moteur

## État critique
La fin de vie est proche. Le moteur doit être retiré de l'exploitation et une
intervention programmée en priorité. L'inspection porte d'abord sur le
compresseur haute pression, à l'endroit signalé par les capteurs en anomalie.
Aucun vol ne doit être planifié au-delà de la durée de vie restante estimée,
diminuée de la marge de sécurité.

## État de dégradation
Le moteur reste exploitable mais son usure est mesurable. Il faut ouvrir un ordre
de travail planifié et commander les pièces sans attendre : leur délai
d'approvisionnement représente souvent 20 à 40 vols, ce qui peut dépasser la
réserve restante. Réserver un créneau atelier et renforcer la surveillance des
capteurs signalés.

## État sain
Surveillance de routine. Les capteurs éventuellement signalés « à surveiller »
sont des alertes précoces à suivre, sans action immédiate.

## Échéance de planification
À chaque moteur correspond une échéance de planification : c'est le nombre de
vols au-delà duquel l'intervention ne doit plus être repoussée. Cette échéance
intègre déjà une marge de sécurité, elle est donc directement exploitable pour
programmer un passage à l'atelier.
C'est cette échéance qui doit être communiquée aux équipes, et non l'estimation
brute : elle constitue la consigne opérationnelle. Un moteur dont la durée de vie
restante est estimée à 30 vols doit ainsi être planifié avant 20 vols.
""",

"questions_frequentes.md": """# Questions fréquentes

## Sur quoi repose l'estimation ?
Sur l'analyse des relevés des quatorze capteurs du moteur au fil des vols. Le
système compare l'évolution de ces mesures à celle observée sur un grand nombre
de moteurs suivis jusqu'à leur remplacement, et en déduit la durée de vie
restante ainsi que l'état de santé général.

## Faut-il connaître l'âge du moteur ?
Non. L'estimation repose uniquement sur la signature des capteurs, c'est-à-dire
sur l'état réel du moteur, pas sur son ancienneté. Deux moteurs du même âge
peuvent présenter des usures très différentes selon leurs conditions d'usage.

## Combien de relevés faut-il fournir ?
Trente vols consécutifs constituent la base recommandée. En dessous, une
estimation reste possible mais elle est donnée à titre indicatif et signalée
comme telle.

## Que deviennent nos données ?
Les relevés restent confidentiels et servent exclusivement au suivi de votre
flotte. L'apprentissage du système se fait sans centraliser les données des
exploitants : seuls des paramètres agrégés sont partagés.

## Quelles sont les limites ?
Le diagnostic signale des symptômes mesurés, il ne remplace pas une inspection.
Les causes proposées sont les plus probables au vu des relevés, elles doivent
être confirmées par un contrôle physique du moteur. L'estimation suppose des
conditions d'exploitation comparables à celles observées jusqu'ici.
""",
}
for fname, content in CONNAISSANCES.items():
    with open(f"{BASE_DIR}/{fname}", "w", encoding="utf-8") as f:
        f.write(content)
print("Base de connaissances générée :", list(CONNAISSANCES.keys()))

# ============================================================================
# 2. Données moteur : lookup direct (vue CLIENT, sans vérité terrain)
# ============================================================================
recap_df = pd.read_csv(CSV_PATH)
with open(DIAG_PATH, encoding="utf-8") as f:
    diag_list = json.load(f)
diag_map = {d["moteur"]: d for d in diag_list}
print(f"Moteurs chargés : {len(recap_df)} | diagnostics capteurs : {len(diag_map)}")

# Le CSV contient aussi les valeurs réelles (vérité terrain, utile pour
# l'évaluation du modèle). Elles ne sont JAMAIS transmises au client :
# il ne dispose que de l'estimation, comme en exploitation réelle.
COL_ETAT = "État prédit (M2)" if "État prédit (M2)" in recap_df.columns else "État (LSTM)"

def lookup_moteur(num):
    """Fiche moteur destinée au client : uniquement les valeurs estimées."""
    row = recap_df[recap_df["Moteur"] == num]
    if row.empty:
        return None
    r = row.iloc[0]
    rul = float(r["RUL prédit (M1)"])
    prudent = max(0, rul - MARGE)
    txt = (f"Moteur {num} — durée de vie restante estimée : {rul:.0f} vols. "
           f"Échéance de planification à retenir : {prudent:.0f} vols "
           f"(marge de sécurité déjà déduite). "
           f"État général : {r[COL_ETAT]}.")

    d = diag_map.get(num)
    if d and d["capteurs_anormaux"]:
        lignes = []
        for s in d["capteurs_anormaux"]:
            nom = NOMS_CAPTEURS.get(s["capteur"], s["capteur"])
            niveau = ("anomalie confirmée" if s["niveau"] == "anomalie"
                      else "à surveiller")
            sens = {"hausse": "en hausse", "chute": "en baisse",
                    "capteur figé": "figé (ne varie plus)"}.get(s["derive"], s["derive"])
            lignes.append(f"{nom} : {sens}, {niveau}")
        txt += "\nCapteurs signalés : " + " ; ".join(lignes) + "."
    else:
        txt += "\nCapteurs signalés : aucun."
    return txt

# ============================================================================
# 3. Ingestion — deux couches complémentaires
#    a) Les fiches métier (6 Ko) : TOUJOURS injectées dans le prompt.
#       Elles pilotent le langage client, il ne faut jamais risquer de les rater.
#    b) Les PDF scientifiques (volumineux) : indexés dans ChromaDB et
#       récupérés seulement quand la question l'exige.
# ============================================================================
import shutil
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

# --- a) Fiches métier : concaténées, injectées systématiquement ---
KB_TEXT = "\n\n".join(
    open(p, encoding="utf-8").read() for p in sorted(glob.glob(f"{BASE_DIR}/*.md")))
print(f"Fiches métier : {len(KB_TEXT)} caractères (toujours dans le prompt)")

# --- b) PDF de référence : indexation sémantique ---
docs_pdf = []
for pdf in sorted(glob.glob(f"{PDF_DIR}/*.pdf")):
    try:
        pages = PyPDFLoader(pdf).load()
        docs_pdf.extend(pages)
        print(f"PDF chargé : {os.path.basename(pdf)} ({len(pages)} pages)")
    except Exception as e:
        print(f"Erreur PDF {pdf} : {e}")

retriever = None
if docs_pdf:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=RAG_CONFIG["chunk_size"],
        chunk_overlap=RAG_CONFIG["chunk_overlap"],
        separators=["\n## ", "\n# ", "\n\n", "\n", ". ", " "])
    chunks = splitter.split_documents(docs_pdf)
    print(f"{len(docs_pdf)} pages -> {len(chunks)} chunks indexés")

    # Reconstruction propre : sinon Chroma AJOUTE aux anciens vecteurs
    # et la base se remplit de doublons à chaque exécution.
    if os.path.exists(CHROMA_DIR):
        shutil.rmtree(CHROMA_DIR)
    embeddings = HuggingFaceEmbeddings(model_name=RAG_CONFIG["embedding_model"])
    vectordb = Chroma.from_documents(chunks, embeddings, persist_directory=CHROMA_DIR)
    retriever = vectordb.as_retriever(search_kwargs={"k": RAG_CONFIG["top_k"]})
    print("Base documentaire prête.")
else:
    print("Aucun PDF : le conseiller s'appuie uniquement sur les fiches métier.")

# ============================================================================
# 4. LLM Groq + consigne de style
# ============================================================================
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

llm = ChatGroq(model=RAG_CONFIG["model"], temperature=RAG_CONFIG["temperature"],
               max_tokens=RAG_CONFIG["max_tokens"])

SYSTEM_PROMPT = """Tu es le conseiller technique de TurboMaint. Tu accompagnes des
responsables de maintenance aéronautique dans le suivi de leurs moteurs.

TON RÔLE
Expliquer clairement l'état d'un moteur, ce que montrent ses capteurs et ce qu'il
convient de faire. Tu t'adresses à un professionnel de l'aéronautique qui connaît
ses moteurs, mais qui n'est ni statisticien ni spécialiste en intelligence
artificielle.

TON STYLE
- Parle naturellement, comme un ingénieur d'expérience qui explique une situation
  à un collègue : phrases fluides, ton posé et rassurant, jamais robotique.
- Va droit au but. Commence par le verdict, puis explique, puis recommande.
- Pas de listes à puces systématiques : privilégie des phrases construites.
- Reste sobre : ni alarmisme, ni banalisation.

CE QUE TU NE DIS JAMAIS
N'emploie jamais le vocabulaire interne du système. Sont totalement interdits :
les noms ou numéros de modèles (M1, M2, M3, LSTM, autoencodeur, régresseur,
classifieur), les termes d'apprentissage automatique (entraînement, fédéré,
FedProx, réseau de neurones, dataset, C-MAPSS, NASA), les métriques (RMSE, MAE,
accuracy, F1, écart-type, score, corrélation, Spearman), et les codes de capteurs
internes (s2, s11, s14...). Si une information ne peut être formulée sans ces
termes, reformule-la en langage métier ou n'en parle pas.

COMMENT DIRE LES CHOSES
- « durée de vie restante » ou « nombre de vols restants », jamais « RUL ».
- Nomme les capteurs par leur désignation d'ingénierie : Ps30, T50, P30, Nf...
  et précise ce qu'ils mesurent la première fois que tu les cites.
- « ce capteur s'écarte nettement de son comportement habituel » plutôt que
  « score d'anomalie de 8,2 ».
- « une marge d'environ dix vols » plutôt que « MAE ~10 cycles ».
- « à surveiller » et « anomalie confirmée » pour les deux niveaux d'alerte.

JAMAIS DE FOURCHETTE
Ne présente jamais l'estimation sous forme d'intervalle : ni « entre 9 et 29 »,
ni « de 9 à 29 », ni « plus ou moins dix », ni « une fourchette de… ». Un client
qui entend deux nombres ne sait plus lequel retenir, et risque de se fier au plus
optimiste — ce qui serait dangereux.
Annonce une seule valeur, l'estimation, puis donne l'échéance de planification
comme une consigne ferme. Exemple à suivre :
  « La durée de vie restante est estimée à 19 vols. Prévoyez l'intervention
  avant 9 vols : cette échéance intègre déjà la marge de sécurité. »
La marge existe et tu peux la mentionner une fois en fin de réponse si c'est
utile (« cette échéance tient compte de la marge d'incertitude »), mais jamais
sous forme de deux bornes chiffrées.

RÈGLES DE FOND
1. Réponds uniquement à partir des informations fournies. Si une donnée manque,
   dis-le simplement plutôt que de supposer. N'invente jamais un chiffre.
2. Pour un moteur : donne la durée de vie restante estimée (valeur unique),
   l'échéance de planification, l'état général, les capteurs qui sortent de
   l'ordinaire avec le sens de leur dérive, l'explication physique la plus
   probable, puis l'action recommandée.
3. Un moteur en bon état peut avoir des capteurs à surveiller : dis-le
   clairement pour éviter une inquiétude inutile.
4. Les causes que tu avances sont les plus probables au vu des relevés, pas des
   certitudes : rappelle qu'une inspection reste nécessaire pour confirmer.
5. Dès qu'une décision d'exploitation est en jeu, donne l'échéance de
   planification comme une consigne claire et unique, sans exposer le calcul
   d'incertitude qui la sous-tend.
6. Réponds en français, de façon complète mais sans délayer.
7. Des extraits de documentation technique de référence peuvent t'être fournis.
   Ils servent à approfondir ta compréhension physique du moteur, jamais à être
   recopiés : ils sont rédigés pour des chercheurs. Traduis toujours leur contenu
   en langage d'exploitant, et ne cite ni source, ni auteur, ni publication.

TES RÉFÉRENCES MÉTIER
Les informations ci-dessous font autorité : c'est sur elles que tu t'appuies en
priorité pour répondre.

""" + KB_TEXT

# ============================================================================
# 5. Routage hybride + mémoire de conversation
# ============================================================================
chat_history = []
last_engine  = {"num": None}
MOTEUR_RE = re.compile(r"moteur\s*(?:n[°o]?\s*)?(\d{1,3})", re.IGNORECASE)

def answer(question):
    global chat_history
    m = MOTEUR_RE.search(question)
    engine_context = ""
    if m:
        num = int(m.group(1))
        info = lookup_moteur(num)
        if info:
            last_engine["num"] = num
            engine_context = f"\n\nDONNÉES DU MOTEUR CONCERNÉ :\n{info}"
        else:
            engine_context = (f"\n\nDONNÉES DU MOTEUR : le moteur {num} ne figure "
                              f"pas dans le suivi.")
    elif last_engine["num"] and re.search(r"\b(il|ce moteur|lui|son|sa|ses|celui)\b",
                                          question, re.IGNORECASE):
        info = lookup_moteur(last_engine["num"])
        if info:
            engine_context = f"\n\nDONNÉES DU MOTEUR EN COURS :\n{info}"

    # Documentation technique : uniquement si des PDF ont été indexés
    rag_context = ""
    if retriever is not None:
        docs = retriever.invoke(question)
        extraits = "\n\n---\n\n".join(d.page_content for d in docs)
        rag_context = ("\n\nEXTRAITS TECHNIQUES DE RÉFÉRENCE (à reformuler en "
                       f"langage client, jamais à citer) :\n{extraits}")

    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    for role, content in chat_history[-6:]:
        messages.append(HumanMessage(content=content) if role == "user"
                        else AIMessage(content=content))
    messages.append(HumanMessage(
        content=f"{engine_context}{rag_context}\n\n"
                f"QUESTION DU CLIENT : {question}"))
    response = llm.invoke(messages).content
    chat_history += [("user", question), ("assistant", response)]
    return response

# ============================================================================
# 6. Tests — dont un contrôle automatique du vocabulaire
# ============================================================================
QUESTIONS = ["Quel est l'état du moteur 24 ?",
             "Quels capteurs sont anormaux sur ce moteur et pourquoi ?",
             "Que dois-je faire pour lui ?",
             "Le moteur 1 est sain mais a des capteurs signalés, c'est grave ?",
             "C'est quoi Ps30 exactement ?",
             "Puis-je faire confiance à vos estimations ?"]

reponses = []
for q in QUESTIONS:
    r = answer(q)
    reponses.append(r)
    print(f"\nQ : {q}\nR : {r}\n" + "-" * 70)

# Contrôle : aucun terme technique interne ne doit apparaître
INTERDITS = ["RUL", "M1", "M2", "M3", "LSTM", "autoencodeur", "FedProx", "RMSE",
             "MAE", "accuracy", "F1", "écart-type", "Spearman", "C-MAPSS",
             "dataset", "fédéré", "réseau de neurones", "classifieur", "régresseur",
             # Risque apparu avec les PDF : citations et vocabulaire académique
             "Saxena", "NASA", "PHM08", "simulation", "publication", "article",
             "HPC", "FD001"]
# Formulations de fourchette à bannir (déroutantes et risquées pour le client)
FOURCHETTES = [r"entre\s+\d+\s+et\s+\d+", r"de\s+\d+\s+[àa]\s+\d+",
               r"fourchette", r"intervalle", r"\d+\s*[-–]\s*\d+\s*vols",
               r"plus ou moins", r"±"]
fuites = {}
for q, r in zip(QUESTIONS, reponses):
    trouves = [t for t in INTERDITS if re.search(rf"\b{re.escape(t)}\b", r, re.I)]
    trouves += [f"fourchette ({p})" for p in FOURCHETTES if re.search(p, r, re.I)]
    if trouves:
        fuites[q] = trouves
print("\n" + "=" * 70)
if fuites:
    print("⚠️ À corriger dans les réponses :")
    for q, t in fuites.items():
        print(f"  « {q} » -> {t}")
else:
    print("✅ Langage client respecté : aucun terme technique, aucune fourchette.")

# ============================================================================
# 7. Interface Gradio
# ============================================================================
import gradio as gr
demo = gr.ChatInterface(
    lambda message, history: answer(message),
    title="TurboMaint — Conseiller technique",
    description="Suivi de vos moteurs : durée de vie restante, état général et "
                "capteurs à surveiller. Posez votre question en langage courant.",
    examples=["Quel est l'état du moteur 24 ?",
              "Quels capteurs sont anormaux sur le moteur 42 ?",
              "Que faire pour un moteur en état critique ?",
              "Pourquoi une hausse de Ps30 est-elle inquiétante ?"])
demo.launch(share=True)
