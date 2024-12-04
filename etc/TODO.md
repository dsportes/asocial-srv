## Bug / vérifications...
- Groupes : quotas heb - PageGroupe.gererheb PageGroupes.nvGr
- les pages help

## Réflexions
Ne pas bloquer la connexion d'un compte au delà de sa DLV:
- le GC _peut_ supprimer les comptes, et c'est ça qui va empêcher la connexion.
- pour un espace _figé en archive_, le GC n'opère plus: les comptes restent accessibles. A noter que pour un compte en AR, le blocage va finir par apparaître ... sauf SI cette contrainte ne s'applique pas aux espaces figés.

## Doc
application.md est en cours

Déploiements:
- GAE
- CF OP
- CF PUBSUB

# Mutation des comptes O<->AR
### Compte "O"
Le compte (s'il est vraiment "O") doit donner son autorisation à un ou plusieurs comptes Comptable / délégués de sa partition. Pour chacun:
- le chat avec lui est marqué `mutI / mutE` 1 (autorisation de mutation en compte A).
- l'`ids` du chat est ajouté à `lmut` de son compte.

### Compte "A"
Le compte (s'il est vraiment "A") doit donner son autorisation à un ou plusieurs comptes Comptable / délégués _d'une_ partition. Pour chacun:
- le chat avec lui est marqué `mutI / mutE` 2 (autorisation de mutation en compte "O").
- l'`ids` du chat est ajouté à `lmut` de son compte.

### Pour les Comptable / délégués (_d'une_ partition)

Le composant `ChatsAvec` liste le ou les chats qu'un contact E a avec les avatars du compte. Si le chat à l'indicateur `mutE` à 1 ou 2, son icône d'ouverture est particulière pour indiquer qu'une mutation a été demandée au compte.

Dans la page des chats, chaque chat ayant une demande de mutation est repérée (et peut être filtrée).

Les actions de mutation sont accessibles depuis un _chat_ ayant un `mutE` à 1 ou 2.
- un bouton affiche la compta (conséquence de l'existence de `mutE`).
- l'action de mutation, en plus de muter le compte,
  - liste tous les chats de `lmut` du compte,
  - efface les `mut` de ces chats,
  - supprime `lmut`.

L'opération d'auto-mutation d'un délégué en compte A est accessible depuis la page du compte.
