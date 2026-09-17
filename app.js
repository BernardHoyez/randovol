// Global state
let parsedGeoJSON = null;
let currentFileName = "randovol_survol";

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const generateBtn = document.getElementById('generateBtn');

// Event Listeners for File Import
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

function handleFile(file) {
    const name = file.name;
    const ext = name.split('.').pop().toLowerCase();
    currentFileName = name.substring(0, name.lastIndexOf('.')) || "randovol_survol";

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");

            if (ext === 'gpx') {
                parsedGeoJSON = toGeoJSON.gpx(xmlDoc);
            } else if (ext === 'kml') {
                parsedGeoJSON = toGeoJSON.kml(xmlDoc);
            } else {
                alert("Format non supporté. Veuillez importer un fichier .kml ou .gpx");
                return;
            }

            // Extract line geometry
            const line = extractLineString(parsedGeoJSON);
            if (!line) {
                alert("Aucun tracé (LineString) valide n'a été trouvé dans ce fichier.");
                return;
            }

            fileInfo.textContent = `Fichier chargé : ${name} (${turf.length(line, {units: 'kilometers'}).toFixed(2)} km)`;
            generateBtn.disabled = false;
        } catch (err) {
            console.error(err);
            alert("Erreur lors de la lecture du fichier XML/KML/GPX.");
        }
    };
    reader.readAsText(file);
}

function extractLineString(geojson) {
    if (geojson.type === 'FeatureCollection') {
        for (let f of geojson.features) {
            if (f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) {
                return f;
            }
        }
    } else if (geojson.type === 'Feature' && (geojson.geometry.type === 'LineString' || geojson.geometry.type === 'MultiLineString')) {
        return geojson;
    }
    return null;
}

// Generate KMZ
generateBtn.addEventListener('click', async () => {
    const altitude = parseFloat(document.getElementById('altitude').value) || 150;
    const tilt = parseFloat(document.getElementById('tilt').value) || 65;
    const stepDistance = parseFloat(document.getElementById('stepDistance').value) || 30; // meters
    const speedKmH = parseFloat(document.getElementById('speed').value) || 60; // km/h
    const range = parseFloat(document.getElementById('range').value) || 300;

    const line = extractLineString(parsedGeoJSON);
    if (!line) return;

    // Convert speed km/h to m/s
    const speedMs = speedKmH / 3.6;

    // Calculate total line length in meters
    const totalLength = turf.length(line, {units: 'meters'});

    // Sample coordinates along the route
    const tourPoints = [];
    let currentDistance = 0;

    while (currentDistance < totalLength) {
        const pt = turf.along(line, currentDistance, {units: 'meters'});
        tourPoints.push(pt.geometry.coordinates);
        currentDistance += stepDistance;
    }

    // Always include the last point
    const lastPt = turf.along(line, totalLength, {units: 'meters'});
    tourPoints.push(lastPt.geometry.coordinates);

    if (tourPoints.length < 2) {
        alert("Le tracé est trop court pour générer un survol.");
        return;
    }

    // Build KML gx:Tour XML String
    let playlistItems = "";

    for (let i = 0; i < tourPoints.length - 1; i++) {
        const p1 = tourPoints[i];
        const p2 = tourPoints[i + 1];

        // Compute bearing to next point
        const bearing = turf.bearing(turf.point(p1), turf.point(p2));
        const heading = (bearing + 360) % 360; // Normalize [0, 360]

        // Calculate segment duration (seconds)
        const segmentDist = turf.distance(turf.point(p1), turf.point(p2), {units: 'meters'});
        const duration = Math.max(0.5, segmentDist / speedMs);

        playlistItems += `
        <gx:FlyTo>
          <gx:duration>${duration.toFixed(2)}</gx:duration>
          <gx:flyToMode>smooth</gx:flyToMode>
          <LookAt>
            <longitude>${p1[0]}</longitude>
            <latitude>${p1[1]}</latitude>
            <altitude>${altitude}</altitude>
            <heading>${heading.toFixed(1)}</heading>
            <tilt>${tilt}</tilt>
            <range>${range}</range>
            <altitudeMode>relativeToGround</altitudeMode>
          </LookAt>
        </gx:FlyTo>`;
    }

    const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>RandoVol - ${currentFileName}</name>
    <open>1</open>
    <gx:Tour>
      <name>Lancer le survol (${altitude}m)</name>
      <gx:Playlist>
        ${playlistItems}
      </gx:Playlist>
    </gx:Tour>
  </Document>
</kml>`;

    // Create KMZ (Zip containing doc.kml)
    const zip = new JSZip();
    zip.file("doc.kml", kmlContent);

    const blob = await zip.generateAsync({type: "blob"});

    // Trigger download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${currentFileName}_randovol.kmz`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});
