# Données astronomiques

Le site embarque **119 625 étoiles de HYG 4.1**, sans filtre de magnitude.
Cela représente toutes les entrées stellaires de cette version du catalogue,
pas toutes les étoiles de l'Univers. L'entrée du Soleil est retirée.

## Provenance et reproduction

- Auteur : **David Nash / Astronexus**.
- [Catalogue officiel HYG 4.1](https://github.com/astronexus/HYG-Database/blob/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT/hygdata_v41.csv).
- Révision : `c7f7f883fe678cc7680169a50ccd7dcc49b060ce`.
- SHA-256 du CSV : `d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd`.
- Licence des données et de leur adaptation JSON : [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Attribution distribuée avec les données : `public/data/LICENSE.md`.
- [Documentation officielle des champs](https://github.com/astronexus/HYG-Database/blob/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/README.md).

Le dépôt GitHub de HYG est archivé ; [le développement se poursuit sur Codeberg](https://codeberg.org/astronexus/hyg).
Le site utilise volontairement une version identifiée et reproductible.

## Noms français des constellations

Les noms français de `src/lib/constellationNames.ts` sont vérifiés dans le
[glossaire français officiel de Stellarium](https://github.com/Stellarium/stellarium/blob/3f55371bf69186a1690c7b46d18e35df933a4947/po/stellarium-skycultures/fr.po),
rubrique des noms de constellations modernes, consultée le 18 septembre 2026.
Les articles sont retirés pour les libellés courts de l'interface ; les noms
latins et les codes du catalogue restent disponibles pour la recherche.
`Hydre mâle` correspond à Hydrus, également appelée `Petite Hydre`.
Le code historique `Tra` des tracés et le code UAI `TrA` du catalogue désignent
tous deux le Triangle austral.

## Import du catalogue

```bash
python3 scripts/build_catalog.py
# Ou avec le CSV officiel déjà téléchargé :
python3 scripts/build_catalog.py --source /chemin/hygdata_v41.csv
```

Le script vérifie l'empreinte, les coordonnées, l'unicité des identifiants et le
nombre d'entrées avant d'écrire. Il conserve les **37 champs**, convertit les
valeurs absentes en `null` et produit un JSON déterministe de 36,28 Mo ainsi que
sa version gzip de **13,76 Mo**. Le gzip utilise un horodatage nul et aucun nom de
fichier embarqué pour rester reproductible. Il contient exactement le même JSON.
Le tableau `columns` nomme chaque position des tableaux `rows` ; ce format évite
de répéter les noms des champs pour chaque étoile. Le navigateur reconstitue des
objets TypeScript après validation de chaque valeur. Le fichier est servi
localement avec le site ; aucun service astronomique tiers n'est appelé pour
charger la carte.

Le navigateur charge en priorité `stars.json.gz` et le décompresse avec
`DecompressionStream`, sans dépendre de la compression HTTP de GitHub Pages.
La signature des octets reçus détermine si une décompression est nécessaire :
un serveur qui envoie `Content-Encoding: gzip` peut déjà avoir fait décompresser
le fichier par le navigateur, ce qui évite une seconde décompression.
Il utilise le JSON lisible en secours lorsque cette API n'est pas disponible
ou lorsque le fichier compressé manque ou ne peut pas être décodé. Les deux
fichiers doivent être publiés dans `data/` ; les chemins respectent la base Vite.

## Interprétation

Les coordonnées sont équatoriales, époque et équinoxe **J2000.0** : ascension droite
en heures, déclinaison en degrés. La carte n'applique ni date d'observation,
ni position de l'observateur, ni mouvement propre à ces coordonnées de référence.

La projection reste équirectangulaire : les positions sont correctes dans ce
repère, mais les distances et les formes sont déformées près des pôles. Le
défilement vertical prolonge le repère en réfléchissant la déclinaison au passage
de chaque pôle et en décalant l'ascension droite de 12 heures. Un tour vertical
complet correspond à 360°, sans raccord artificiel entre les pôles opposés.
Les coordonnées affichées et les recherches sont toujours exprimées dans le
repère physique habituel, avec une déclinaison comprise entre −90° et +90°.
Le compteur compte les étoiles distinctes, même lorsqu'une étoile a plusieurs
représentations dans le prolongement de la carte.

Les liaisons des constellations suivent les arcs courts de grand cercle entre
leurs étoiles. Les courbes sont subdivisées selon leur erreur de projection à
l'écran, et interrompues aux singularités polaires du planisphère. Ces liaisons
représentent des figures conventionnelles, pas les frontières officielles des
constellations. Les graduations d'ascension droite affichent les secondes
lorsqu'un pas tombe sur une demi-minute.

`mag` est la magnitude visuelle apparente. Les valeurs de `dist` supérieures ou
égales à 100 000 pc signalent une parallaxe absente ou douteuse : l'interface
ne doit pas les présenter comme des distances mesurées. Les valeurs originales
restent dans le JSON. Les propriétés dérivées de ces distances (`absmag`, `lum`,
`x`, `y`, `z`) sont également à interpréter avec cette réserve.

Les champs supplémentaires conservent mouvements propres, vitesses, identifiants,
type spectral, systèmes multiples et variabilité. HYG ne distingue pas toujours
une vitesse radiale manquante d'une valeur nulle.

**HYG ne fournit pas de diamètre angulaire mesuré.** Le rayon dessiné est une
échelle graphique de magnitude, avec un minimum visible et un maximum borné.
Il ne représente ni le diamètre physique ni la taille angulaire réelle.

## Couleurs et températures

La couleur s'appuie sur l'indice photométrique B−V, puis sur une approximation
du rayonnement d'un corps noir. La température correspondante est estimée par
l'équation 14 de [F. J. Ballesteros, _New insights into black bodies_ (2012)](https://arxiv.org/abs/1201.1809).
Le spectre de Planck est intégré de 380 à 780 nm, par pas de 5 nm, avec les fonctions
colorimétriques CIE 1931 approchées par l'équation 4 / tableau 1 de
[Wyman, Sloan et Shirley (2013)](https://jcgt.org/published/0002/02/01/), puis converti
en sRGB normalisé. Un cache de températures par pas de 50 K accélère le dessin.

La température informative n'est donnée que pour −0,4 ≤ B−V ≤ 2. Les indices
plus extrêmes restent intacts dans les données et saturent seulement la palette.
Sans B−V, les classes O/B/A/F/G/K/M utilisent une teinte indicative issue d'une
température représentative ; sans classe reconnue, le point est gris clair neutre.
`colorSource()` distingue ces trois cas. Cette restitution est une approximation
pour écran : elle ne corrige pas l'extinction interstellaire et ne remplace pas
une mesure spectrale. La température photométrique reste explicitement estimée.
