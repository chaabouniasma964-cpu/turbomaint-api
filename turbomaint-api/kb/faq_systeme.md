# FAQ TurboMaint
## Architecture
Trois modèles fédérés : M1 LSTM régresseur FedProx (RUL, RMSE ~13.4),
M2 LSTM classifieur transféré (état, accuracy ~0.95 ; XGBoost cyclique et
Random Forest bagging en ablation), M3 LSTM Autoencoder + patch variance
(anomalies par capteur, 2 niveaux).
## Federated learning
Deux clients entraînent localement ; seuls les poids/modèles circulent.
Les données brutes ne quittent jamais les clients.
## Diagnostic de nouveaux moteurs
Un moteur client inconnu est diagnostiqué en direct : ses relevés bruts passent
dans les 3 modèles et le diagnostic est produit à la demande. Le RUL est estimé
depuis la signature des capteurs, sans besoin de connaître l'âge du moteur.
## Seuils d'état
Data-driven : Dégradation = médiane du point de rupture des profils de santé ;
Critique = 2 x RMSE de validation.
## Limites
FD001 : une condition opératoire, un mode de panne (HPC). RUL plafonné à 125.
Le diagnostic capteur signale des symptômes, à confirmer par inspection.
