export function googleNavigationUrl(ride) {
  if(ride.quote.provider!=='google')return null;
  const {destination_lat:lat,destination_lng:lng,destination}=ride.quote;
  const target=Number.isFinite(lat) && Number.isFinite(lng)?`${lat},${lng}`:destination;
  if(!target)return null;
  const params=new URLSearchParams({api:'1',destination:target,travelmode:'driving',dir_action:'navigate'});
  return `https://www.google.com/maps/dir/?${params}`;
}
