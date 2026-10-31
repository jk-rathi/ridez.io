import { useEffect, useState } from 'react';
import { api } from './api';

export default function useTripRoute(ride,token) {
  const phase=ride.status==='IN_PROGRESS'?'in_progress':'overview';
  const key=`${ride.id}:${phase}`;
  const [state,setState]=useState({}),[revision,setRevision]=useState(0);
  const current=state.key===key?state:{};
  useEffect(()=>{
    if(ride.quote.provider!=='google')return;
    const controller=new AbortController();let timer;
    setState({key,loading:true});
    async function load(){
      try{
        const result=await api(`/rides/${ride.id}/map`,{token,signal:controller.signal});
        if(!controller.signal.aborted)setState({key,data:result.map,loading:false});
      }catch(error){if(!controller.signal.aborted)setState({key,error:error.message,loading:false});}
      if(!controller.signal.aborted)timer=setTimeout(load,15000);
    }
    load();return ()=>{controller.abort();clearTimeout(timer);};
  },[key,token,revision]);
  return {...current,refresh:()=>setRevision(value=>value+1)};
}
