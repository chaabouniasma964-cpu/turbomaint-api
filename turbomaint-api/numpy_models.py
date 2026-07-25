# ============================================================================
# Inférence NumPy pure des 3 modèles TurboMaint — remplace TensorFlow (1,2 Go)
# par ~30 lignes de calcul matriciel (~50 Mo de RAM avec NumPy).
#
# Les poids proviennent des .npz exportés par convert_colab.py, où l'égalité
# des prédictions NumPy vs Keras est vérifiée (écart < 1e-4).
# ============================================================================
import numpy as np


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


def load_weights(npz_path):
    """Recharge les poids dans l'ordre d'export (w00, w01, …)."""
    data = np.load(npz_path)
    return [data[k].astype(np.float64) for k in sorted(data.files)]


class RegresseurLSTM:
    """M1 (sortie RUL) et M2 (softmax=True, sortie probas 3 classes).
    Architecture : LSTM64(rs) -> LSTM32 -> Dense32 relu -> Dense out."""

    def __init__(self, npz_path, softmax=False):
        self.ws = load_weights(npz_path)
        self.softmax = softmax

    def predict(self, win):                      # win : (30, 14)
        ws = self.ws
        h = lstm_forward(win, ws[0], ws[1], ws[2], True)
        h = lstm_forward(h, ws[3], ws[4], ws[5], False)
        d = np.maximum(h @ ws[6] + ws[7], 0.0)
        y = d @ ws[8] + ws[9]
        if self.softmax:
            e = np.exp(y - y.max())
            return e / e.sum()
        return float(y[0])


class AutoencoderLSTM:
    """M3 : LSTM64(rs) -> LSTM32 -> RepeatVector -> LSTM32(rs) -> LSTM64(rs)
    -> TimeDistributed(Dense14). Sortie : reconstruction (30, 14)."""

    def __init__(self, npz_path):
        self.ws = load_weights(npz_path)

    def predict(self, win):                      # win : (30, 14)
        ws = self.ws
        h = lstm_forward(win, ws[0], ws[1], ws[2], True)
        z = lstm_forward(h, ws[3], ws[4], ws[5], False)
        r = np.repeat(z[None, :], win.shape[0], axis=0)
        h = lstm_forward(r, ws[6], ws[7], ws[8], True)
        h = lstm_forward(h, ws[9], ws[10], ws[11], True)
        return h @ ws[12] + ws[13]


class ScalerMinMax:
    """Équivalent de sklearn MinMaxScaler chargé depuis scaler.json."""

    def __init__(self, params):
        self.features = params["features"]
        self.data_min = np.array(params["data_min"], dtype=np.float64)
        self.data_range = np.array(params["data_range"], dtype=np.float64)
        self.data_max = self.data_min + self.data_range

    def transform(self, X):                      # X : (n, features)
        return (X - self.data_min) / self.data_range
