/* RANDOVOL — v1
   Static PWA. Terrain altitude: IGN Géoplateforme / RGE ALTI.
   CesiumJS supplies the 3D globe and camera.
*/
const ALT_API="https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const ALT_RESOURCE="ign_rge_alti_wld";
const MAX_API_POINTS=5000;
const SAMPLE_SPACING_M=35;
const CAMERA_LOOK_AHEAD=90;

const $=id=>document.getElementById(id);
let viewer, route=[], routeEntity, trailEntity, waypoints=[], flying=false, raf=0, startTime=0, duration=0;
let groundReady=false;

Cesium.Ion.defaultAccessToken = undefined;

function setStatus(s){$("status").textContent=s}
function setStats(s){$("stats").textContent=s}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rad(d){return d*Math.PI/180}
function dist(a,b){
  const R=6371000, p1=rad(a.lat),p2=rad(b.lat),dp=rad(b.lat-a.lat),dl=rad(b.lon-a.lon);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function bearing(a,b){
  const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon);
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;
}
function interpolate(a,b,t){
  return {lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t};
}
function parseGPX(txt){
  const xml=new DOMParser().parseFromString(txt,"application/xml");
  if(xml.querySelector("parsererror")) throw Error("GPX/XML invalide");
  const pts=[...xml.querySelectorAll("trkpt,rtept")].map(n=>({lon:+n.getAttribute("lon"),lat:+n.getAttribute("lat"),z:+(n.querySelector("ele")?.textContent||NaN)})).filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat));
  const wps=[...xml.querySelectorAll("wpt")].map(n=>({lon:+n.getAttribute("lon"),lat:+n.getAttribute("lat"),name:n.querySelector("name")?.textContent||"Waypoint"}));
  return {pts,wps};
}
function parseKML(txt){
  const xml=new DOMParser().parseFromString(txt,"application/xml");
  if(xml.querySelector("parsererror")) throw Error("KML/XML invalide");
  const pts=[];
  for(const el of xml.querySelectorAll("LineString coordinates")){
    const raw=el.textContent.trim().split(/\s+/);
    for(const s of raw){const [lon,lat,z]=s.split(",").map(Number);if(Number.isFinite(lon)&&Number.isFinite(lat))pts.push({lon,lat,z:Number.isFinite(z)?z:NaN})}
  }
  const wps=[];
  for(const p of xml.querySelectorAll("Placemark")){
    const c=p.querySelector("Point coordinates"), name=p.querySelector("name")?.textContent?.trim();
    if(c){const [lon,lat,z]=c.textContent.trim().split(",").map(Number);if(Number.isFinite(lon)&&Number.isFinite(lat))wps.push({lon,lat,name:name||"Waypoint"})}
  }
  return {pts,wps};
}
function densify(src){
  const out=[src[0]];
  for(let i=1;i<src.length;i++){
    const a=src[i-1],b=src[i],d=dist(a,b),n=Math.max(1,Math.ceil(d/SAMPLE_SPACING_M));
    for(let j=1;j<=n;j++)out.push({...interpolate(a,b,j/n),z:NaN});
  }
  return out;
}
async function getElevations(points){
  // POST is deliberately used here: a long GPX can exceed practical URL/proxy
  // limits when 5,000 coordinate pairs are sent with GET.
  for(let i=0;i<points.length;i+=MAX_API_POINTS){
    const chunk=points.slice(i,i+MAX_API_POINTS);
    const body={
      lon:chunk.map(p=>p.lon.toFixed(7)).join("|"),
      lat:chunk.map(p=>p.lat.toFixed(7)).join("|"),
      resource:ALT_RESOURCE, delimiter:"|", indent:"false",
      measures:"false", zonly:"true"
    };
    const r=await fetch(ALT_API,{
      method:"POST",
      headers:{"Accept":"application/json","Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    if(!r.ok) throw Error(`Service altimétrique IGN: HTTP ${r.status}`);
    const j=await r.json();
    const z=j.elevations||[];
    chunk.forEach((p,k)=>p.z=Number(z[k]));
    $("bar").style.width=Math.min(100,((i+chunk.length)/points.length)*100)+"%";
  }
  return points;
}
function routeDistance(r){let d=0;for(let i=1;i<r.length;i++)d+=dist(r[i-1],r[i]);return d}

function makeViewer(){
  viewer=new Cesium.Viewer("cesiumContainer",{
    animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,
    navigationHelpButton:false,sceneModePicker:false,fullscreenButton:false,selectionIndicator:false,
    infoBox:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),
    imageryProvider:false
  });
  // Public IGN Plan IGN V2 WMTS: no application key required.
  viewer.imageryLayers.addImageryProvider(new Cesium.WebMapTileServiceImageryProvider({
    url:"https://data.geopf.fr/wmts",
    layer:"GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
    style:"normal",
    format:"image/png",
    tileMatrixSetID:"PM",
    maximumLevel:19,
    credit:"© IGN — Plan IGN"
  }));
  viewer.scene.globe.enableLighting=true;
  viewer.scene.globe.depthTestAgainstTerrain=false;
  viewer.scene.skyAtmosphere.show=true;
  viewer.scene.fog.enabled=true;
  viewer.camera.percentageChanged=.01;
  viewer.screenSpaceEventHandler.setInputAction(()=>stopFly(),Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")stopFly()});
  navigator.serviceWorker?.register("sw.js").catch(()=>{});
}
function drawRoute(){
  if(routeEntity)viewer.entities.remove(routeEntity);
  if(trailEntity)viewer.entities.remove(trailEntity);
  const cart=route.map(p=>Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.z));
  routeEntity=viewer.entities.add({polyline:{positions:cart,width:5,material:new Cesium.PolylineGlowMaterialProperty({glowPower:.15,color:Cesium.Color.YELLOW})}});
  trailEntity=viewer.entities.add({polyline:{positions:[],width:7,material:Cesium.Color.ORANGE}});
  for(const w of waypoints){
    viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(w.lon,w.lat,Number.isFinite(w.z)?w.z:0),
      point:{pixelSize:10,color:Cesium.Color.RED,outlineColor:Cesium.Color.WHITE,outlineWidth:2},
      label:{text:w.name,font:"14px sans-serif",showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(.65),pixelOffset:new Cesium.Cartesian2(0,-18)}})
  }
}
function makeDemo(){
  // Démo : boucle fictive de randonnée dans le secteur de la Sainte-Baume.
  // Le tracé est volontairement simple mais comporte plusieurs virages.
  const pts=[
    [43.3320,5.7710],[43.3335,5.7780],[43.3370,5.7830],
    [43.3410,5.7790],[43.3435,5.7710],[43.3415,5.7630],
    [43.3370,5.7580],[43.3325,5.7620],[43.3300,5.7690],
    [43.3320,5.7710]
  ];
  waypoints=[
    {lat:43.3370,lon:5.7830,name:"Point de vue"},
    {lat:43.3435,lon:5.7710,name:"Crête"},
    {lat:43.3320,lon:5.7710,name:"Départ / arrivée"}
  ];
  return pts.map(([lat,lon])=>({lat,lon,z:NaN}));
}
async function loadRoute(raw,wps=[]){
  if(raw.length<2)throw Error("Trace trop courte.");
  $("play").disabled=true;$("pause").disabled=true;$("reset").disabled=true;$("bar").style.width="0";
  setStatus("Interpolation de la trace…");
  route=densify(raw);
  setStats(`${route.length.toLocaleString("fr-FR")} positions · ${ (routeDistance(route)/1000).toFixed(2)} km`);
  setStatus(`Interrogation du MNT RGE ALTI® IGN (${route.length} points)…`);
  await getElevations(route);
  // Fill missing heights from source GPX if API returns nodata.
  for(let i=0;i<route.length;i++)if(!Number.isFinite(route[i].z)||route[i].z<-90000)route[i].z=0;
  waypoints=wps;
  drawRoute();
  viewer.flyTo(routeEntity,{duration:2});
  $("play").disabled=false;$("pause").disabled=false;$("reset").disabled=false;
  setStatus("Prêt. Altitude caméra = hauteur au-dessus du sol RGE ALTI®.");
}
function cameraAt(index){
  const i=Math.floor(index), f=index-i;
  const a=route[i], b=route[Math.min(route.length-1,i+1)];
  const p={lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,z:a.z+(b.z-a.z)*f};
  const lookIndex=Math.min(route.length-1,Math.floor(index)+Math.max(3,Math.round(CAMERA_LOOK_AHEAD/SAMPLE_SPACING_M)));
  const target=route[lookIndex];
  const h=+$("height").value;
  const pos=Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.z+h);
  const targetPos=Cesium.Cartesian3.fromDegrees(target.lon,target.lat,target.z);
  viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(bearing(p,target)),
    Cesium.Math.toRadians(-8),
    h*1.05
  ));
  // Force a short reset of the local transform after lookAt.
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}
function stopFly(){
  flying=false;cancelAnimationFrame(raf);$("pause").disabled=false;
}
function fly(){
  if(!route.length)return;
  flying=true;startTime=performance.now();duration=Math.max(20000,routeDistance(route)/(4.5*+$("speed").value)*1000);
  function frame(now){
    if(!flying)return;
    const t=clamp((now-startTime)/duration,0,1), idx=t*(route.length-1), i=Math.floor(idx);
    cameraAt(idx);
    trailEntity.polyline.positions=new Cesium.CallbackProperty(()=>route.slice(0,i+1).map(p=>Cesium.Cartesian3.fromDegrees(p.lon,p.lat,p.z+2)),false);
    $("bar").style.width=(t*100)+"%";
    if(t>=1){flying=false;setStatus("Survol terminé.");return}
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
}
$("file").addEventListener("change",async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const txt=await f.text();let data;
    if(/\.gpx$|<gpx/i.test(f.name)||/<trkpt/i.test(txt))data=parseGPX(txt);else data=parseKML(txt);
    await loadRoute(data.pts,data.wps);
  }catch(err){console.error(err);setStatus("Erreur : "+err.message)}
});
$("demo").onclick=()=>loadRoute(makeDemo(),[]).catch(e=>setStatus("Erreur : "+e.message));
$("play").onclick=()=>fly(); $("pause").onclick=()=>stopFly(); $("reset").onclick=()=>{stopFly();$("bar").style.width="0";if(route.length)cameraAt(0)};
$("height").oninput=e=>$("heightValue").textContent=e.target.value;
makeViewer();
