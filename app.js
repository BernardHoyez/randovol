/* RANDOVOL — automatic RGE ALTI terrain
   Static PWA: the GPX/KML extent is detected automatically, then the IGN
   RGE ALTI terrain is requested as a GeoTIFF through the Géoplateforme WMS.
   The raster is decoded in-browser and supplied to Cesium as a custom
   heightmap terrain provider.
*/
const WMS_URL="https://data.geopf.fr/wms-r/wms";
const WMS_LAYER="ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES";
const SAMPLE_MAX=768;
const ROUTE_SPACING_M=35;
const TERRAIN_MARGIN_M=500;
const CAMERA_LOOK_AHEAD=90;
const $=id=>document.getElementById(id);
let viewer,route=[],routeEntity,trailEntity,waypoints=[],flying=false,raf=0,startTime=0,duration=0;
let terrainState=null,terrainProvider=null;

function setStatus(s){$("status").textContent=s}
function setStats(s){$("stats").textContent=s}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rad(d){return d*Math.PI/180}
function dist(a,b){const R=6371000,p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon),h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function bearing(a,b){const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon);return(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360}
function interpolate(a,b,t){return{lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t}}
function parseGPX(txt){const xml=new DOMParser().parseFromString(txt,"application/xml");if(xml.querySelector("parsererror"))throw Error("GPX/XML invalide");const pts=[...xml.querySelectorAll("trkpt,rtept")].map(n=>({lon:+n.getAttribute("lon"),lat:+n.getAttribute("lat"),z:+(n.querySelector("ele")?.textContent||NaN)})).filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat));const wps=[...xml.querySelectorAll("wpt")].map(n=>({lon:+n.getAttribute("lon"),lat:+n.getAttribute("lat"),name:n.querySelector("name")?.textContent||"Waypoint"}));return{pts,wps}}
function parseKML(txt){const xml=new DOMParser().parseFromString(txt,"application/xml");if(xml.querySelector("parsererror"))throw Error("KML/XML invalide");const pts=[];for(const el of xml.querySelectorAll("LineString coordinates")){for(const s of el.textContent.trim().split(/\s+/)){const [lon,lat,z]=s.split(",").map(Number);if(Number.isFinite(lon)&&Number.isFinite(lat))pts.push({lon,lat,z:Number.isFinite(z)?z:NaN})}}const wps=[];for(const p of xml.querySelectorAll("Placemark")){const c=p.querySelector("Point coordinates"),name=p.querySelector("name")?.textContent?.trim();if(c){const [lon,lat]=c.textContent.trim().split(",").map(Number);if(Number.isFinite(lon)&&Number.isFinite(lat))wps.push({lon,lat,name:name||"Waypoint"})}}return{pts,wps}}
function densify(src){const out=[{...src[0]}];for(let i=1;i<src.length;i++){const a=src[i-1],b=src[i],d=dist(a,b),n=Math.max(1,Math.ceil(d/ROUTE_SPACING_M));for(let j=1;j<=n;j++)out.push({...interpolate(a,b,j/n),z:NaN})}return out}
function bbox(points,marginM=TERRAIN_MARGIN_M){let west=Math.min(...points.map(p=>p.lon)),east=Math.max(...points.map(p=>p.lon)),south=Math.min(...points.map(p=>p.lat)),north=Math.max(...points.map(p=>p.lat));const lat0=(south+north)/2, dLat=marginM/111320, dLon=marginM/(111320*Math.cos(rad(lat0)));return{west:west-dLon,east:east+dLon,south:south-dLat,north:north+dLat}}
function terrainDimensions(b){const latM=(b.north-b.south)*111320,lonM=(b.east-b.west)*111320*Math.cos(rad((b.north+b.south)/2));const aspect=lonM/latM;let width=aspect>=1?SAMPLE_MAX:Math.max(256,Math.round(SAMPLE_MAX*aspect));let height=aspect>=1?Math.max(256,Math.round(SAMPLE_MAX/aspect)):SAMPLE_MAX;return{width,height}}
function wmsUrl(b,w,h){const q=new URLSearchParams({SERVICE:"WMS",VERSION:"1.3.0",REQUEST:"GetMap",STYLES:"normal",FORMAT:"image/geotiff",LAYERS:WMS_LAYER,CRS:"EPSG:4326",WIDTH:String(w),HEIGHT:String(h),BBOX:`${b.south},${b.west},${b.north},${b.east}`,TRANSPARENT:"FALSE"});return`${WMS_URL}?${q}`}
async function fetchTerrainRaster(b,w,h){const url=wmsUrl(b,w,h);const cache=await caches.open("randovol-mnt-v1").catch(()=>null);for(let attempt=1;attempt<=3;attempt++){try{let response=cache?await cache.match(url):null;if(!response){setStatus(`Téléchargement du MNT RGE ALTI® IGN… (${attempt}/3)`);response=await fetch(url,{mode:"cors",cache:"no-store"});if(!response.ok)throw Error(`IGN WMS HTTP ${response.status}`);if(cache)cache.put(url,response.clone()).catch(()=>{})}const buf=await response.arrayBuffer();const tiff=await GeoTIFF.fromArrayBuffer(buf);const image=await tiff.getImage();const rasters=await image.readRasters({interleave:true});const values=rasters instanceof Float32Array||rasters instanceof Float64Array?rasters:new Float32Array(rasters);let min=Infinity,max=-Infinity,count=0;for(let i=0;i<values.length;i++){const z=values[i];if(Number.isFinite(z)&&z>-1000&&z<10000){min=Math.min(min,z);max=Math.max(max,z);count++}}if(count<100)throw Error("Le raster IGN reçu est vide ou invalide.");const bb=image.getBoundingBox();return{values,width:image.getWidth(),height:image.getHeight(),bbox:{west:bb[0],south:bb[1],east:bb[2],north:bb[3]},min,max,url}}catch(e){if(attempt===3)throw e;await new Promise(r=>setTimeout(r,600*attempt))}}
}
function rasterAt(lon,lat){if(!terrainState)return NaN;const t=terrainState;const x=(lon-t.bbox.west)/(t.bbox.east-t.bbox.west)*(t.width-1),y=(t.bbox.north-lat)/(t.bbox.north-t.bbox.south)*(t.height-1);if(x<0||y<0||x>t.width-1||y>t.height-1)return NaN;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(t.width-1,x0+1),y1=Math.min(t.height-1,y0+1),fx=x-x0,fy=y-y0;const v=(xx,yy)=>{const z=t.values[yy*t.width+xx];return Number.isFinite(z)&&z>-1000?z:NaN};const a=v(x0,y0),b=v(x1,y0),c=v(x0,y1),d=v(x1,y1);if([a,b,c,d].every(Number.isFinite))return a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy;const vals=[a,b,c,d].filter(Number.isFinite);return vals.length?vals.reduce((s,z)=>s+z,0)/vals.length:NaN}
function makeTerrainProvider(t){const tilingScheme=new Cesium.GeographicTilingScheme({rectangle:Cesium.Rectangle.fromDegrees(t.bbox.west,t.bbox.south,t.bbox.east,t.bbox.north),numberOfLevelZeroTilesX:1,numberOfLevelZeroTilesY:1});return new Cesium.CustomHeightmapTerrainProvider({width:t.width,height:t.height,tilingScheme,credit:"© IGN — RGE ALTI® / Géoplateforme",callback:(x,y,level)=>level===0?t.values:undefined})}
async function loadTerrain(raw){const b=bbox(raw);const d=terrainDimensions(b);setStats(`${raw.length.toLocaleString("fr-FR")} points · emprise MNT ${(b.east-b.west).toFixed(4)}° × ${(b.north-b.south).toFixed(4)}°`);setStatus(`Détection de l'emprise : ${(b.west).toFixed(4)} / ${(b.east).toFixed(4)} E · ${(b.south).toFixed(4)} / ${(b.north).toFixed(4)} N`);terrainState=await fetchTerrainRaster(b,d.width,d.height);terrainProvider=makeTerrainProvider(terrainState);viewer.terrainProvider=terrainProvider;viewer.scene.globe.depthTestAgainstTerrain=true;for(const p of route){const z=rasterAt(p.lon,p.lat);if(Number.isFinite(z))p.z=z}return b}
function routeDistance(r){let d=0;for(let i=1;i<r.length;i++)d+=dist(r[i-1],r[i]);return d}
function makeViewer(){viewer=new Cesium.Viewer("cesiumContainer",{animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,navigationHelpButton:false,sceneModePicker:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),imageryProvider:false});
// BD ORTHO IGN : l'imagerie est une couche d'imagery Cesium et se drape automatiquement sur le terrain.
const ortho=new Cesium.WebMapTileServiceImageryProvider({
  url:"https://data.geopf.fr/wmts",
  layer:"ORTHOIMAGERY.ORTHOPHOTOS",
  style:"normal",
  format:"image/jpeg",
  tileMatrixSetID:"PM",
  tilingScheme:new Cesium.WebMercatorTilingScheme(),
  minimumLevel:0,
  maximumLevel:19,
  credit:"© IGN — BD ORTHO® / Géoplateforme",
  enablePickFeatures:false
});
ortho.errorEvent.addEventListener(err=>{
  console.warn("BD ORTHO IGN — erreur de tuile",err);
  setStatus("BD ORTHO : une tuile n'a pas pu être chargée. Vérifiez la connexion et le service IGN.");
});
viewer.imageryLayers.addImageryProvider(ortho);
viewer.scene.globe.enableLighting=true;viewer.scene.globe.depthTestAgainstTerrain=true;viewer.scene.skyAtmosphere.show=true;viewer.scene.fog.enabled=true;viewer.camera.percentageChanged=.01;viewer.screenSpaceEventHandler.setInputAction(()=>stopFly(),Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);document.addEventListener("keydown",e=>{if(e.key==="Escape")stopFly()});navigator.serviceWorker?.register("sw.js").catch(()=>{})}
function drawRoute(){if(routeEntity)viewer.entities.remove(routeEntity);if(trailEntity)viewer.entities.remove(trailEntity);const cart=route.map(p=>Cesium.Cartesian3.fromDegrees(p.lon,p.lat,Number.isFinite(p.z)?p.z:0));routeEntity=viewer.entities.add({polyline:{positions:cart,width:5,clampToGround:false,material:new Cesium.PolylineGlowMaterialProperty({glowPower:.15,color:Cesium.Color.YELLOW})}});trailEntity=viewer.entities.add({polyline:{positions:[],width:7,material:Cesium.Color.ORANGE}});for(const w of waypoints){const z=rasterAt(w.lon,w.lat);viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(w.lon,w.lat,Number.isFinite(z)?z:0),point:{pixelSize:10,color:Cesium.Color.RED,outlineColor:Cesium.Color.WHITE,outlineWidth:2},label:{text:w.name,font:"14px sans-serif",showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(.65),pixelOffset:new Cesium.Cartesian2(0,-18)}})}}
function makeDemo(){const pts=[[43.3320,5.7710],[43.3335,5.7780],[43.3370,5.7830],[43.3410,5.7790],[43.3435,5.7710],[43.3415,5.7630],[43.3370,5.7580],[43.3325,5.7620],[43.3300,5.7690],[43.3320,5.7710]];waypoints=[{lat:43.3370,lon:5.7830,name:"Point de vue"},{lat:43.3435,lon:5.7710,name:"Crête"},{lat:43.3320,lon:5.7710,name:"Départ / arrivée"}];return pts.map(([lat,lon])=>({lat,lon,z:NaN}))}
async function loadRoute(raw,wps=[]){if(raw.length<2)throw Error("Trace trop courte.");
$("play").disabled=true;$("pause").disabled=true;$("reset").disabled=true;$("bar").style.width="0";setStatus("Interpolation de la trace…");route=densify(raw);waypoints=wps;setStats(`${route.length.toLocaleString("fr-FR")} positions · ${(routeDistance(route)/1000).toFixed(2)} km`);setStatus("Calcul de l'emprise du MNT…");await loadTerrain(route);for(let i=0;i<route.length;i++)if(!Number.isFinite(route[i].z)){const src=raw[Math.min(raw.length-1,Math.round(i*(raw.length-1)/(route.length-1)))];route[i].z=Number.isFinite(src.z)?src.z:0}drawRoute();viewer.flyTo(routeEntity,{duration:2});$("play").disabled=false;$("pause").disabled=false;$("reset").disabled=false;setStatus(`MNT RGE ALTI® chargé (${terrainState.width} × ${terrainState.height} points) · BD ORTHO® IGN active. Prêt pour le survol.`)}
function cameraAt(index){const i=Math.floor(index),f=index-i,a=route[i],b=route[Math.min(route.length-1,i+1)],p={lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,z:a.z+(b.z-a.z)*f},lookIndex=Math.min(route.length-1,Math.floor(index)+Math.max(3,Math.round(CAMERA_LOOK_AHEAD/ROUTE_SPACING_M))),target=route[lookIndex],h=+$('height').value,pos=Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.z+h);viewer.camera.lookAt(pos,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(bearing(p,target)),Cesium.Math.toRadians(-8),h*1.05));viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)}
function stopFly(){flying=false;cancelAnimationFrame(raf);$("pause").disabled=false}
function fly(){if(!route.length)return;flying=true;startTime=performance.now();duration=Math.max(20000,routeDistance(route)/(4.5*+$('speed').value)*1000);function frame(now){if(!flying)return;const t=clamp((now-startTime)/duration,0,1),idx=t*(route.length-1),i=Math.floor(idx);cameraAt(idx);trailEntity.polyline.positions=route.slice(0,i+1).map(p=>Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.z+2));$("bar").style.width=t*100+"%";if(t>=1){flying=false;setStatus("Survol terminé.");return}raf=requestAnimationFrame(frame)}raf=requestAnimationFrame(frame)}
$("file").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const txt=await f.text();let data;if(/\.gpx$|<gpx/i.test(f.name)||/<trkpt/i.test(txt))data=parseGPX(txt);else data=parseKML(txt);await loadRoute(data.pts,data.wps)}catch(err){console.error(err);setStatus("Erreur : "+err.message)}});
$("demo").onclick=()=>loadRoute(makeDemo(),[]).catch(e=>setStatus("Erreur : "+e.message));
$("play").onclick=()=>fly();$("pause").onclick=()=>stopFly();$("reset").onclick=()=>{stopFly();$("bar").style.width="0";if(route.length)cameraAt(0)};$("height").oninput=e=>$("heightValue").textContent=e.target.value;makeViewer();
