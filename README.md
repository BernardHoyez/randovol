# RANDOVOL

PWA statique de survol 3D d'une randonnée.

## Fonctionnalités v1
- Import GPX et KML.
- Interpolation de la trace à ~35 m.
- Altitudes récupérées auprès de l'API altimétrique de la Géoplateforme avec la ressource `ign_rge_alti_wld` (RGE ALTI®).
- Caméra Cesium réglable de 50 à 500 m au-dessus du sol.
- Survol avec vitesse 0,5× à 5×.
- Trace et waypoints.
- Service worker `sw.js` nommé « brise-caches » dans l'usage du projet.
- Fond Plan IGN V2.
- Démo intégrée.

## Déploiement GitHub Pages
1. Décompresser le ZIP.
2. Copier le contenu du dossier `randovol` dans le dépôt GitHub Pages.
3. Activer GitHub Pages sur la branche/dossier voulu.
4. Ouvrir le site en HTTPS.

## Important sur le MNT
Cette première version utilise le **RGE ALTI® pour l'altitude du sol et la trajectoire verticale de la caméra**, via le service altimétrique ouvert de la Géoplateforme. Le relief visuel Cesium reste le globe ellipsoïdal : l'application n'embarque pas les dalles RGE ALTI (trop volumineuses) et ne nécessite aucun token Cesium ion.

La documentation IGN indique que l'API altimétrique permet jusqu'à 5 000 couples lon/lat par requête et que `ign_rge_alti_wld` correspond à une ressource RGE ALTI® couvrant la France. 

## Limites
- KMZ n'est pas encore décompressé côté navigateur dans cette v1.
- Le mode vidéo n'est pas encore inclus.
- L'altitude caméra est relative au MNT RGE ALTI, mais le relief 3D affiché n'est pas encore un maillage RGE ALTI.

## Évolutions prévues
- Lecture KMZ.
- Profil altimétrique.
- caméra avec anticipation de virage et spline Catmull-Rom.
- mode « regard vers l'horizon » réglable.
- export vidéo WebM.
- éventuellement génération de tuiles terrain Cesium à partir de dalles RGE ALTI locales pour un véritable relief 3D IGN.
