# ============================================================================
# TurboMaint — PIPELINE FINAL — C-MAPSS FD001
#   M1  : LSTM régresseur (FedProx)                -> RUL par moteur [RMSE, MAE]
#   M2  : LSTM classifieur (FedProx, transfert M1) -> état 3 classes
#   M3  : LSTM Autoencoder + patch variance        -> anomalies capteurs (2 niveaux)
#   Section 13 : validation de M3
# ============================================================================
import os, random, json, time
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import tensorflow as tf
from scipy.stats import spearmanr
from tensorflow.keras import layers, models, optimizers
from sklearn.preprocessing import MinMaxScaler
from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import (mean_squared_error, mean_absolute_error,
                             accuracy_score, f1_score, confusion_matrix,
                             classification_report)

# ---------------------- Reproductibilité ----------------------
SEED = 42
os.environ["PYTHONHASHSEED"] = str(SEED)
random.seed(SEED); np.random.seed(SEED); tf.random.set_seed(SEED)

# ---------------------- Chemins ----------------------
TRAIN_PATH = "/content/drive/MyDrive/Master_Asma/train_FD001.txt"
TEST_PATH  = "/content/drive/MyDrive/Master_Asma/test_FD001.txt"
RUL_PATH   = "/content/drive/MyDrive/Master_Asma/RUL_FD001.txt"

# ---------------------- Hyperparamètres ----------------------
CONFIG = {
    "WINDOW": 30, "RUL_CAP": 125, "VAL_UNITS": 20,
    "ROUNDS": 30, "LOCAL_EPOCHS": 4, "BATCH": 256, "LR": 1e-3,
    "MU": 0.01,                                          # FedProx (M1 et M2)
    "CLF_ROUNDS": 8, "CLF_EPOCHS": 3, "CLF_LR": 5e-4,    # M2 LSTM classifieur
    "AE_ROUNDS": 20, "AE_LOCAL_EPOCHS": 3, "AE_LR": 1e-3, # M3 autoencodeur fédéré
    "RUL_SAIN": 100,                                     # M3 : seuil "moteur sain"
    "SEUIL_SURVEILLANCE": 2.0, "SEUIL_ANOMALIE_CONFIRMEE": 4.0,
    "TOP_K": 3, "N_TESTS_INJECTION": 200,
}
W = CONFIG["WINDOW"]
LABELS = ["Sain", "Dégradation", "Critique"]

# ============================================================================
# 1. Chargement + RUL clippé
# ============================================================================
COLS = ["unit", "cycle", "op1", "op2", "op3"] + [f"s{i}" for i in range(1, 22)]
train_df = pd.read_csv(TRAIN_PATH, sep=r"\s+", header=None, names=COLS)
test_df  = pd.read_csv(TEST_PATH,  sep=r"\s+", header=None, names=COLS)
true_rul = pd.read_csv(RUL_PATH,   sep=r"\s+", header=None, names=["RUL"])

max_cycle = train_df.groupby("unit")["cycle"].transform("max")
train_df["RUL"] = (max_cycle - train_df["cycle"]).clip(upper=CONFIG["RUL_CAP"])
print(f"Train : {train_df.shape} | Test : {test_df.shape}")

# ============================================================================
# 2. Capteurs utiles + MinMax (fit sur TRAIN seul)
# ============================================================================
FEATURES = ["s2","s3","s4","s7","s8","s9","s11","s12","s13","s14","s15","s17","s20","s21"]
N_FEAT = len(FEATURES)
scaler = MinMaxScaler()
train_df[FEATURES] = scaler.fit_transform(train_df[FEATURES])
test_df[FEATURES]  = scaler.transform(test_df[FEATURES])

SENSOR_INFO = {
    "s2": "T24 temp. sortie compresseur BP", "s3": "T30 temp. sortie compresseur HP",
    "s4": "T50 temp. sortie turbine BP",     "s7": "P30 pression sortie compresseur HP",
    "s8": "Nf vitesse fan",                  "s9": "Nc vitesse corps HP",
    "s11": "Ps30 pression statique HPC",     "s12": "phi débit carburant/Ps30",
    "s13": "NRf vitesse corrigée fan",       "s14": "NRc vitesse corrigée HP",
    "s15": "BPR taux de dilution",           "s17": "htBleed enthalpie prélèvement",
    "s20": "W31 refroidissement turbine HP", "s21": "W32 refroidissement turbine BP",
}
SIGNATURE_HPC = {"s2","s3","s4","s7","s9","s11","s12","s14","s15","s17","s20","s21"}

# ============================================================================
# 3. Fenêtres + split PAR MOTEUR (anti-fuite)
# ============================================================================
def make_windows(df, units, window=W):
    X, y = [], []
    for unit in units:
        d = df[df["unit"] == unit]
        feats, ruls = d[FEATURES].values, d["RUL"].values
        for end in range(window, len(d) + 1):
            X.append(feats[end - window:end]); y.append(ruls[end - 1])
    return np.asarray(X, np.float32), np.asarray(y, np.float32)

all_units = train_df["unit"].unique()
shuffled  = np.random.RandomState(SEED).permutation(all_units)
val_units, train_units = np.sort(shuffled[:CONFIG["VAL_UNITS"]]), np.sort(shuffled[CONFIG["VAL_UNITS"]:])
X_val, y_val = make_windows(train_df, val_units)
assert not (set(train_units) & set(val_units)), "FUITE : moteurs partagés !"

half = len(train_units) // 2
clients = []
for i, units in enumerate([train_units[:half], train_units[half:]], start=1):
    Xc, yc = make_windows(train_df, units)
    clients.append({"name": f"Client {i}", "units": units,
                    "X": Xc, "y": yc, "n": len(Xc)})
    print(f"Client {i} : {len(units)} moteurs, {Xc.shape[0]} fenêtres")

# ============================================================================
# 5-7. MODÈLE 1 : LSTM régresseur + FedProx
# ============================================================================
def build_lstm():
    inp = layers.Input(shape=(W, N_FEAT))
    x = layers.LSTM(64, return_sequences=True)(inp)
    x = layers.Dropout(0.2)(x)
    x = layers.LSTM(32)(x)
    x = layers.Dropout(0.2)(x)
    x = layers.Dense(32, activation="relu")(x)
    out = layers.Dense(1, name="rul")(x)
    return models.Model(inp, out, name="LSTM_regresseur")

def predict_rul(model, X):
    return np.clip(np.asarray(model.predict(X, verbose=0)).ravel(), 0, CONFIG["RUL_CAP"])

def eval_model(model, X, y):
    p = predict_rul(model, X)
    return float(np.sqrt(mean_squared_error(y, p))), float(mean_absolute_error(y, p))

def fit_local_fedprox(local, global_trainable, c, mu):
    opt = optimizers.Adam(CONFIG["LR"])
    gw = [tf.constant(w) for w in global_trainable]

    @tf.function
    def train_step(xb, yb):
        with tf.GradientTape() as tape:
            pred = tf.squeeze(local(xb, training=True), axis=-1)
            mse  = tf.reduce_mean(tf.square(yb - pred))
            prox = tf.add_n([tf.reduce_sum(tf.square(w - g))
                             for w, g in zip(local.trainable_weights, gw)])
            loss = mse + (mu / 2.0) * prox
        grads = tape.gradient(loss, local.trainable_variables)
        opt.apply_gradients(zip(grads, local.trainable_variables))

    ds = (tf.data.Dataset.from_tensor_slices((c["X"], c["y"]))
          .shuffle(len(c["X"]), seed=SEED).batch(CONFIG["BATCH"]))
    for _ in range(CONFIG["LOCAL_EPOCHS"]):
        for xb, yb in ds:
            train_step(xb, yb)

def aggregate(weights_list, sizes):
    """Moyenne pondérée des poids (pondération = nb d'échantillons)."""
    total = float(sum(sizes))
    return [sum(w[i] * (s / total) for w, s in zip(weights_list, sizes))
            for i in range(len(weights_list[0]))]

print("=" * 78); print(f"### M1 — LSTM régresseur + FedProx (mu={CONFIG['MU']})"); print("=" * 78)
global_model = build_lstm()
best_rmse, best_weights = np.inf, None

for rnd in range(1, CONFIG["ROUNDS"] + 1):
    gt = [w.numpy() for w in global_model.trainable_weights]
    lw, sizes, cvals = [], [], []
    for c in clients:
        local = build_lstm()
        local.set_weights(global_model.get_weights())
        fit_local_fedprox(local, gt, c, CONFIG["MU"])
        cvals.append(eval_model(local, X_val, y_val))
        lw.append(local.get_weights()); sizes.append(c["n"])
    global_model.set_weights(aggregate(lw, sizes))
    g_rmse, g_mae = eval_model(global_model, X_val, y_val)
    if g_rmse < best_rmse:
        best_rmse, best_weights = g_rmse, [w.copy() for w in global_model.get_weights()]
    print(f"Round {rnd:2d} | C1: RMSE={cvals[0][0]:6.2f} | C2: RMSE={cvals[1][0]:6.2f}"
          f" | GLOBAL: RMSE={g_rmse:6.2f} MAE={g_mae:6.2f}")

global_model.set_weights(best_weights)
print(f"--> Meilleur RMSE validation (M1) : {best_rmse:.2f}\n")

# ============================================================================
# 7bis. SEUILS DATA-DRIVEN
# ============================================================================
def health_index(d):
    S = d[FEATURES].values
    signs = np.sign([np.corrcoef(S[:, j], np.arange(len(S)))[0, 1] + 1e-9
                     for j in range(S.shape[1])])
    return (S * signs).mean(axis=1)

def detect_onset(hi, min_seg=15):
    n = len(hi); t = np.arange(n); best_sse, best_k = np.inf, None
    for k in range(min_seg, n - min_seg):
        sse = 0.0
        for a, b in [(0, k), (k, n)]:
            x, z = t[a:b], hi[a:b]
            p = np.polyfit(x, z, 1)
            sse += np.sum((z - np.polyval(p, x)) ** 2)
        if sse < best_sse:
            best_sse, best_k = sse, k
    return best_k

rul_at_onset = []
for unit in train_units:
    d = train_df[train_df["unit"] == unit]
    if len(d) >= 40:
        rul_at_onset.append(min(len(d) - detect_onset(health_index(d)), CONFIG["RUL_CAP"]))

seuil_degradation = int(np.median(rul_at_onset))
rmse_val, _ = eval_model(global_model, X_val, y_val)
seuil_critique    = max(15, min(int(np.ceil(2 * rmse_val)), 45))
seuil_degradation = max(seuil_critique + 15, min(seuil_degradation, 90))
CONFIG["SEUIL_CRITIQUE"], CONFIG["SEUIL_DEGRADATION"] = seuil_critique, seuil_degradation
print(f"Seuils data-driven : Critique <= {seuil_critique} | Dégradation <= {seuil_degradation}")

# ============================================================================
# 8. Préparation du classifieur (labels 3 classes + poids)
# ============================================================================
def rul_to_class(rul):
    return np.where(rul <= CONFIG["SEUIL_CRITIQUE"], 2,
           np.where(rul <= CONFIG["SEUIL_DEGRADATION"], 1, 0)).astype(np.int32)

for c in clients:
    c["y_cls"] = rul_to_class(c["y"])
all_cls = np.concatenate([c["y_cls"] for c in clients])
cw = compute_class_weight("balanced", classes=np.array([0, 1, 2]), y=all_cls)
class_weight = {i: w for i, w in enumerate(cw)}
y_val_cls = rul_to_class(y_val)
print("Poids de classes :", {k: round(v, 2) for k, v in class_weight.items()})

def last_windows(df, window=W):
    X, units = [], []
    for unit in sorted(df["unit"].unique()):
        feats = df[df["unit"] == unit][FEATURES].values
        if len(feats) < window:
            feats = np.vstack([np.repeat(feats[:1], window - len(feats), axis=0), feats])
        X.append(feats[-window:]); units.append(unit)
    return np.asarray(X, np.float32), np.asarray(units)

X_test, test_units = last_windows(test_df)
y_test = true_rul["RUL"].values.astype(float).clip(max=CONFIG["RUL_CAP"])
y_test_cls = rul_to_class(y_test)

# ============================================================================
# 9. MODÈLE 2 : LSTM classifieur — FedProx (transfert de M1, moyenne pondérée)
# ============================================================================
def build_clf():
    inp = layers.Input(shape=(W, N_FEAT))
    x = layers.LSTM(64, return_sequences=True)(inp)
    x = layers.Dropout(0.2)(x)
    x = layers.LSTM(32)(x)
    x = layers.Dropout(0.2)(x)
    x = layers.Dense(32, activation="relu")(x)
    out = layers.Dense(3, activation="softmax", name="etat")(x)
    return models.Model(inp, out, name="LSTM_classifieur")

def init_from_regressor(clf, reg):
    """Transfert d'apprentissage : on réutilise les couches de M1 (sauf la sortie)."""
    for lc, lr_ in zip(clf.layers[:-1], reg.layers[:-1]):
        if lc.get_weights():
            lc.set_weights(lr_.get_weights())

def fit_local_fedprox_clf(local, global_trainable, c, mu):
    """FedProx pour la classification : CE pondérée + terme proximal."""
    opt = optimizers.Adam(CONFIG["CLF_LR"])
    gw = [tf.constant(w) for w in global_trainable]
    sw = np.array([class_weight[int(y)] for y in c["y_cls"]], dtype=np.float32)

    @tf.function
    def train_step(xb, yb, swb):
        with tf.GradientTape() as tape:
            pred = local(xb, training=True)
            ce = tf.keras.losses.sparse_categorical_crossentropy(yb, pred)
            ce = tf.reduce_mean(ce * swb)
            prox = tf.add_n([tf.reduce_sum(tf.square(w - g))
                             for w, g in zip(local.trainable_weights, gw)])
            loss = ce + (mu / 2.0) * prox
        grads = tape.gradient(loss, local.trainable_variables)
        opt.apply_gradients(zip(grads, local.trainable_variables))

    ds = (tf.data.Dataset.from_tensor_slices((c["X"], c["y_cls"], sw))
          .shuffle(len(c["X"]), seed=SEED).batch(CONFIG["BATCH"]))
    for _ in range(CONFIG["CLF_EPOCHS"]):
        for xb, yb, swb in ds:
            train_step(xb, yb, swb)

print("=" * 78); print(f"### M2 — LSTM classifieur FedProx (mu={CONFIG['MU']}, transfert M1)"); print("=" * 78)
t0 = time.time()
clf_lstm = build_clf()
init_from_regressor(clf_lstm, global_model)
best_acc_lstm, best_w = 0.0, None

for rnd in range(1, CONFIG["CLF_ROUNDS"] + 1):
    gt = [w.numpy() for w in clf_lstm.trainable_weights]
    lw, sizes, accs = [], [], []
    for c in clients:
        local = build_clf()
        local.set_weights(clf_lstm.get_weights())
        fit_local_fedprox_clf(local, gt, c, CONFIG["MU"])
        accs.append(float(np.mean(np.argmax(local.predict(X_val, verbose=0), axis=1) == y_val_cls)))
        lw.append(local.get_weights()); sizes.append(c["n"])
    clf_lstm.set_weights(aggregate(lw, sizes))         # moyenne pondérée des poids
    acc_g = float(np.mean(np.argmax(clf_lstm.predict(X_val, verbose=0), axis=1) == y_val_cls))
    if acc_g > best_acc_lstm:
        best_acc_lstm, best_w = acc_g, [w.copy() for w in clf_lstm.get_weights()]
    print(f"Round {rnd} | C1 acc={accs[0]:.3f} | C2 acc={accs[1]:.3f} | GLOBAL acc={acc_g:.3f}")

clf_lstm.set_weights(best_w)
t_lstm = time.time() - t0
pred_lstm_val  = np.argmax(clf_lstm.predict(X_val, verbose=0), axis=1)
pred_lstm_test = np.argmax(clf_lstm.predict(X_test, verbose=0), axis=1)
print(f"--> M2 LSTM : val acc={best_acc_lstm:.3f} | temps={t_lstm:.1f}s\n")

# ============================================================================
# 10. ÉVALUATION DU CLASSIFICATEUR M2
# ============================================================================
y_pred_cls = pred_lstm_test          # prédictions retenues (pour M3 et le récap)

metriques = {
    "Modèle": "LSTM (FedProx)",
    "Acc. validation": round(best_acc_lstm, 3),
    "Acc. test": round(accuracy_score(y_test_cls, y_pred_cls), 3),
    "F1 macro (test)": round(f1_score(y_test_cls, y_pred_cls, average="macro"), 3),
    "F1 Sain": round(f1_score(y_test_cls, y_pred_cls, labels=[0], average="macro"), 3),
    "F1 Dégradation": round(f1_score(y_test_cls, y_pred_cls, labels=[1], average="macro"), 3),
    "F1 Critique": round(f1_score(y_test_cls, y_pred_cls, labels=[2], average="macro"), 3),
    "Temps entraînement (s)": round(t_lstm, 1),
}
resultats_m2 = pd.DataFrame([metriques])
print("=" * 78); print("### PERFORMANCES DU CLASSIFICATEUR M2 (LSTM fédéré)"); print("=" * 78)
display(resultats_m2)
resultats_m2.to_csv("performances_classificateur_lstm.csv", index=False)

print("-" * 60)
print("Rapport de classification (test) — LSTM")
print(classification_report(y_test_cls, y_pred_cls, target_names=LABELS))

cm = confusion_matrix(y_test_cls, y_pred_cls, labels=[0, 1, 2])
plt.figure(figsize=(5.5, 4.5))
sns.heatmap(cm, annot=True, fmt="d", cmap="Greens", xticklabels=LABELS, yticklabels=LABELS)
plt.xlabel("État prédit (LSTM)"); plt.ylabel("État réel")
plt.title(f"Classificateur M2 — acc = {accuracy_score(y_test_cls, y_pred_cls):.3f}")
plt.tight_layout(); plt.show()

# ============================================================================
# 11. MODÈLE 1 sur le test + MODÈLE 3 (AE + patch variance, 2 niveaux)
# ============================================================================
y_pred = predict_rul(global_model, X_test)
rmse_test = float(np.sqrt(mean_squared_error(y_test, y_pred)))
mae_test  = float(mean_absolute_error(y_test, y_pred))
print(f"\nM1 (test) : RMSE = {rmse_test:.2f} | MAE = {mae_test:.2f}")

def healthy_windows(df, units, window=W, rul_min=CONFIG["RUL_SAIN"]):
    X = []
    for unit in units:
        d = df[df["unit"] == unit]
        feats, ruls = d[FEATURES].values, d["RUL"].values
        for end in range(window, len(d) + 1):
            if ruls[end - 1] >= rul_min:
                X.append(feats[end - window:end])
    return np.asarray(X, np.float32)

# Fenêtres saines PAR CLIENT : chaque client ne voit que ses propres moteurs
for c in clients:
    c["X_h"] = healthy_windows(train_df, c["units"])
    c["n_h"] = len(c["X_h"])
X_h_val = healthy_windows(train_df, val_units)   # référence serveur (moteurs held-out)

def build_ae():
    inp = layers.Input(shape=(W, N_FEAT))
    e = layers.LSTM(64, return_sequences=True)(inp)
    z = layers.LSTM(32)(e)
    d = layers.RepeatVector(W)(z)
    d = layers.LSTM(32, return_sequences=True)(d)
    d = layers.LSTM(64, return_sequences=True)(d)
    out = layers.TimeDistributed(layers.Dense(N_FEAT))(d)
    m = models.Model(inp, out, name="LSTM_Autoencoder")
    m.compile(optimizer=optimizers.Adam(1e-3), loss="mse")
    return m

def fit_local_fedprox_ae(local, global_trainable, c, mu):
    """FedProx pour l'autoencodeur : erreur de reconstruction + terme proximal."""
    opt = optimizers.Adam(CONFIG["AE_LR"])
    gw = [tf.constant(w) for w in global_trainable]

    @tf.function
    def train_step(xb):
        with tf.GradientTape() as tape:
            rec = local(xb, training=True)
            mse  = tf.reduce_mean(tf.square(xb - rec))
            prox = tf.add_n([tf.reduce_sum(tf.square(w - g))
                             for w, g in zip(local.trainable_weights, gw)])
            loss = mse + (mu / 2.0) * prox
        grads = tape.gradient(loss, local.trainable_variables)
        opt.apply_gradients(zip(grads, local.trainable_variables))

    ds = (tf.data.Dataset.from_tensor_slices(c["X_h"])
          .shuffle(len(c["X_h"]), seed=SEED).batch(CONFIG["BATCH"]))
    for _ in range(CONFIG["AE_LOCAL_EPOCHS"]):
        for xb in ds:
            train_step(xb)

print("=" * 78)
print(f"### M3 — LSTM Autoencoder + patch variance — FedProx (mu={CONFIG['MU']})")
print("=" * 78)
for c in clients:
    print(f"{c['name']} : {c['n_h']} fenêtres saines locales")

ae = build_ae()
best_loss_ae, best_w_ae = np.inf, None

for rnd in range(1, CONFIG["AE_ROUNDS"] + 1):
    gt = [w.numpy() for w in ae.trainable_weights]
    lw, sizes, closs = [], [], []
    for c in clients:
        local = build_ae()
        local.set_weights(ae.get_weights())
        fit_local_fedprox_ae(local, gt, c, CONFIG["MU"])
        closs.append(float(np.mean((c["X_h"] - local.predict(c["X_h"], verbose=0)) ** 2)))
        lw.append(local.get_weights()); sizes.append(c["n_h"])
    ae.set_weights(aggregate(lw, sizes))          # moyenne pondérée des poids
    val_loss = float(np.mean((X_h_val - ae.predict(X_h_val, verbose=0)) ** 2))
    if val_loss < best_loss_ae:
        best_loss_ae, best_w_ae = val_loss, [w.copy() for w in ae.get_weights()]
    print(f"Round {rnd} | C1 mse={closs[0]:.5f} | C2 mse={closs[1]:.5f}"
          f" | GLOBAL val mse={val_loss:.5f}")

ae.set_weights(best_w_ae)
print(f"--> Meilleure erreur de reconstruction (validation) : {best_loss_ae:.5f}\n")

# --- Statistiques de référence ---
# Erreur de reconstruction : mesurée sur le jeu de validation du serveur.
recon_val = ae.predict(X_h_val, verbose=0)
err_val = np.mean((X_h_val - recon_val) ** 2, axis=1)
mu_err, sd_err = err_val.mean(axis=0), err_val.std(axis=0) + 1e-9

# Profil "sain" (mu_h, sd_h) : agrégation FÉDÉRÉE des statistiques locales.
# Chaque client ne transmet que n, moyenne et variance — jamais ses relevés.
stats_locales = []
for c in clients:
    plat = c["X_h"].reshape(-1, N_FEAT)
    stats_locales.append((len(plat), plat.mean(axis=0), plat.var(axis=0)))
n_tot = sum(s[0] for s in stats_locales)
mu_h = sum(n * m for n, m, _ in stats_locales) / n_tot
# Variance poolée = E[var intra] + var inter-clients
var_h = (sum(n * (v + m ** 2) for n, m, v in stats_locales) / n_tot) - mu_h ** 2
sd_h = np.sqrt(np.maximum(var_h, 0)) + 1e-9

def scores_anomalie(fenetre):
    rec = ae.predict(fenetre[None, ...], verbose=0)[0]
    err = np.mean((fenetre - rec) ** 2, axis=0)
    score_recon = (err - mu_err) / sd_err
    var_ratio   = fenetre[-15:].std(axis=0) / (sd_h + 1e-9)
    score_stuck = np.clip((0.5 - var_ratio) / 0.5, 0, None) * 4.0
    return np.maximum(score_recon, score_stuck)

def capteurs_suspects(fenetre, top_k=CONFIG["TOP_K"]):
    s = scores_anomalie(fenetre)
    sens = fenetre[-10:].mean(axis=0) - mu_h
    var_ratio = fenetre[-15:].std(axis=0) / (sd_h + 1e-9)
    top = np.argsort(-s)[:top_k]
    out = []
    for j in top:
        if s[j] >= CONFIG["SEUIL_SURVEILLANCE"]:
            niveau = ("anomalie" if s[j] >= CONFIG["SEUIL_ANOMALIE_CONFIRMEE"]
                      else "surveillance")
            derive = ("capteur figé" if var_ratio[j] < 0.5 else
                      "hausse" if sens[j] > 0 else "chute")
            out.append({"capteur": FEATURES[j], "description": SENSOR_INFO[FEATURES[j]],
                        "score_anomalie": round(float(s[j]), 2),
                        "niveau": niveau, "derive": derive})
    return out

diagnostics = []
for i, unit in enumerate(test_units):
    diagnostics.append({"moteur": int(unit),
                        "rul_predit": round(float(y_pred[i]), 1),
                        "etat_predit": LABELS[int(y_pred_cls[i])],
                        "capteurs_anormaux": capteurs_suspects(X_test[i])})
with open("diagnostics_anomalies_capteurs.json", "w", encoding="utf-8") as f:
    json.dump(diagnostics, f, ensure_ascii=False, indent=2)

def fmt_capteurs(d):
    parts = [f"{s['capteur']}({'ANOMALIE' if s['niveau']=='anomalie' else 'surv.'})"
             for s in d["capteurs_anormaux"]]
    return ", ".join(parts) or "-"

recap = pd.DataFrame({
    "Moteur": test_units, "RUL réel": y_test.round(1),
    "RUL prédit (M1)": y_pred.round(1),
    "État réel": np.array(LABELS)[y_test_cls],
    "État prédit (M2)": np.array(LABELS)[y_pred_cls],
    "Capteurs (M3)": [fmt_capteurs(d) for d in diagnostics],
    "Erreur RUL": np.abs(y_test - y_pred).round(2)})
pd.set_option("display.max_rows", None)
display(recap)
recap.to_csv("recap_final.csv", index=False)

print("\nRépartition des signalements M3 par état et par niveau :")
for etat in LABELS:
    n_surv = n_anom = 0
    for d, cls in zip(diagnostics, y_pred_cls):
        if LABELS[cls] == etat:
            for s in d["capteurs_anormaux"]:
                if s["niveau"] == "anomalie": n_anom += 1
                else: n_surv += 1
    n_mot = int(np.sum(np.array(LABELS)[y_pred_cls] == etat))
    print(f"  {etat:12s} ({n_mot:3d} moteurs) : "
          f"{n_surv:3d} surveillance | {n_anom:3d} ANOMALIE confirmée")

# ============================================================================
# 13. VALIDATION DE M3
# ============================================================================
print("\n" + "#" * 78); print("### SECTION 13 — VALIDATION DU DIAGNOSTIC CAPTEURS (M3)"); print("#" * 78)

signales = [s["capteur"] for d in diagnostics for s in d["capteurs_anormaux"]]
dans_signature = (sum(1 for c in signales if c in SIGNATURE_HPC) / len(signales)
                  if signales else 0.0)
print(f"\n[13a] {len(signales)} signalements ; {dans_signature:.0%} dans la signature HPC")

freq = {etat: {} for etat in LABELS}
for d, cls in zip(diagnostics, y_pred_cls):
    for s in d["capteurs_anormaux"]:
        freq[LABELS[cls]][s["capteur"]] = freq[LABELS[cls]].get(s["capteur"], 0) + 1
print(f"\n[13b] Capteurs signalés par état prédit :")
for etat in LABELS:
    tri = dict(sorted(freq[etat].items(), key=lambda x: -x[1]))
    print(f"  {etat:12s} : {tri if tri else 'aucun'}")

scores_max = np.array([scores_anomalie(X_test[i]).max() for i in range(len(test_units))])
corr_p = float(np.corrcoef(scores_max, y_test)[0, 1])
rho, pval = spearmanr(scores_max, y_test)
print(f"\n[13c] Pearson r = {corr_p:.3f} | Spearman rho = {rho:.3f} (p={pval:.2e}) "
      f"<- métrique retenue (attendu < -0.5)")

def inject_anomaly(fenetre, sensor_idx, amplitude_sigma=3.0, mode="drift"):
    f = fenetre.copy()
    if mode == "drift":
        f[-15:, sensor_idx] += np.linspace(0, amplitude_sigma * sd_h[sensor_idx], 15)
    elif mode == "step":
        f[-10:, sensor_idx] += amplitude_sigma * sd_h[sensor_idx]
    else:
        f[-15:, sensor_idx] = f[:, sensor_idx].mean()
    return f

rng_b = np.random.RandomState(7)
MODES = ["drift", "step", "stuck"]
res = {m: {"top1": 0, "top3": 0, "n": 0} for m in MODES}
for _ in range(CONFIG["N_TESTS_INJECTION"]):
    fen   = X_h_val[rng_b.randint(len(X_h_val))]
    cible = rng_b.randint(N_FEAT)
    mode  = MODES[rng_b.randint(3)]
    rang  = np.argsort(-scores_anomalie(inject_anomaly(fen, cible, 3.0, mode)))
    res[mode]["n"] += 1
    if rang[0] == cible:  res[mode]["top1"] += 1
    if cible in rang[:3]: res[mode]["top3"] += 1

print(f"\n[13d] Injection contrôlée ({CONFIG['N_TESTS_INJECTION']} essais) :")
t1 = t3 = 0
for m in MODES:
    n = max(res[m]["n"], 1)
    t1 += res[m]["top1"]; t3 += res[m]["top3"]
    print(f"  Mode {m:6s} | top-1 : {res[m]['top1']/n:6.1%} | top-3 : {res[m]['top3']/n:6.1%}")
N = CONFIG["N_TESTS_INJECTION"]
print(f"  GLOBAL      | top-1 : {t1/N:6.1%} | top-3 : {t3/N:6.1%} (hasard : 7.1%)")

# ============================================================================
# 14. Sauvegarde des artefacts
# ============================================================================
import joblib
SAVE_DIR = "/content/drive/MyDrive/Master_Asma/turbomaint_deploy"
os.makedirs(SAVE_DIR, exist_ok=True)
global_model.save(f"{SAVE_DIR}/modele1_rul.keras")
clf_lstm.save(f"{SAVE_DIR}/modele2_etat_lstm.keras")
ae.save(f"{SAVE_DIR}/modele3_anomalies.keras")
joblib.dump(scaler, f"{SAVE_DIR}/scaler.pkl")
np.savez(f"{SAVE_DIR}/stats_anomalies.npz", mu_err=mu_err, sd_err=sd_err,
         mu_h=mu_h, sd_h=sd_h)
with open(f"{SAVE_DIR}/config_deploy.json", "w") as f:
    json.dump({"FEATURES": FEATURES, "WINDOW": W, "RUL_CAP": CONFIG["RUL_CAP"],
               "SEUIL_CRITIQUE": CONFIG["SEUIL_CRITIQUE"],
               "SEUIL_DEGRADATION": CONFIG["SEUIL_DEGRADATION"],
               "SEUIL_SURVEILLANCE": CONFIG["SEUIL_SURVEILLANCE"],
               "SEUIL_ANOMALIE_CONFIRMEE": CONFIG["SEUIL_ANOMALIE_CONFIRMEE"],
               "MAE": round(mae_test, 1),
               "classificateur": "LSTM"}, f)

print(f"\nArtefacts sauvegardés dans {SAVE_DIR}")
print(f"RÉSUMÉ : M1 RMSE={rmse_test:.2f} MAE={mae_test:.2f} | "
      f"M2 LSTM acc={accuracy_score(y_test_cls, y_pred_cls):.3f} | "
      f"M3 : signature {dans_signature:.0%}, Spearman={rho:.2f}, "
      f"injection top-1={t1/N:.0%}")
