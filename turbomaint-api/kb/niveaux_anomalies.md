# Niveaux de signalement du module M3
Le score d'anomalie mesure, en écarts-types, l'écart d'un capteur à son
comportement sain (référence : moteurs à RUL >= 100).
- Score < 2 : normal.
- Score 2 à 4 : "surveillance" — dérive débutante, alerte précoce, aucune
  action immédiate, à suivre lors des prochaines remontées.
- Score > 4 : "ANOMALIE confirmée" — signalement fort, à croiser avec l'état.
Un moteur Sain peut avoir des capteurs en surveillance : sa dérive commence
mais reste sans impact opérationnel. Un capteur "figé" (variance effondrée)
est aussi détecté : régulateur en butée ou capteur défaillant.
Validation : 97% d'identification sur anomalies injectées (hasard 7%),
Spearman fortement négatif avec le RUL, 81% des signalements dans la
signature HPC documentée.
