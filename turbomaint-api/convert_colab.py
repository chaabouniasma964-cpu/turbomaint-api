# ============================================================================
# TurboMaint — EXPORT DES POIDS POUR L'API ALLÉGÉE (à exécuter dans COLAB)
#
# Copie tout ce fichier dans UNE cellule Colab et exécute-la (~1 min).
# Elle :
#   1. exporte les poids des 3 LSTM en .npz (lisibles avec NumPy seul)
#   2. exporte les paramètres du scaler en JSON (plus besoin de sklearn)
#   3. VALIDE que l'inférence NumPy donne les mêmes résultats que Keras
# Les fichiers sont écrits dans Drive : Master_Asma/turbomaint_deploy/
# ============================================================================
import numpy as np, json, joblib
import tensorflow as tf
from google.colab import drive
drive.mount('/content/drive')

SAVE = "/content/drive/MyDrive/Master_Asma/turbomaint_deploy"

# ---------- Inférence NumPy (copie exacte du module numpy_models.py de l'API)
def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))

def lstm_forward(x, W, U, b, return_sequences=False):
    """LSTM Keras standard (gates i,f,c,o ; tanh / sigmoid). x : (T, features)."""
    T, u = x.shape[0], U.shape[0]
    h = np.zeros(u, dtype=np.float64)
    c = np.zeros(u, dtype=np.float64)
    seq = np.empty((T, u), dtype=np.float64) if return_sequences else None
    for t in range(T):
        z = x[t] @ W + h @ U + b
        i = _sigmoid(z[:u]); f = _sigmoid(z[u:2*u])
        g = np.tanh(z[2*u:3*u]); o = _sigmoid(z[3*u:])
        c = f * c + i * g
        h = o * np.tanh(c)
        if return_sequences:
            seq[t] = h
    return seq if return_sequences else h

def predict_regresseur(win, ws, softmax=False):
    """M1/M2 : LSTM64(rs) -> LSTM32 -> Dense32 relu -> Dense out."""
    h = lstm_forward(win, ws[0], ws[1], ws[2], True)
    h = lstm_forward(h, ws[3], ws[4], ws[5], False)
    d = np.maximum(h @ ws[6] + ws[7], 0.0)
    y = d @ ws[8] + ws[9]
    if softmax:
        e = np.exp(y - y.max()); return e / e.sum()
    return float(y[0])

def predict_autoencoder(win, ws):
    """M3 : LSTM64(rs) -> LSTM32 -> RepeatVector -> LSTM32(rs) -> LSTM64(rs) -> TD(Dense14)."""
    h = lstm_forward(win, ws[0], ws[1], ws[2], True)
    z = lstm_forward(h, ws[3], ws[4], ws[5], False)
    r = np.repeat(z[None, :], win.shape[0], axis=0)
    h = lstm_forward(r, ws[6], ws[7], ws[8], True)
    h = lstm_forward(h, ws[9], ws[10], ws[11], True)
    return h @ ws[12] + ws[13]

# ---------- Export + validation
rng = np.random.RandomState(0)
X_test = rng.rand(5, 30, 14).astype(np.float32)   # 5 fenêtres aléatoires

for name, kind in [("modele1_rul", "reg"),
                   ("modele2_etat_lstm", "clf"),
                   ("modele3_anomalies", "ae")]:
    m = tf.keras.models.load_model(f"{SAVE}/{name}.keras", compile=False)
    ws = m.get_weights()
    np.savez(f"{SAVE}/{name}_poids.npz",
             **{f"w{i:02d}": w for i, w in enumerate(ws)})

    y_keras = m.predict(X_test, verbose=0)
    diffs = []
    for k in range(len(X_test)):
        if kind == "reg":
            y_np = predict_regresseur(X_test[k], ws)
            diffs.append(abs(float(y_keras[k, 0]) - y_np))
        elif kind == "clf":
            y_np = predict_regresseur(X_test[k], ws, softmax=True)
            diffs.append(float(np.abs(y_keras[k] - y_np).max()))
        else:
            y_np = predict_autoencoder(X_test[k], ws)
            diffs.append(float(np.abs(y_keras[k] - y_np).max()))
    print(f"{name:22s} : {len(ws):2d} tenseurs exportés | "
          f"écart max Keras vs NumPy = {max(diffs):.2e}  "
          f"{'✔ OK' if max(diffs) < 1e-4 else '✘ PROBLÈME !'}")

# ---------- Scaler -> JSON
scaler = joblib.load(f"{SAVE}/scaler.pkl")
with open(f"{SAVE}/scaler.json", "w") as f:
    json.dump({"features": list(scaler.feature_names_in_),
               "data_min": scaler.data_min_.tolist(),
               "data_range": scaler.data_range_.tolist()}, f)
print("scaler.json exporté ✔")
print("\nTerminé ! Fichiers créés dans", SAVE, ":")
print("  modele1_rul_poids.npz, modele2_etat_lstm_poids.npz,")
print("  modele3_anomalies_poids.npz, scaler.json")
