export default function TripProgressCard({ride,routeState}) {
  const data=routeState.data;
  const live=ride.quote.provider==='google' && !routeState.error && data?.origin_source==='driver' && Date.now()-Date.parse(data.generated_at)<90000;
  const minutes=live?Math.ceil(data.duration_seconds/60):null;
  const arrival=live?new Date(Date.parse(data.generated_at)+data.duration_seconds*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):null;
  return <section className="trip-progress-card" aria-label="Trip progress">
    <span className="tag">YOUR TRIP IS UNDERWAY</span><h2>On your way</h2>
    <div className="trip-progress-metrics"><div><span>Time to destination</span><strong>{live?(data.at_destination?'Arriving now':`${minutes} min`):'Updating…'}</strong></div><div><span>Distance remaining</span><strong>{live?`${(data.distance_m/1000).toFixed(1)} km`:'Updating…'}</strong></div></div>
    <dl><div><dt>Expected arrival</dt><dd>{arrival || 'Awaiting live route'}</dd></div><div><dt>Destination</dt><dd>{ride.quote.destination}</dd></div><div><dt>Confirmed fare</dt><dd>{new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(ride.quote.total))}</dd></div></dl>
    <p role="status">{live?'Estimated from the latest Google road route. Traffic and location updates may change arrival time.':ride.quote.provider==='google'?'Live estimate unavailable. Waiting for a fresh driver location and route.':'Simulated trip: live arrival and remaining distance are unavailable.'}</p>
  </section>;
}
