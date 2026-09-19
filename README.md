# RANDOVOL

PWA statique de survol 3D d'une randonnée.

## Version 1.2 — MNT automatique

RANDOVOL détecte automatiquement l'emprise du GPX/KML importé, ajoute une marge de 500 m, puis récupère le MNT **RGE ALTI® IGN** correspondant via le service WMS-r de la Géoplateforme. Le GeoTIFF d'altitude est décodé directement dans le navigateur avec GeoTIFF.js et fourni à Cesium sous forme de terrain 3D local en mémoire.

Il n'est donc plus nécessaire de préparer manuellement les dalles RGE ALTI pour chaque randonnée.

### Fonctionnement

1. Importer un GPX ou KML.
2. RANDOVOL interpole la trace.
3. L'emprise est calculée automatiquement (+ 500 m).
4. Le MNT RGE ALTI est téléchargé à la résolution adaptée à l'emprise.
5. Les altitudes de la trace sont interpolées depuis ce MNT.
6. Cesium affiche le relief réel et le survol peut être lancé à une hauteur de 50 à 500 m au-dessus du terrain.

### Sources

- Terrain : IGN, RGE ALTI®, via Géoplateforme WMS-r.
- Fond cartographique : BD ORTHO® IGN WMTS.
- Globe/terrain : CesiumJS.
- Décodage GeoTIFF : GeoTIFF.js.

### Important

Le MNT est téléchargé à la volée : une connexion Internet est donc nécessaire lors de la première ouverture d'une randonnée. Le service worker met en cache les requêtes de terrain déjà téléchargées afin de faciliter la réutilisation d'une même emprise.


### Correction fond cartographique
Le fond BD ORTHO® IGN utilise désormais directement le modèle WMTS EPSG:3857/PM avec `UrlTemplateImageryProvider` et `WebMercatorTilingScheme`, plus robuste avec Cesium 1.138.


## BD ORTHO IGN
La version utilise le flux **WMTS BD ORTHO® IGN** (`ORTHOIMAGERY.ORTHOPHOTOS`) en Web Mercator / TileMatrixSet `PM`. L'image est une `ImageryProvider` Cesium et est donc drapée automatiquement sur le MNT local.

Le fond Plan IGN n'est pas utilisé dans cette version : la couche principale est la photographie aérienne BD ORTHO.
