import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { ArrowRight, CarFront, Clock3, MapPin, RefreshCw } from 'lucide-react';
import { api } from './api';
import { getPosition, useDriverLocation } from './useDriverLocation';

const currency = amount => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount));
const labels = { SEARCHING:'Finding your driver', ASSIGNED:'Driver assigned', ARRIVING:'On the way to pickup', WAITING:'Waiting at pickup', IN_PROGRESS:'Trip in progress', COMPLETED:'Trip completed', CANCELLED:'Request cancelled', NO_DRIVER_FOUND:'No driver found' };
const actions = { ASSIGNED:['depart','Head to pickup'], ARRIVING:['arrive','I’ve arrived'], WAITING:['start','Start trip'], IN_PROGRESS:['complete','Complete trip'] };

function useWorkspace(token) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision,setRevision] = useState(0);
  const [connection,setConnection]=useState('Connecting');
  const connected=useRef(false);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    const socket=io({auth:{token},transports:['polling','websocket']});
    let timer;
    const seen=new Set();
    socket.on('connect',()=>{connected.current=true;setConnection('Live');refresh();});
    socket.on('disconnect',()=>{connected.current=false;setConnection('Reconnecting · polling fallback');refresh();});
    socket.on('connect_error',()=>{connected.current=false;setConnection('Polling fallback');});
    socket.on('workspace.changed',event=>{
      if(!event?.event_id || seen.has(event.event_id))return;
      seen.add(event.event_id);
      if(seen.size>100)seen.delete(seen.values().next().value);
      clearTimeout(timer);timer=setTimeout(refresh,80);
    });
    return ()=>{clearTimeout(timer);socket.removeAllListeners();socket.disconnect();connected.current=false;};
  },[token,refresh]);
  useEffect(()=>{
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const result = await api('/workspace', {token, signal:controller.signal});
        if (!controller.signal.aborted) { setData(result); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, connected.current ? 15000 : 2000);
    }
    poll();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[token,revision]);
  return { data,error,refresh,connection };
}
function Countdown({ deadline }) {
  const [time,setTime] = useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTime(Date.now()),500);return ()=>clearInterval(timer);},[]);
  const seconds=Math.max(0,Math.ceil((Date.parse(deadline)-time)/1000));
  return <span className="countdown"><Clock3 size={14}/>{seconds}s remaining</span>;
}
function QuoteDetails({ quote }) {
  return <div className="quote-details"><div className="trip-places"><span><MapPin size={15}/>{quote.pickup}</span><span><MapPin size={15}/>{quote.destination}</span></div><p>{quote.distance_km} km · approximately {quote.duration_min} min · simulated route</p><dl>{[['Base fare',quote.base],['Distance',quote.distance_fare],['Time',quote.time_fare],['Total estimate',quote.total]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{currency(value)}</dd></div>)}</dl></div>;
}
function RideCard({ride,role,perform,disabled}) {
  const next=actions[ride.status];
  return <article className="journey-card" aria-label={`Ride ${ride.status}`}><div className="journey-card-head"><span className="status-badge">{labels[ride.status]}</span><small>#{ride.id.slice(0,8)}</small></div><QuoteDetails quote={ride.quote}/>{ride.driver && <p className="trip-person"><CarFront size={17}/> Driver: {ride.driver.name} · {ride.driver.user_code}</p>}{role === 'driver' && <p>Rider: {ride.rider.name}</p>}{ride.status === 'SEARCHING' && <><Countdown deadline={ride.expires_at}/><p>Round {ride.round_no} · searching within {ride.radius_m} m. Radius expands by 500 m every 30 seconds, up to the configured limit.</p>{role === 'rider' && <button className="button subtle full" disabled={disabled} onClick={()=>perform(`/rides/${ride.id}/cancel`)}>Cancel request</button>}</>}{role === 'driver' && next && <button className="button dark full" disabled={disabled} onClick={()=>{if (next[0] !== 'complete' || window.confirm('Complete this trip and record the earnings allocation?')) perform(`/rides/${ride.id}/${next[0]}`);}}>{next[1]}<ArrowRight size={17}/></button>}{ride.settlement && <div className="settlement"><strong>Allocation recorded · not a payment</strong><span>Driver ({ride.settlement.driver_pct}%): {currency(ride.settlement.driver_amount)}</span><span>Company ({ride.settlement.company_pct}%): {currency(ride.settlement.company_amount)}</span></div>}</article>;
}

export default function RideWorkspace({role,user,token,view='overview'}) {
  const {data,error,refresh,connection}=useWorkspace(token);
  const trackingError=useDriverLocation({token,enabled:role === 'driver' && !!(data?.available || data?.active_ride),available:!!data?.available});
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[quote,setQuote]=useState(null),[completed,setCompleted]=useState(null);
  async function perform(path,body={}) {
    if (busy) return;
    setBusy(true);setActionError('');
    try {
      const response=await api(path,{token,method:'POST',body:JSON.stringify(body)});
      if (response.ride?.status === 'COMPLETED') setCompleted(response.ride);
      refresh();
      return response;
    } catch(e) {setActionError(e.message);return null;}
    finally {setBusy(false);}
  }
  const disabled=busy || !!error;
  const titles={overview:role === 'rider' ? `Where to, ${user.name.split(' ')[0]}?` : role === 'driver' ? 'Your next journey.' : 'A city in motion.',history:'Your journeys.',earnings:'Your earnings.',drivers:'Driver applications.',rides:'Ride operations.'};
  return <main className="dashboard"><div className="page-heading"><span className="tag"><span/>YOUR CITY. YOUR DIRECTION.</span><h1>{titles[view] || 'Your workspace.'}</h1><p>{role === 'rider' ? 'Choose your places. Review your fare. Make your move.' : 'A clear view of every step along the way.'}</p></div><div className="notice simulator-notice"><span>Sample fares and routes · GPS-based matching · no payments</span><span className="connection-status" role="status">{connection}</span><button aria-label="Refresh workspace" onClick={refresh}><RefreshCw size={16}/></button></div>{trackingError && <div className="form-error" role="alert">{trackingError}</div>}{(error || actionError) && <div className="form-error" role="alert">{error || actionError}{error && ' Actions are paused until the connection recovers. If your session expired, sign out and sign in again.'}</div>}{!data ? <div className="empty-panel"><p>{error ? 'Unable to load your workspace. Use refresh to retry.' : 'Loading your workspace…'}</p></div> : <>
    {view === 'overview' && role === 'rider' && <>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <div className="journey-grid"><section className="journey-card"><h2>Let’s go places.</h2><p>Enter two places to generate a development estimate.</p><form onSubmit={async event=>{event.preventDefault();setQuote(null);const response=await perform('/fares/quotes',(()=>{const values=Object.fromEntries(new FormData(event.currentTarget));return {...values,pickup_lat:Number(values.pickup_lat),pickup_lng:Number(values.pickup_lng)};})());if(response)setQuote(response.quote);}}><div className="location-fields"><label>Pickup location<input name="pickup" maxLength={160} required placeholder="City centre"/></label><label>Destination<input name="destination" maxLength={160} required placeholder="Riverside"/></label></div><div className="coordinate-fields"><label>Pickup latitude<input type="number" name="pickup_lat" step="any" min="-90" max="90" required placeholder="e.g. 19.076"/></label><label>Pickup longitude<input type="number" name="pickup_lng" step="any" min="-180" max="180" required placeholder="e.g. 72.8777"/></label></div><button type="button" className="button subtle full" disabled={disabled} onClick={async event=>{const form=event.currentTarget.form;try{const position=await getPosition();form.elements.pickup_lat.value=position.latitude;form.elements.pickup_lng.value=position.longitude;setActionError('');}catch(e){setActionError(e.message);}}}>Use my location</button><p>Coordinates determine matching. Place names are labels until live maps are connected.</p><button className="button dark full" disabled={disabled}>Get fare estimate <ArrowRight size={17}/></button></form></section>{quote ? <section className="journey-card"><h2>Your fare, upfront.</h2><QuoteDetails quote={quote}/><p>Quote expires at {new Date(quote.expires_at).toLocaleTimeString()}. Sample rates: ₹40 base + ₹12/km + ₹2/min. No surge, taxes or fees.</p><button className="button dark full" disabled={disabled} onClick={async()=>{const response=await perform('/rides',{quote_id:quote.id});if(response)setQuote(null);}}>Confirm simulated ride <ArrowRight size={17}/></button></section> : <section className="empty-panel"><MapPin size={38}/><h2>Every journey starts somewhere.</h2><p>Your itemized estimate will appear here. Addresses are labels in this simulator; they are not geocoded.</p></section>}</div>}{!data.active_ride && data.rides[0] && <section className="recent-trip"><h2>Most recent journey</h2><RideCard ride={data.rides[0]} role={role} perform={perform} disabled={disabled}/></section>}</>}
    {view === 'overview' && role === 'driver' && <><div className="approval-banner"><CarFront size={26}/><div><h3>{data.user.status === 'pending' ? 'Your application is in review' : data.active_ride ? 'You have an active trip' : data.available ? 'You’re available for requests' : 'You’re offline'}</h3><p>{data.user.status === 'pending' ? 'An admin must approve your application before you can go available.' : 'Location is sent about every 30 seconds while available or on a trip. Keep this tab open; background updates are not guaranteed.'}</p></div>{data.user.status === 'active' && !data.active_ride && <button className={`button ${data.available ? 'subtle' : 'dark'}`} disabled={disabled || (!data.simulator && !data.available)} onClick={async()=>{if(data.available){perform('/driver/availability',{available:false});return;}setBusy(true);setActionError('');try{const position=await getPosition();setBusy(false);await perform('/driver/availability',{available:true,...position});}catch(e){setActionError(e.message);setBusy(false);}}}>{data.available ? 'Go offline' : 'Go available'}</button>}</div><div className="location-freshness"><span className={data.location?.fresh ? 'fresh-dot' : 'stale-dot'}/>{data.location?.fresh ? 'Location fresh' : 'Location missing or stale — excluded from matching'}{data.location?.recorded_at && <small> · Last captured {new Date(data.location.recorded_at).toLocaleTimeString()} · accuracy {Math.round(data.location.accuracy_m)} m</small>}</div>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <><h2 className="section-title">Incoming requests</h2>{data.invitations.length ? <div className="journey-grid">{data.invitations.map(ride=><article className="journey-card" key={ride.id}><h2>New ride request</h2><Countdown deadline={ride.expires_at}/><QuoteDetails quote={ride.quote}/><div className="invitation-actions"><button className="button subtle" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/reject`)}>Reject</button><button className="button dark" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/accept`)}>Accept ride <ArrowRight size={17}/></button></div></article>)}</div> : <div className="empty-panel"><CarFront size={34}/><h2>{data.available ? 'Ready for your next move.' : 'Take the road when you’re ready.'}</h2><p>{data.available ? 'Keep this page open. New simulated requests will appear here.' : 'Go available with location permission. You can receive invitations in subsequent search rounds if you enter the expanding radius.'}</p></div>}{completed && <div className="recent-trip"><RideCard ride={completed} role={role} perform={perform} disabled={disabled}/></div>}</>}</>}
    {(view === 'drivers' || (view === 'overview' && role === 'admin')) && <section className="journey-card"><h2>Driver applications</h2><p>Approve only after reviewing the driver. Every approval records your reason in the audit log.</p>{data.drivers?.length ? data.drivers.map(driver=><div className="driver-row" key={driver.id}><div><strong>{driver.name}</strong><small>{driver.user_code} · {driver.status} · {driver.location?.fresh ? 'location fresh' : 'location stale/missing'}</small></div>{driver.status === 'pending' && <button className="button dark" disabled={disabled} onClick={()=>{const reason=window.prompt(`Approval reason for ${driver.name}`);if(reason)perform(`/admin/drivers/${driver.id}/approve`,{reason});}}>Approve driver</button>}</div>) : <p>No driver applications yet.</p>}</section>}
    {(view === 'history' || view === 'rides' || (role === 'admin' && view === 'overview')) && <section className="recent-trip"><h2>{role === 'admin' ? 'Recent rides' : 'Ride history'}</h2>{data.rides.length ? <div className="journey-grid">{data.rides.map(ride=><RideCard key={ride.id} ride={ride} role={role} perform={perform} disabled={disabled}/>)}</div> : <div className="empty-panel"><p>No journeys yet.</p></div>}</section>}
    {view === 'earnings' && role === 'driver' && <><section className="stat earnings-total"><small>Total allocated earnings</small><strong>{currency(data.allocated_earnings)}</strong><p>85% driver / 15% company · allocations recorded, no money transferred.</p></section><div className="journey-grid">{data.earnings.map(entry=><article className="journey-card" key={entry.ride_id}><small>Trip #{entry.ride_id.slice(0,8)}</small><h2>{currency(entry.driver_amount)}</h2><p>{entry.driver_pct}% of eligible fare {currency(entry.eligible_fare)} · {entry.status}</p></article>)}</div>{!data.earnings.length && <div className="empty-panel"><p>Your allocations will appear after completing your first trip.</p></div>}</>}
  </>}</main>;
}
