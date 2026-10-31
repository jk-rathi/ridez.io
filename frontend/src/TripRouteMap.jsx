import GoogleRouteMap from './GoogleRouteMap';

export default function TripRouteMap({ride,routeState}) {
  const phase=ride.status==='IN_PROGRESS'?'in_progress':'overview';
  const current=routeState;
  const data=current.data;
  const pickup={lat:ride.quote.pickup_lat,lng:ride.quote.pickup_lng};
  const destination={lat:ride.quote.destination_lat,lng:ride.quote.destination_lng};
  return <section className="trip-route" aria-label="Live Google trip map"><div className="trip-route-heading"><div><h2>{phase==='in_progress'?'Your trip on Google Maps':'Your Google road route'}</h2><p>{phase==='in_progress'?'The road route refreshes as the driver moves. Your confirmed fare stays the same.':'Your pickup and destination are connected using Google’s driving route.'}</p></div><button type="button" className="button subtle" disabled={current.loading} onClick={current.refresh}>Refresh route</button></div>
    {current.loading && <p className="map-route-status" role="status">Loading Google road route…</p>}
    {current.error && <p className="form-error" role="alert">{current.error} Trip controls remain available. Use Refresh route to try again.</p>}
    <GoogleRouteMap pickup={pickup} destination={destination} polyline={data?.polyline} driverPosition={data?.driver_position}/>
    {data && <div className="trip-map-summary"><span>{data.at_destination?'Driver location is at the destination':`${(data.distance_m/1000).toFixed(1)} km · about ${Math.ceil(data.duration_seconds/60)} min${phase==='in_progress' && data.origin_source==='driver'?' remaining':''}`}</span><span>{data.driver_position?`Driver location captured ${new Date(data.driver_position.recorded_at).toLocaleTimeString()}`:ride.driver?'Driver location unavailable or stale; showing the pickup-to-destination route.':'Driver position will appear after assignment.'}</span><small>Google route updated {new Date(data.generated_at).toLocaleTimeString()}. Location updates may be delayed.</small></div>}
  </section>;
}
