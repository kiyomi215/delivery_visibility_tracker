const rows=new Map();
const releaseIds=new Set(seed.map(release=>release.id));
function addedRelease(id){
 const match=id.match(/^([a-z0-9-]+):new:([0-9a-f-]{36})$/);
 return match&&releaseIds.has(match[1])?match[1]:null;
}
for(const release of seed){
 release.rows.forEach((row,index)=>{
  row.id=release.id+':'+index;
  row.revision=0;
  rows.set(row.id,row);
 });
}
const phases=['Decision','Requirements','Design','Build','Demo','QA','UAT','Training','Communication','Deployment','Post-deploy validation'];
const statuses=['Planned','In Progress','Blocked','Done'];
const teams=new Set([...rows.values()].flatMap(row=>[row.team,...(row.team??'').split(' / ')]).filter(Boolean));
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const sessionName='__Host-dv_session';
const sessionSeconds=12*60*60;
const encoder=new TextEncoder();
function loginPage(message='',status=200){
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock the release tracker</title><style>body{margin:0;background:#f2f6f8;color:#193447;font:16px system-ui}main{max-width:28rem;margin:12vh auto;padding:2rem;background:white;border:1px solid #c7d7df;border-radius:.65rem}label,input,button{display:block}input,button{font:inherit;margin:.5rem 0 1rem;padding:.55rem .7rem;border:1px solid #7891a3;border-radius:.35rem}button{color:white;background:#22586a}p[role=alert]{color:#943c21}</style><main><h1>Delivery Visibility Release Plan</h1><p>Enter the shared password to view and edit the tracker.</p><form action="/unlock" method="post"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" maxlength="256" required autofocus><button>Unlock tracker</button></form><p role="alert">${message}</p></main></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
}
async function sessionKey(env){
 return crypto.subtle.importKey('raw',encoder.encode(env.TRACKER_SESSION_KEY+':'+env.TRACKER_PASSWORD),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function hasSession(request,env){
 const cookie=(request.headers.get('Cookie')??'').split(';').map(value=>value.trim()).find(value=>value.startsWith(sessionName+'='));
 const token=cookie?.slice(sessionName.length+1).match(/^(\d{10})\.([A-Za-z0-9+/]{43}=)$/);
 if(!token||Number(token[1])<=Date.now()/1000)return false;
 const signature=Uint8Array.from(atob(token[2]),char=>char.charCodeAt(0));
 return crypto.subtle.verify('HMAC',await sessionKey(env),signature,encoder.encode(token[1]));
}
async function unlock(request,env){
 if(request.headers.get('Sec-Fetch-Site')==='cross-site')return loginPage('Open the tracker link directly and try again.',403);
 const window=Math.floor(Date.now()/600000);
 const ip=request.headers.get('CF-Connecting-IP')??'unknown';
 const key=await sessionKey(env);
 const ipSignature=await crypto.subtle.sign('HMAC',key,encoder.encode(ip));
 const client=btoa(String.fromCharCode(...new Uint8Array(ipSignature)));
 const [_,attempt]=await env.DB.batch([
  env.DB.prepare('DELETE FROM tracker_login_attempts WHERE window < ?').bind(window),
  env.DB.prepare('INSERT INTO tracker_login_attempts(client,window,attempts) VALUES(?,?,1) ON CONFLICT(client) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(client,window)
 ]);
 if(attempt.results[0].attempts>12)return loginPage('Too many attempts. Try again in a few minutes.',429);
 const form=await request.formData().catch(()=>null);
 const password=form?.get('password');
 const expected=await crypto.subtle.sign('HMAC',key,encoder.encode(env.TRACKER_PASSWORD));
 if(typeof password!=='string'||password.length>256||!await crypto.subtle.verify('HMAC',key,expected,encoder.encode(password)))return loginPage('That password did not match.',401);
 const expires=String(Math.floor(Date.now()/1000)+sessionSeconds);
 const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(expires));
 const token=expires+'.'+btoa(String.fromCharCode(...new Uint8Array(signature)));
 return new Response(null,{status:303,headers:{Location:'/','Cache-Control':'no-store','Set-Cookie':sessionName+'='+token+'; Path=/; Max-Age='+sessionSeconds+'; Secure; HttpOnly; SameSite=Lax'}});
}
function validDate(value){
 if(value==='')return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value);
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
async function update(request,db,id){
 const seedRow=rows.get(id);
 if(!seedRow&&!addedRelease(id))return json({error:'Work item not found.'},404);
 const input=await request.json().catch(()=>null);
 if(!input||!Number.isInteger(input.revision)||input.revision<0)return json({error:'Invalid edit.'},400);
 const saved=await db.prepare('SELECT payload FROM release_edits WHERE item_id=?').bind(id).first();
 const base=saved?JSON.parse(saved.payload):seedRow;
 if(input.archived!==undefined){
  if(typeof input.archived!=='boolean')return json({error:'Invalid archive action.'},400);
  if(!base)return json({error:'Work item not found.'},404);
  return saveRow(db,id,input.revision,{...base,archived:input.archived});
 }
 const limits={phase:40,item:250,team:100,owner:100,status:20,start:10,end:10,ticket:2048,dependency:1000,description:4000};
 const edit={};
 for(const [key,max] of Object.entries(limits)){
  if(typeof input[key]!=='string'||input[key].length>max)return json({error:'Check the length and format of the fields.'},400);
  edit[key]=input[key].trim();
 }
 if(!edit.item||!phases.includes(edit.phase)||!statuses.includes(edit.status)||(edit.team&&!teams.has(edit.team)))return json({error:'Enter a build item and choose valid dropdown values.'},400);
 if(!validDate(edit.start)||!validDate(edit.end)||(edit.start&&edit.end&&edit.end<edit.start))return json({error:'End Date must be on or after Start Date.'},400);
 const ticket=edit.ticket;
 const url=/^https?:\/\//i.test(ticket)?URL.parse(ticket):null;
 if(!url&&ticket.includes('://'))return json({error:'Enter a ticket number or a valid HTTP or HTTPS link.'},400);
 edit.ticket=ticket?{label:url?(ticket===base?.ticket?.url?base.ticket.label:url.pathname.split('/').filter(Boolean).at(-1)||'Open ticket'):ticket,url:url?.href??null}:null;
 return saveRow(db,id,input.revision,{...edit,archived:base?.archived===true});
}
async function saveRow(db,id,expectedRevision,row){
 const revision=expectedRevision+1;
 const payload=JSON.stringify({...row,id,revision});
 const result=expectedRevision===0
  ?await db.prepare('INSERT INTO release_edits(item_id,revision,payload) VALUES(?,?,?) ON CONFLICT(item_id) DO NOTHING').bind(id,revision,payload).run()
  :await db.prepare('UPDATE release_edits SET revision=?,payload=? WHERE item_id=? AND revision=?').bind(revision,payload,id,expectedRevision).run();
 if(!result.meta.changes)return json({error:'This item was edited elsewhere. Refresh before editing it again.'},409);
 return json(JSON.parse(payload));
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(!env.TRACKER_PASSWORD||!env.TRACKER_SESSION_KEY)return new Response('Tracker access is temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});
   if(url.pathname==='/unlock'&&request.method==='POST')return await unlock(request,env);
   if(!await hasSession(request,env)){
    if(url.pathname.startsWith('/api/'))return json({error:'Unlock the tracker before viewing or editing items.'},401);
    return loginPage();
   }
   if(url.pathname==='/'&&request.method==='GET')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
   if(url.pathname==='/app.js'&&request.method==='GET')return new Response(script,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
   if(url.pathname==='/api/releases'&&request.method==='GET'){
    const {results}=await env.DB.prepare('SELECT item_id,payload FROM release_edits ORDER BY rowid').all();
    const edits=new Map(results.map(row=>[row.item_id,JSON.parse(row.payload)]));
    const additions=new Map(seed.map(release=>[release.id,[]]));
    for(const [id,row] of edits){
     const release=addedRelease(id);
     if(release)additions.get(release).push(row);
    }
    return json(seed.map(release=>({...release,rows:[...release.rows.map(row=>edits.get(row.id)??row),...additions.get(release.id)]})));
   }
   const match=url.pathname.match(/^\/api\/items\/([^/]+)$/);
   if(match&&request.method==='PUT'){
    if(request.headers.get('sec-fetch-site')!=='same-origin'||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Open the tracker to save changes.'},403);
    return await update(request,env.DB,decodeURIComponent(match[1]));
   }
   return new Response('Not found',{status:404});
  }catch(error){console.error(error.message);return json({error:'The tracker could not access saved data. Try again.'},500);}
 }
};
