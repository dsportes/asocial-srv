@@Index général de la documentation - [index](./index.md)

# Les _micro_ bases locales des comptes dans les navigateurs
En ouvrant une session en mode _synchronisé_, un compte créé dans son navigateur une _micro base de données locale_:
- elle est restreinte au _compte_ et contient dans ses tables les extraits des documents du serveur central qui concernent le compte seulement. Par exemple la table `notes` ne contient que les notes des avatars du compte et celles partagées avec les groupes dont ils sont membre.
- les tables ont chacune deux colonnes, une colonne _clé_ et une colonne _valeur_ dont les contenus sont cryptés par la clé K du compte: elles sont donc illisibles, sauf par l'application après que le compte se soit authentifié par sa phrase secrète cryptant cette clé K.

**Au cours de la session, les tables sont maintenues à jour**. Si la session s'interrompt et qu'elle est reprise plus tard :
- si elle est reprise en mode _avion_ la mémoire de la session est reconstituée au dernier état contenu dans la _micro base locale du compte_, qui est plus ou moins ancien, mais permet d'accéder, _en lecture_, à toutes les informations (certes plus ou moins retardées) du compte.
- si elle est reprise en mode _synchronisé_ : les seules données plus récentes sont demandées au serveur central, puis enregistrées dans la _micro base locale du compte_. Cet économie d'échanges sur le réseau accélère l'initialisation de la session.

## Les fichiers stockés localement
Le titulaire du compte a pu _cocher_ certains fichiers attachés à des notes.
- ils sont enregistrés dans la micro base locale du compte,
- ils sont maintenus à jour au cours des sessions synchronisées,
- ils sont lisibles, en mode _synchronisé_, ce qui évite d'aller les télécharger depuis le serveur central de fichiers, mais surtout sont lisibles en en mode _avion_.
- ils occupent du volume dans l'espace réservé au navigateur sur l'appareil, lequel n'étant en général pas important, du moins sur un _mobile_, risque de provoquer une erreur par saturation.

## Clipboard local
En modes synchronisé et avion, le _clipboard_ est un espace qui permet de stocker de manière plus ou moins temporaire -en fait jusqu'à décision d'y supprimer des éléments,
- des textes d'au plus 5000 signes,
- des fichiers ayant un _nom_, un _commentaire / titre d'à propos_, un _type_ (`.mp3 .jpg .pdf ...`).

Ces éléments sont _cryptés_. Ils y ont été copiés,
- pour les textes, depuis n'importe quel texte par copier / coller, voire tout simplement frappés au clavier.
- pour les fichiers, depuis n'importe quel fichier présent localement dans un directory de l'appareil ou n'importe quel fichier attaché à une note.

> En mode _avion_ il est finalement simple de préparer des notes en vue d'une prochaine session synchronisée en en mettant les éléments dans le _clipboard_.

> Le clipboard étant crypté, il est possible par exemple, de prendre une photo ou une vidéo sur son mobile, de l'installer dans le clipboard et de détruire l'original. Personne ne sera en mesure d'en pirater le contenu et il sera possible de l'attacher à une note, partagée ou non, mais sécurisée par une mémorisation, elle aussi cryptée, dans le serveur central (ou le serveur annexe des fichiers).

## Purge des micro bases locales inutiles
A la première ouverture d'une session synchronisée pour un compte, il est demandé au titulaire du compte des initiales en 3 lettres (ou ce qu'il veut) : ce code est associé au nom effectif de la base locale.

Avant de se connecter à une session, le titulaire d'un compte peut demander à voir la liste des micro bases locales installées dans le navigateur et pour chacun voit:
- les 3 lettres d'initiales données préalablement,
- le nom technique de la micro base locale du compte correspondant.

Il peut pour chacune,
- demander le calcul de son volume utile : le volume technique réel est probablement de près du double, donc savoir si sa suppression libérera ou non un espace significatif.
- en demander la suppression. Elle ne sera plus accessible en mode avion jusqu'à ce qu'une reconnexion en mode synchronisé ne la recharge et elle aura perdu la liste des fichiers accessibles en mode _avion_ (qu'il faudra citer à nouveau).

# En savoir plus ...
Chaque navigateur (Firefox, Chrome, etc.) a son propre espace privé pour héberger ces données.

Leur espace est **compartimenté** par domaine : si l'application est invoqué par `https://srv1.monhergeur.net/#/monreseau` il y a un espace dédié à `srv1.monhergeur.net`. Pour en voir le contenu,
- passer en mode _debug_ du navigateur (Ctrl-Shift-I pour Chrome et Firefox) et aller sur l'onglet `Application`. La liste des bases y figure.
- on y voit alors les bases listées sur la page de gestion des purges des bases. On peut aussi la supprimer ici ... et en consulter l'état de ses tables totalement abscons car crypté.

Pour faire plus vite, ouvrir la page de gestion des purges des micro bases locales, c'est affiché en clair !

Ouvrir la base en mode _debug_ et constater ... qu'elle est illisible.
