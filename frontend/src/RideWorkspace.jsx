import { useEffect, useState } from 'react';
import { ArrowRight, CarFront, Clock3, MapPin, RefreshCw } from 'lucide-react';
import { api } from './api';

const currency = amount => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(amount));
const labels = { SEARCHING:'Finding your driver', ASSIGNED:'Driver assigned', ARRIVING:'On the way to pickup', WAITING:'Waiting at pickup', IN_PROGRESS:'Trip in progress', COMPLETED:'Trip completed', CANCELLED:'Request cancelled', NO_DRIVER_FOUND:'No driver found' };
const actions = { ASSIGNED:['depart','Head to pickup'], ARRIVING:['arrive','I’ve arrived'], WAITING:['start','Start trip'], IN_PROGRESS:['complete','Complete trip'] };

function useWorkspace(token) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision,setRevision] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const result = await api('/workspace', {token, signal:controller.signal});
        if (!controller.signal.aborted) { setData(result); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    poll();
    return ()=>{controller.abort();clearTimeout(timer);};
  },[token,revision]);
  return { data,error,refresh:()=>setRevision(value=>value+1) };
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
  return <article className="journey-card" aria-label={`Ride ${ride.status}`}><div className="journey-card-head"><span className="status-badge">{labels[ride.status]}</span><small>#{ride.id.slice(0,8)}</small></div><QuoteDetails quote={ride.quote}/>{ride.driver && <p className="trip-person"><CarFront size={17}/> Driver: {ride.driver.name} · {ride.driver.user_code}</p>}{role === 'driver' && <p>Rider: {ride.rider.name}</p>}{ride.status === 'SEARCHING' && <><Countdown deadline={ride.expires_at}/><p>One simulated 30-second round. An approved driver must be available before booking.</p>{role === 'rider' && <button className="button subtle full" disabled={disabled} onClick={()=>perform(`/rides/${ride.id}/cancel`)}>Cancel request</button>}</>}{role === 'driver' && next && <button className="button dark full" disabled={disabled} onClick={()=>{if (next[0] !== 'complete' || window.confirm('Complete this trip and record the earnings allocation?')) perform(`/rides/${ride.id}/${next[0]}`);}}>{next[1]}<ArrowRight size={17}/></button>}{ride.settlement && <div className="settlement"><strong>Allocation recorded · not a payment</strong><span>Driver ({ride.settlement.driver_pct}%): {currency(ride.settlement.driver_amount)}</span><span>Company ({ride.settlement.company_pct}%): {currency(ride.settlement.company_amount)}</span></div>}</article>;
}

export default function RideWorkspace({role,user,token,view='overview'}) {
  const {data,error,refresh}=useWorkspace(token);
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
  return <main className="dashboard"><div className="page-heading"><span className="tag"><span/>YOUR CITY. YOUR DIRECTION.</span><h1>{titles[view] || 'Your workspace.'}</h1><p>{role === 'rider' ? 'Choose your places. Review your fare. Make your move.' : 'A clear view of every step along the way.'}</p></div><div className="notice simulator-notice"><span>Development simulator · sample distances and rates · no live GPS or payments</span><button aria-label="Refresh workspace" onClick={refresh}><RefreshCw size={16}/></button></div>{(error || actionError) && <div className="form-error" role="alert">{error || actionError}{error && ' Actions are paused until the connection recovers. If your session expired, sign out and sign in again.'}</div>}{!data ? <div className="empty-panel"><p>{error ? 'Unable to load your workspace. Use refresh to retry.' : 'Loading your workspace…'}</p></div> : <>
    {view === 'overview' && role === 'rider' && <>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <div className="journey-grid"><section className="journey-card"><h2>Let’s go places.</h2><p>Enter two places to generate a development estimate.</p><form onSubmit={async event=>{event.preventDefault();setQuote(null);const response=await perform('/fares/quotes',Object.fromEntries(new FormData(event.currentTarget)));if(response)setQuote(response.quote);}}><div className="location-fields"><label>Pickup location<input name="pickup" maxLength={160} required placeholder="City centre"/></label><label>Destination<input name="destination" maxLength={160} required placeholder="Riverside"/></label></div><button className="button dark full" disabled={disabled}>Get fare estimate <ArrowRight size={17}/></button></form></section>{quote ? <section className="journey-card"><h2>Your fare, upfront.</h2><QuoteDetails quote={quote}/><p>Quote expires at {new Date(quote.expires_at).toLocaleTimeString()}. Sample rates: ₹40 base + ₹12/km + ₹2/min. No surge, taxes or fees.</p><button className="button dark full" disabled={disabled} onClick={async()=>{const response=await perform('/rides',{quote_id:quote.id});if(response)setQuote(null);}}>Confirm simulated ride <ArrowRight size={17}/></button></section> : <section className="empty-panel"><MapPin size={38}/><h2>Every journey starts somewhere.</h2><p>Your itemized estimate will appear here. Addresses are labels in this simulator; they are not geocoded.</p></section>}</div>}{!data.active_ride && data.rides[0] && <section className="recent-trip"><h2>Most recent journey</h2><RideCard ride={data.rides[0]} role={role} perform={perform} disabled={disabled}/></section>}</>}
    {view === 'overview' && role === 'driver' && <><div className="approval-banner"><CarFront size={26}/><div><h3>{data.user.status === 'pending' ? 'Your application is in review' : data.active_ride ? 'You have an active trip' : data.available ? 'You’re available for requests' : 'You’re offline'}</h3><p>{data.user.status === 'pending' ? 'An admin must approve your application before you can go available.' : 'This milestone simulates availability. GPS tracking comes next.'}</p></div>{data.user.status === 'active' && !data.active_ride && <button className={`button ${data.available ? 'subtle' : 'dark'}`} disabled={disabled || !data.simulator} onClick={()=>perform('/driver/availability',{available:!data.available})}>{data.available ? 'Go offline' : 'Go available'}</button>}</div>{data.active_ride ? <RideCard ride={data.active_ride} role={role} perform={perform} disabled={disabled}/> : <><h2 className="section-title">Incoming requests</h2>{data.invitations.length ? <div className="journey-grid">{data.invitations.map(ride=><article className="journey-card" key={ride.id}><h2>New ride request</h2><Countdown deadline={ride.expires_at}/><QuoteDetails quote={ride.quote}/><div className="invitation-actions"><button className="button subtle" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/reject`)}>Reject</button><button className="button dark" disabled={disabled || Date.parse(ride.expires_at)<=Date.now()} onClick={()=>perform(`/rides/${ride.id}/accept`)}>Accept ride <ArrowRight size={17}/></button></div></article>)}</div> : <div className="empty-panel"><CarFront size={34}/><h2>{data.available ? 'Ready for your next move.' : 'Take the road when you’re ready.'}</h2><p>{data.available ? 'Keep this page open. New simulated requests will appear here.' : 'Go available before a rider confirms a booking to receive an invitation.'}</p></div>}{completed && <div className="recent-trip"><RideCard ride={completed} role={role} perform={perform} disabled={disabled}/></div>}</>}</>}
    {(view === 'drivers' || (view === 'overview' && role === 'admin')) && <section className="journey-card"><h2>Driver applications</h2><p>Approve only after reviewing the driver. Every approval records your reason in the audit log.</p>{data.drivers?.length ? data.drivers.map(driver=><div className="driver-row" key={driver.id}><div><strong>{driver.name}</strong><small>{driver.user_code} · {driver.status}</small></div>{driver.status === 'pending' && <button className="button dark" disabled={disabled} onClick={()=>{const reason=window.prompt(`Approval reason for ${driver.name}`);if(reason)perform(`/admin/drivers/${driver.id}/approve`,{reason});}}>Approve driver</button>}</div>) : <p>No driver applications yet.</p>}</section>}
    {(view === 'history' || view === 'rides' || (role === 'admin' && view === 'overview')) && <section className="recent-trip"><h2>{role === 'admin' ? 'Recent rides' : 'Ride history'}</h2>{data.rides.length ? <div className="journey-grid">{data.rides.map(ride=><RideCard key={ride.id} ride={ride} role={role} perform={perform} disabled={disabled}/>)}</div> : <div className="empty-panel"><p>No journeys yet.</p></div>}</section>}
    {view === 'earnings' && role === 'driver' && <><section className="stat earnings-total"><small>Total allocated earnings</small><strong>{currency(data.allocated_earnings)}</strong><p>85% driver / 15% company · allocations recorded, no money transferred.</p></section><div className="journey-grid">{data.earnings.map(entry=><article className="journey-card" key={entry.ride_id}><small>Trip #{entry.ride_id.slice(0,8)}</small><h2>{currency(entry.driver_amount)}</h2><p>{entry.driver_pct}% of eligible fare {currency(entry.eligible_fare)} · {entry.status}</p></article>)}</div>{!data.earnings.length && <div className="empty-panel"><p>Your allocations will appear after completing your first trip.</p></div>}</>}
  </>}</main>;
}
