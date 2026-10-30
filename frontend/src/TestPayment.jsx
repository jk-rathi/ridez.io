import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from './api';

const warning='TEST PAYMENT — no money transferred';
const money=value=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(value));

export function TestPaymentCard({ride,role}) {
  const [result,setResult]=useState(null),[qr,setQr]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const payment=ride.test_payment || result?.payment;
  async function generate() {
    setBusy(true);setError('');
    try {
      const data=await api(`/rides/${ride.id}/test-payment`,{method:'POST',body:'{}'});
      const url=new URL(data.path,window.location.origin).href;
      setQr(await QRCode.toDataURL(url,{width:256,margin:4,errorCorrectionLevel:'M'}));setResult({...data,url});
    } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  if(ride.status!=='COMPLETED' || (!ride.test_payments_enabled && !payment))return null;
  return <section className="test-payment"><strong>{warning}</strong><h3>QR payment testing</h3><p>Test status: <b>{payment?.status || 'NOT STARTED'}</b> · {money(payment?.amount || ride.quote.total)}</p>{role==='rider' && ride.test_payments_enabled && payment?.status!=='SUCCESS' && <><button className="button dark" onClick={generate} disabled={busy}>{busy?'Generating…':result?'Refresh test QR':'Pay by QR (test)'}</button>{qr && <div className="test-qr"><img src={qr} width="256" height="256" alt="Scan to simulate payment. No money is transferred."/><a href={result.url} target="_blank" rel="noreferrer">Open test payment page</a><p>Scan with your phone camera. Expires after 15 minutes. Choose an outcome on the test page.</p></div>}</>}{payment?.status==='SUCCESS' && <p>Simulation successful. This is not a payment receipt.</p>}{error && <p role="alert" className="form-error">{error}</p>}</section>;
}

export default function TestPaymentPage() {
  const {token}=useParams();
  const [payment,setPayment]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;api(`/test-payments/${encodeURIComponent(token)}`).then(data=>{if(active)setPayment(data.payment);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[token]);
  async function simulate(status) {
    setBusy(true);setError('');
    try{const data=await api(`/test-payments/${encodeURIComponent(token)}`,{method:'POST',body:JSON.stringify({status})});setPayment(data.payment);}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <main className="test-payment-page"><section className="journey-card test-payment"><strong>{warning}</strong><h1>Simulate QR payment</h1><p>This page tests ridez.io payment screens. It does not connect to a bank or UPI app.</p>{payment && <><h2>{money(payment.amount)}</h2><p role="status">Test status: <b>{payment.status}</b></p>{payment.status!=='SUCCESS'?<div className="test-payment-actions">{['SUCCESS','FAILED','PENDING'].map(status=><button key={status} className="button dark" disabled={busy} onClick={()=>simulate(status)}>Simulate {status.toLowerCase()}</button>)}</div>:<p>Simulation complete. Further scans keep this successful test result.</p>}</>}{error && <p className="form-error" role="alert">{error}</p>}<p>You can return to the ride workspace to view the updated test status.</p></section></main>;
}
