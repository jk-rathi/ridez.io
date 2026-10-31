// Run with Vite listening at RIDEZ_TEST_URL (default http://127.0.0.1:5189).
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:19.076,longitude:72.8777}});
  const page=await context.newPage();
  let role='rider',phase='IN_PROGRESS',mapCalls=0,origin='driver',failStart=true,navigated=null;
  const user=()=>({id:1,name:'Test User',user_code:'TEST',role,status:'active'});
  const ride=()=>({id:'trip-progress-test',status:phase,quote:{provider:'google',destination_lat:19.2,destination_lng:72.9,pickup_lat:19.076,pickup_lng:72.8777,pickup:'City centre',destination:'Airport',total:'137.66',distance_km:'8',duration_min:15},rider:{name:'Asha'},driver:{name:'Rohan',user_code:'DRV-TEST',vehicle:{registration:'MH01AB1234',color:'White',model:'Sedan'}}});
  await page.route('https://www.google.com/maps/dir/**',route=>{navigated=route.request().url();return route.fulfill({contentType:'text/html',body:'<h1>Google navigation request captured</h1>'});});
  await page.route('**/api/v1/**',route=>{
   const path=new URL(route.request().url()).pathname;let json;
   if(path==='/api/v1/auth/login' || path==='/api/v1/auth/refresh')json={access_token:'test-session',expires_at:Date.now()/1000+900,user:user()};
   else if(path==='/api/v1/workspace')json={user:user(),route_provider:'google',active_ride:ride(),rides:[],invitations:[],booking_enabled:true,location:{fresh:true},resume_available:true};
   else if(path==='/api/v1/rides/trip-progress-test/map'){
    assert.equal(route.request().headers().authorization,'Bearer test-session');mapCalls++;
    json={map:{origin_source:origin,distance_m:4200,duration_seconds:720,generated_at:new Date().toISOString(),driver_position:origin==='driver'?{lat:19.08,lng:72.88,recorded_at:new Date().toISOString()}:null}};
   }else if(path==='/api/v1/rides/trip-progress-test/start'){
    assert.equal(route.request().postDataJSON().otp,'123456');
    if(failStart)return route.fulfill({status:400,json:{error:'Incorrect rider OTP'}});
    phase='IN_PROGRESS';json={ride:ride()};
   }else json={};
   return route.fulfill({json});
  });
  await page.goto(process.env.RIDEZ_TEST_URL || 'http://127.0.0.1:5189');
  await page.waitForFunction(async()=>!!(await import('/src/authSession.js')).currentSession());
  async function mount(){await page.evaluate(async()=>{
   const {default:React}=await import('/node_modules/.vite/deps/react.js');
   const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
   const auth=await import('/src/authSession.js');const {default:Workspace}=await import('/src/RideWorkspace.jsx');
   const session=await auth.signIn({mobile:'test',password:'test'});
   window.testRoot?.unmount();const host=document.createElement('div');document.body.replaceChildren(host);window.testRoot=createRoot(host);
   window.testRoot.render(React.createElement(Workspace,{role:session.user.role,user:session.user,token:session.access_token}));
  });}
  await mount();
  const card=page.getByRole('region',{name:'Trip progress',exact:true});
  await card.getByText('12 min',{exact:true}).waitFor();await card.getByText('4.2 km',{exact:true}).waitFor();
  assert.equal(await card.getByText('Airport',{exact:true}).count(),1);
  assert.equal(mapCalls,1,'Card and map must share a single route fetch');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  origin='pickup';await page.getByRole('button',{name:'Refresh route',exact:true}).click();
  await card.getByText('Awaiting live route',{exact:true}).waitFor();
  assert.equal(await card.getByText('12 min',{exact:true}).count(),0,'Stale GPS must not present a live ETA');
  role='driver';phase='WAITING';await mount();
  await page.getByRole('textbox',{name:'OTP digit 1 of 6',exact:true}).fill('123456');
  await page.getByRole('button',{name:'Start trip',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Incorrect rider OTP'}).waitFor();assert.equal(navigated,null);
  failStart=false;await page.getByRole('button',{name:'Start trip',exact:true}).click();
  await page.getByRole('heading',{name:'Google navigation request captured'}).waitFor();
  const url=new URL(navigated);assert.equal(url.searchParams.get('destination'),'19.2,72.9');assert.equal(url.searchParams.get('dir_action'),'navigate');assert.equal(url.searchParams.get('travelmode'),'driving');
  console.log('PASS: mobile rider ETA/distance, shared route request, stale GPS fallback, rejected OTP stays put, successful start requests Google navigation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
