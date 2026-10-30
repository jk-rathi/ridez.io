import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { ArrowRight, CarFront, Clock3, MapPin, RefreshCw } from 'lucide-react';
import { api } from './api';
import { getPosition, useDriverLocation } from './useDriverLocation';
import BookingPanel from './BookingPanel';
import GoogleRouteMap from './GoogleRouteMap';

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
  const rows=[['Base fare',quote.base],['Distance',quote.distance_fare],['Time (prorated per second)',quote.time_fare]];
  if(Number(quote.minimum_adjustment)>0)rows.push(['Minimum fare adjustment',quote.minimum_adjustment]);
  if(Number(quote.surge_amount)>0)rows.push([`Surge ×${quote.surge_multiplier}`,quote.surge_amount]);
  rows.push(['Total estimate',quote.total]);
  return <div className="quote-details"><div className="trip-places"><span><MapPin size={15}/>{quote.pickup}</span><span><MapPin size={15}/>{quote.destination}</span></div><p>{quote.distance_km} km · approximately {quote.duration_min} min · {quote.provider==='google' ? (quote.traffic_available?'Google traffic-aware estimate':'Google route estimate · traffic unavailable'):'simulated route'}</p><dl>{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{currency(value)}</dd></div>)}</dl>{Number(quote.surge_multiplier)>1 && <p className="surge-disclosure">Surge: {quote.surge_reason}. This quote is locked when confirmed.</p>}</div>;
}

function RideCard({ride,role,perform,disabled}) {
  const next=actions[ride.status];
  const [otp,setOtp]=useState('');
  useEffect(()=>setOtp(''),[ride.id,ride.status]);
  return <article className="journey-card" aria-label={`Ride ${ride.status}`}><div className="journey-card-head"><span className="status-badge">{labels[ride.status]}</span><small>#{ride.id.slice(0,8)}</small></div><QuoteDetails quote={ride.quote}/>{ride.driver && <p className="trip-person"><CarFront size={17}/> Driver: {ride.driver.name} · {ride.driver.user_code}</p>}{role === 'driver' && <p>Rider: {ride.rider.name}</p>}{ride.status === 'SEARCHING' && <><Countdown deadline={ride.expires_at}/><p>Round {ride.round_no} · searching within {ride.radius_m} m. Radius expands by 500 m every 30 seconds, up to the configured limit.</p>{role === 'rider' && <button className="button subtle full" disabled={disabled} onClick={()=>perform(`/rides/${ride.id}/cancel`)}>Cancel request</button>}</>}{role === 'driver' && ride.status === 'WAITING' && <label>Rider OTP<input aria-label="Rider OTP" type="text" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,''))} placeholder="Ask the rider for their six-digit OTP"/></label>}{role === 'driver' && next && <button className="button dark full" disabled={disabled || (next[0] === 'start' && otp.length !== 6)} onClick={()=>{if (next[0] !== 'complete' || window.confirm('Complete this trip and record the earnings allocation?')) perform(`/rides/${ride.id}/${next[0]}`,next[0] === 'start' ? {otp} : {});}}>{next[1]}<ArrowRight size={17}/></button>}{['driver','admin'].includes(role) && ride.settlement && <div className="settlement"><strong>Allocation recorded · not a payment</strong><span>Driver ({ride.settlement.driver_pct}%): {currency(ride.settlement.driver_amount)}</span><span>Company ({ride.settlement.company_pct}%): {currency(ride.settlement.company_amount)}</span></div>}</article>;
}

export default function RideWorkspace({role,user,token,view='overview'}) {
  const {data,error,refresh,connection}=useWorkspace(token);
  const trackingError=useDriverLocation({token,enabled:role === 'driver' && !!(data?.available || data?.active_ride),available:!!data?.available});
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[completed,setCompleted]=useState(null),[routePreview,setRoutePreview]=useState(null);
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
  return <main className="dashboard"><div className="page-heading"><span className="tag"><span/>YOUR CITY. YOUR DIRECTION.</span><h1>{titles[view] || 'Your workspace.'}</h1><p>{role === 'rider' ? 'Choose your places. Review your fare. Make your move.' : 'A clear view of every step along the way.'}</p></div><div className="notice simulator-notice"><span>{data?.route_provider==='google'?'Google routes · configurable fares · GPS matching · no payments':'Simulator routes · configurable development fares · no payments'}</span><span className="connection-status" role="status">{connection}</span><button aria-label="Refresh workspace" onClick={refresh}><RefreshCw size={16}/></button></div>{trackingError && <div className="form-error" role="alert">{trackingError}</div>}{(error || actionError) && <div className="form-error" role="alert">{error || actionError}{error && ' Actions are paused until the connection recovers. If your session expired, sign out and sign in again.'}</div>}{!data ? <div className="empty-panel"><p>{error ? 'Unable to load your workspace. Use refresh to retry.' : 'Loading your workspace…'}</p></div> : <>
    {view === 'overview' && role === 'rider' && <><section className="journey-card" aria-label="Your ride OTP"><h2>Your fixed ride OTP</h2><strong className="trip-otp">{data.trip_otp}</strong><p>This code stays the same for every ride. Share it with your driver only when you are at pickup and ready to start.</p></section>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <BookingPanel provider={data.route_provider} perform={perform} disabled={disabled} QuoteDetails={QuoteDetails} onPreview={setRoutePreview}/>}{!data.active_ride && data.rides[0] && <section className="recent-trip"><h2>Most recent journey</h2><RideCard ride={data.rides[0]} role={role} perform={perform} disabled={disabled}/></section>}</>}
    {view === 'overview' && role === 'driver' && <><div className="approval-banner"><CarFront size={26}/><div><h3>{data.user.status === 'pending' ? 'Your application is in review' : data.active_ride ? 'You have an active trip' : data.available ? 'You’re available for requests' : 'You’re offline'}</h3><p>{data.user.status === 'pending' ? 'An admin must approve your application before you can go available.' : 'Location is sent about every 30 seconds while available or on a trip. Keep this tab open; background updates are not guaranteed.'}</p></div>{data.user.status === 'active' && !data.active_ride && <button className={`button ${data.available ? 'subtle' : 'dark'}`} disabled={disabled || (!data.booking_enabled && !data.available)} onClick={async()=>{if(data.available){perform('/driver/availability',{available:false});return;}setBusy(true);setActionError('');try{const position=await getPosition();setBusy(false);await perform('/driver/availability',{available:true,...position});}catch(e){setActionError(e.message);setBusy(false);}}}>{data.available ? 'Go offline' : 'Go available'}</button>}</div><div className="location-freshness"><span className={data.location?.fresh ? 'fresh-dot' : 'stale-dot'}/>{data.location?.fresh ? 'Location fresh' : 'Location missing or stale — excluded from matching'}{data.location?.recorded_at && <small> · Last captured {new Date(data.location.recorded_at).toLocaleTimeString()} · accuracy {Math.round(data.location.accuracy_m)} m</small>}</div>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <><h2 className="section-title">Incoming requests</h2>{data.invitations.length ? <div className="journey-grid">{data.invitations.map(ride=><article className="journey-card" key={ride.id}><h2>New ride request</h2><Countdown deadline={ride.expires_at}/><QuoteDetails quote={ride.quote}/><div className="invitation-actions"><button className="button subtle" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/reject`)}>Reject</button><button className="button dark" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/accept`)}>Accept ride <ArrowRight size={17}/></button></div></article>)}</div> : <div className="empty-panel"><CarFront size={34}/><h2>{data.available ? 'Ready for your next move.' : 'Take the road when you’re ready.'}</h2><p>{data.available ? 'Keep this page open. New simulated requests will appear here.' : 'Go available with location permission. You can receive invitations in subsequent search rounds if you enter the expanding radius.'}</p></div>}{completed && <div className="recent-trip"><RideCard ride={completed} role={role} perform={perform} disabled={disabled}/></div>}</>}</>}
    {role==='admin' && view==='overview' && data.metrics && <div className="stat-grid">{[['Active rides',data.metrics.active_rides],['Searching',data.metrics.searching_rides],['Fresh available drivers',data.metrics.fresh_available_drivers],['Stale available drivers',data.metrics.stale_available_drivers],['Pending applications',data.metrics.pending_driver_applications],['Completed rides',data.metrics.completed_rides],['Driver allocations',currency(data.metrics.driver_allocations)],['Company allocations',currency(data.metrics.company_allocations)]].map(([label,value])=><article className="stat" key={label}><small>{label}</small><strong>{value}</strong>{label.includes('allocations') && <p>Recorded allocations · no transfer</p>}</article>)}</div>}
    {(view === 'drivers' || (view === 'overview' && role === 'admin')) && <section className="journey-card"><h2>Driver applications</h2><p>Approve only after reviewing the driver. Every approval records your reason in the audit log.</p>{data.drivers?.length ? data.drivers.map(driver=><div className="driver-row" key={driver.id}><div><strong>{driver.name}</strong><small>{driver.user_code} · {driver.status} · {driver.location?.fresh ? 'location fresh' : 'location stale/missing'}</small></div>{driver.status === 'pending' && <button className="button dark" disabled={disabled} onClick={()=>{const reason=window.prompt(`Approval reason for ${driver.name}`);if(reason)perform(`/admin/drivers/${driver.id}/approve`,{reason});}}>Approve driver</button>}</div>) : <p>No driver applications yet.</p>}</section>}
    {(view === 'history' || view === 'rides' || (role === 'admin' && view === 'overview')) && <section className="recent-trip"><h2>{role === 'admin' ? 'Recent rides' : 'Ride history'}</h2>{data.rides.length ? <div className="journey-grid">{data.rides.map(ride=><RideCard key={ride.id} ride={ride} role={role} perform={perform} disabled={disabled}/>)}</div> : <div className="empty-panel"><p>No journeys yet.</p></div>}</section>}
    {view === 'earnings' && role === 'driver' && <><section className="stat earnings-total"><small>Total allocated earnings</small><strong>{currency(data.allocated_earnings)}</strong><p>Each trip retains its recorded split. Allocations are not payments.</p></section><div className="journey-grid">{data.earnings.map(entry=><article className="journey-card" key={entry.ride_id}><small>Trip #{entry.ride_id.slice(0,8)}</small><h2>{currency(entry.driver_amount)}</h2><p>{entry.driver_pct}% of eligible fare {currency(entry.eligible_fare)} · {entry.status}</p></article>)}</div>{!data.earnings.length && <div className="empty-panel"><p>Your allocations will appear after completing your first trip.</p></div>}</>}
    {view==='overview' && data.active_ride?.quote.provider==='google' && <GoogleRouteMap polyline={routePreview?.id===data.active_ride.quote.id?routePreview.polyline:null} pickup={{lat:data.active_ride.quote.pickup_lat,lng:data.active_ride.quote.pickup_lng}} destination={{lat:data.active_ride.quote.destination_lat,lng:data.active_ride.quote.destination_lng}}/>}
  </>}</main>;
}
