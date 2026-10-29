import { useEffect, useRef, useState } from 'react';

let loading;
function loadMaps() {
  if(window.google?.maps?.Map)return Promise.resolve(window.google.maps);
  const key=import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if(!key)return Promise.reject(new Error('Set VITE_GOOGLE_MAPS_BROWSER_KEY in frontend/.env.local, then restart Vite to enable the map.'));
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timer=setTimeout(()=>fail('Google Maps took too long to load. Check your connection and key restrictions.'),15000);
    function fail(message){clearTimeout(timer);script.remove();loading=null;reject(new Error(message));}
    window.__ridezGoogleReady=()=>{clearTimeout(timer);resolve(window.google.maps);};
    window.gm_authFailure=()=>{window.dispatchEvent(new Event('ridez.maps.error'));fail('Google Maps access was denied. Check browser key restrictions, API enablement and billing.');};
    script.src=`https://maps.googleapis.com/maps/api/js?${new URLSearchParams({key,v:'quarterly',libraries:'marker,geometry',callback:'__ridezGoogleReady',loading:'async'})}`;
    script.async=true;
    script.onerror=()=>fail('Google Maps could not load. Check your connection and browser key.');
    document.head.appendChild(script);
  });
  return loading;
}

export default function GoogleRouteMap({pickup,destination,polyline,onSelect}) {
  const element=useRef(null),map=useRef(null),objects=useRef([]),choose=useRef(onSelect),mode=useRef('pickup');
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[selection,setSelection]=useState('pickup'),[attempt,setAttempt]=useState(0);
  choose.current=onSelect;
  useEffect(()=>{
    let stopped=false,listener;
    function denied(){if(!stopped)setError('Google Maps access was denied. Check browser key restrictions, API enablement and billing.');}
    window.addEventListener('ridez.maps.error',denied);
    setError('');
    loadMaps().then(maps=>{
      if(stopped)return;
      map.current=new maps.Map(element.current,{center:{lat:19.076,lng:72.8777},zoom:13,mapId:import.meta.env.VITE_GOOGLE_MAP_ID || 'DEMO_MAP_ID',streetViewControl:false,mapTypeControl:false,fullscreenControl:false});
      listener=map.current.addListener('click',event=>{if(event.latLng && choose.current)choose.current(mode.current,{lat:event.latLng.lat(),lng:event.latLng.lng()});});
      setReady(true);
    }).catch(e=>{if(!stopped)setError(e.message);});
    return ()=>{stopped=true;listener?.remove();window.removeEventListener('ridez.maps.error',denied);objects.current.forEach(object=>{object.map=null;object.setMap?.(null);});objects.current=[];map.current=null;};
  },[attempt]);
  useEffect(()=>{
    if(!ready || !map.current)return;
    objects.current.forEach(object=>{if(object.setMap)object.setMap(null);else object.map=null;});
    objects.current=[];
    const maps=window.google.maps,bounds=new maps.LatLngBounds();
    let count=0;
    for(const [point,label] of [[pickup,'P'],[destination,'D']]){
      if(!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng))continue;
      const content=document.createElement('span');content.className=`map-point ${label==='P'?'pickup':'destination'}`;content.textContent=label;
      const marker=new maps.marker.AdvancedMarkerElement({map:map.current,position:point,title:label==='P'?'Pickup':'Destination',content});
      objects.current.push(marker);bounds.extend(point);count++;
    }
    if(polyline){
      try{
        const path=maps.geometry.encoding.decodePath(polyline);
        const line=new maps.Polyline({map:map.current,path,strokeColor:'#426d36',strokeOpacity:1,strokeWeight:5});
        objects.current.push(line);path.forEach(point=>bounds.extend(point));
      }catch{setError('The route line could not be displayed. The fare estimate remains available.');}
    }
    if(count>1)map.current.fitBounds(bounds,55);
    else if(count===1){map.current.setCenter(pickup || destination);map.current.setZoom(15);}
  },[ready,pickup?.lat,pickup?.lng,destination?.lat,destination?.lng,polyline]);
  return <section className="google-map-panel" aria-label="Google Maps route picker">{onSelect && <div className="map-selection"><span>Select on map:</span>{['pickup','destination'].map(value=><button type="button" key={value} className={selection===value?'selected':''} onClick={()=>{mode.current=value;setSelection(value);}}>{value==='pickup'?'Pickup':'Destination'}</button>)}</div>}<div className="google-map" ref={element}/>{error ? <div className="map-error" role="alert"><p>{error}</p><button type="button" className="text-link" onClick={()=>{setReady(false);setAttempt(value=>value+1);}}>Retry map</button></div> : !ready ? <p className="map-loading">Loading Google Maps…</p> : null}{onSelect && <p className="map-help">Choose pickup or destination, then click the map. You can also enter coordinates below.</p>}</section>;
}
