## Bug / vérifications...

## TODO
Pages d'aide:
- notes et fichiers, fiches en avion
- suppr_avatar
- presse-papier

## Réflexions
**Ne pas bloquer la connexion d'un compte au delà de sa DLV:**
- le GC _peut_ supprimer les comptes, et c'est ça qui va empêcher la connexion.
- pour un espace _figé en archive_, le GC n'opère plus: les comptes restent accessibles. A noter que pour un compte en AR, le blocage va finir par apparaître ... sauf SI cette contrainte ne s'applique pas aux espaces figés.

**Export CSV des coûts / partition**
4 * 3 colonnes
- 3 compteurs: coût Quota, coût Quota attribué, coût Quota utilisé
- 4 quotas: QN, QV, QC et Total (QN + QV + QC)

Lignes: ID et 12 compteurs - 1 ligne de total général

## Doc
application.md est en cours

Déploiements:
- GAE
- CF OP
- CF PUBSUB
