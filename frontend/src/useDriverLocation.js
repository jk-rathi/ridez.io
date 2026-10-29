import { useEffect, useState } from 'react';
import { api } from './api';

export function getPosition() {
  return new Promise((resolve, reject)=>{
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error('Location requires HTTPS or localhost and a supported browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(position=>resolve({
      latitude:position.coords.latitude,
      longitude:position.coords.longitude,
      accuracy_m:position.coords.accuracy,
      recorded_at:new Date(position.timestamp).toISOString(),
    }), error=>reject(new Error(error.code === 1 ? 'Location permission was denied. Enable it in your browser settings.' : 'Unable to get a fresh location. Check location services and try again.')),
    {enableHighAccuracy:true, maximumAge:0, timeout:15000});
  });
}

export function useDriverLocation({token,enabled,available}) {
  const [error,setError]=useState('');
  useEffect(()=>{
    if (!enabled) return;
    let stopped=false, timer, permission;
    const controller=new AbortController();
    async function send() {
      try {
        const position=await getPosition();
        if (stopped) return;
        await api('/driver/location',{token,method:'PUT',body:JSON.stringify(position),signal:controller.signal});
        if (!stopped) setError('');
      } catch(e) {if(!stopped)setError(e.message);}
      if(!stopped)timer=setTimeout(send,30000);
    }
    async function permissionChanged() {
      if(stopped || permission.state !== 'denied')return;
      setError('Location permission was revoked. New matching is paused; an active trip is preserved.');
      if(available) {
        try {await api('/driver/availability',{token,method:'POST',body:JSON.stringify({available:false}),signal:controller.signal});}
        catch(e){if(!stopped)setError(e.message);}
      }
    }
    navigator.permissions?.query({name:'geolocation'}).then(result=>{
      if(stopped)return;
      permission=result;
      permission.addEventListener('change',permissionChanged);
    }).catch(()=>{});
    send();
    return ()=>{stopped=true;clearTimeout(timer);controller.abort();permission?.removeEventListener('change',permissionChanged);};
  },[token,enabled,available]);
  return error;
}
