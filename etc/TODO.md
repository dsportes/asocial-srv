## Bug / vérifications...
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


De manière _normale_ un compte est assuré de pouvoir se connecter **pendant un an après sa dernière connexion**, il n'est automatiquement détruit qu'après 365 jours sans connexion.

MAIS tant que le compte est sous le coup d'une **restriction, soit à la lecture, soit d'accès minimal,** cette limite n'est plus prolongée lors de ses connexions:
- si par exemple ça fait 10 mois qu'un compte est soumis à une restriction de lecture seule, dans 2 mois il sera automatiquement supprimé: l'alerte **_60 jours avant inaccessibilité totale du compte_** apparaît.

#### L'Administrateur Technique a fixé une date limite (une fin de mois)
Lui seul en détermine la raison de cette mesure de rétorsion: par politesse il l'a exprimée dans la rubrique _Alerte Générale_.

> Si à partir de cette date les connexions aux comptes seront impossibles, ils ne sont pas détruits pour autant. Toutefois au bout d'un an, et avant pour les comptes **sous restriction**, la destruction automatique pour non usage des comptes conduira à leurs destructions.

Au cas ou les deux motifs A et B existent, c'est celui qui correspond à l'échéance la plus proche qui apparaît en titre.

# "Mises à jour et consultations interdites, même les actions d\'URGENCE sont interdites"
L'Administrateur Technique a bloqué l'application en lecture seulement. Il peut avoir plusieurs raisons à cela:
- il effectue un **export** à la demande du Comptable, typiquement,
  - pour pouvoir en faire une ré-importation sous un autre nom voire chez un autre hébergeur,
  - pour en faire une photographie en vue d'analyse.
- c'est une mesure de rétorsion à l'égard de l'organisation.

Le texte explicatif de l'Administrateur Technique est donné en **alerte générale**.

# "Mises à jour et consultations interdites (SAUF pour les actions d\'URGENCE)"
Le compte est sous le coup d'une **restriction d'accès minimal** pour l'une des raisons suivantes.

#### Compte "O" (de l'organisation):
- le Comptable ou un compte ayant _délégation du Comptable_ a émis cette restriction, soit sur le compte spécifiquement, soit collectivement pour tous les comptes de sa partition.
  - le message associé apparaît dans la page dans les rubriques **Alerte associé au compte** ou **Alerte associée à tous les comptes de la partition**.
- le compte a consommé plus de 100% de son quota de calcul sur la période de référence.

#### Compte "A" (autonome)
Son _crédit_ est épuisé, le nombre de jours que son solde lui permettait de vivre est devenu négatif.
