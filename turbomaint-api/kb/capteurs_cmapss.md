# Capteurs C-MAPSS : signification, dérive, cause, action
Source significations : Saxena, Goebel, Simon & Eklund, PHM08 2008 (Table 2).
Mode de panne FD001 : dégradation du compresseur haute pression (HPC).

| Capteur | Nom | Signification | Dérive typique | Cause probable | Action |
|---|---|---|---|---|---|
| s2 | T24 | Temp. sortie compresseur BP | hausse | échauffement compensatoire | surveiller la tendance |
| s3 | T30 | Temp. sortie compresseur HP | hausse | perte d'efficacité HPC | inspection boroscopique HPC |
| s4 | T50 | Temp. sortie turbine BP | hausse | gaz plus chauds (HPC dégradé) | inspection HPC + turbine |
| s7 | P30 | Pression sortie compresseur HP | chute | compression insuffisante | inspection aubes HPC |
| s8 | Nf | Vitesse fan | hausse | compensation du régulateur | vérifier chaîne de régulation |
| s9 | Nc | Vitesse corps HP | hausse/chute | ajustement régime HP | surveiller |
| s11 | Ps30 | Pression statique HPC | hausse | signature principale HPC | inspection boroscopique prioritaire |
| s12 | phi | Débit carburant / Ps30 | chute | surconsommation relative | contrôle circuit carburant + HPC |
| s13 | NRf | Vitesse corrigée fan | hausse | compensation régulateur | vérifier régulation |
| s14 | NRc | Vitesse corrigée HP | hausse puis saturation | régulateur en butée en fin de vie | dégradation avancée |
| s15 | BPR | Taux de dilution | hausse | déséquilibre des flux | surveiller |
| s17 | htBleed | Enthalpie prélèvement | hausse | prélèvement d'air perturbé | contrôle circuit bleed |
| s20 | W31 | Refroidissement turbine HP | chute | moins d'air de refroidissement | risque thermique turbine HP |
| s21 | W32 | Refroidissement turbine BP | chute | moins d'air de refroidissement | risque thermique turbine BP |

Chaîne causale HPC : usure HPC -> Ps30 (s11) monte, P30 (s7) chute ->
compensation carburant -> T50 (s4) monte, phi (s12) chute -> refroidissements
W31/W32 (s20/s21) chutent. Les vitesses fan (s8/s13) dérivent par compensation
du régulateur (effet indirect).
