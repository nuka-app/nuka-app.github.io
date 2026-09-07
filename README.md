# Nuka — version web

Révision par répétition espacée dans le navigateur, sur le même catalogue que
[l'application iOS](https://apps.apple.com/app/id6749459846) : plus de 300 cours
gratuits en sept langues.

## Ce que c'est

Une page statique, sans dépendance ni étape de construction. Elle lit le
catalogue public directement — celui-ci est servi avec
`access-control-allow-origin: *`, donc aucun serveur intermédiaire n'est
nécessaire.

| Fichier | Rôle |
|---|---|
| `js/sm2.js` | Le moteur de répétition espacée |
| `js/store.js` | La progression, en IndexedDB |
| `js/catalogue.js` | La lecture du catalogue |
| `js/app.js` | Catalogue, fiche de cours, session, résultats |

## Deux points à savoir avant de modifier

**`sm2.js` est un miroir de `SpacedRepetitionEngine.swift`.** Les deux
plateformes doivent produire les mêmes intervalles. Une divergence ne se verrait
pas tout de suite : elle apparaîtrait des semaines plus tard, sous la forme de
cartes revenant au mauvais moment, et serait alors très difficile à rattacher à
sa cause. Toute modification ici se reporte dans le Swift, et réciproquement.

**La progression ne quitte pas le navigateur.** Celle des utilisateurs iOS vit
dans CloudKit, l'iCloud privé de chacun, qu'un navigateur ne peut pas atteindre.
CloudKit JS le permettrait en théorie, mais `NSPersistentCloudKitContainer` y
écrit un schéma interne que Apple ne documente ni ne garantit : y écrire depuis
JavaScript risquerait de corrompre la synchronisation de l'app iOS. Une
synchronisation web supposerait donc des comptes et un serveur — un projet à
part entière, qui viendrait s'ajouter à cette version sans la remplacer.

## Développement

    python3 -m http.server 8765

Puis <http://localhost:8765>.
