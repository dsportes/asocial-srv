## Bug / vérifications...
TEST:
- tools : export DB / Storage

## TODO
Pages d'aide:
- page partition: export CSV des coûts
- Rubriques "Comment faire pour ..."

## Réflexions
**La connexion d'un compte au delà de sa DLV n'est pas _bloquée_**
- le GC _peut_ supprimer les comptes sur DLV, et c'est ça qui va empêcher la connexion.
- pour un espace _figé en archive_, le GC n'opère plus: les comptes restent donc accessibles après leur DLV. A noter que pour un compte en AR, le blocage va finir par apparaître ... sauf SI cette contrainte ne s'applique pas aux espaces figés. A VÉRIFIER.

## Doc
application.md est en cours

Déploiements:
- GAE
- CF OP
- CF PUBSUB

## DEV
Ajuster Firestore provider et retester avec GcProvider.
