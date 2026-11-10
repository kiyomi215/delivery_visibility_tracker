const el=id=>document.getElementById(id);
const phaseColors={'Decision':'#ECEEF2','Requirements':'#DDEAF8','Design':'#E8E0F5','Build':'#D9EFEE','Demo':'#F3E1F0','QA':'#FFF0CC','UAT':'#FBE3D4','Training':'#E5EFDA','Communication':'#F5E8D9','Deployment':'#DCE8FA','Post-deploy validation':'#E7F1EC'};
const statuses=['Planned','In Progress','Blocked','Done'];
const teams=['Roadrunners','CPQ','CRM','MyPODS','QA','Product'];
const phases=Object.keys(phaseColors);
const phaseChoices=phases.filter(phase=>phase!=='Demo');
const phaseOrder=new Map(phases.map((phase,index)=>[phase,index]));
let releases,current,activeEdit,showArchived=false;
const filterFields=['search','phase','status','team-filter'];
const filterKey=()=> 'delivery-visibility:filters:'+current.id;
function rememberFilters(){
 try{
  localStorage.setItem(filterKey(),JSON.stringify(Object.fromEntries(filterFields.map(id=>[id,el(id).value]))));
 }catch{}
}
function restoreFilters(){
 try{
  const filters=JSON.parse(localStorage.getItem(filterKey())??'{}');
  for(const id of filterFields){
   const input=el(id);
   input.value=typeof filters?.[id]==='string'?filters[id]:'';
   if(input.tagName==='SELECT'&&input.selectedIndex<0)input.value='';
  }
 }catch{}
}
function applyFilters(){
 rememberFilters();
 renderRows();
}
const teamNames=team=>(team??'').split(' / ').filter(Boolean);
const fields=[
 ['phase','Phase','select'],['item','Build item','text',250],['team','Team','select'],
 ['owner','Owner','text',100],['status','Status','select'],['start','Start Date','date'],
 ['end','End Date','date'],['ticket','Ticket number or link','text',2048],
 ['dependency','Dependency','textarea',1000],['description','Description / Notes','textarea',4000]
];
function editRow(row){
 activeEdit=row;
 const adding=row.revision===0&&row.id.includes(':new:');
 el('edit-title').textContent=adding?'Add line item':'Edit work item';
 el('archive-edit').hidden=adding;
 el('archive-edit').textContent=row.archived?'Restore':'Archive';
 const container=el('edit-fields');
 container.replaceChildren();
 el('edit-error').textContent='';
 const choices={phase:phaseChoices,status:statuses,team:teams};
 for(const [key,label,type,max] of fields){
  const wrapper=document.createElement('label');
  wrapper.textContent=label;
  const input=document.createElement(type==='select'||type==='textarea'?type:'input');
  input.name=key;
  if(input.tagName==='INPUT')input.type=type;
  if(max)input.maxLength=max;
  if(type==='select'){
   if(!choices[key].includes(row[key])){
    const currentValue=new Option(row[key]||'Choose a '+label.toLowerCase(),row[key]??'');
    currentValue.disabled=true;
    currentValue.hidden=true;
    input.add(currentValue);
   }
   for(const value of choices[key])input.add(new Option(value,value));
  }
  if(key==='item')input.required=true;
  input.value=key==='ticket'?(row.ticket?.url??row.ticket?.label??''):(row[key]??'');
  if(key==='description'||key==='dependency')wrapper.classList.add('wide');
  wrapper.append(input);
  container.append(wrapper);
 }
 el('editor').showModal();
 el('edit-form').elements.namedItem('item').focus();
}
async function saveEdit(event){
 event.preventDefault();
 const values=Object.fromEntries(new FormData(event.currentTarget));
 values.team??=activeEdit.team??'';
 values.phase??=activeEdit.phase;
 await saveItem(values);
}
async function saveItem(values){
 const row=activeEdit;
 const adding=row.revision===0&&row.id.includes(':new:');
 const submit=el('save-edit');
 const cancel=el('cancel-edit');
 const archive=el('archive-edit');
 submit.disabled=cancel.disabled=archive.disabled=true;
 el('edit-error').textContent='';
 try{
  const response=await fetch('/api/items/'+encodeURIComponent(row.id),{
   method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,revision:row.revision})
  });
  const saved=await response.json();
  if(!response.ok)throw new Error(saved.error||'Unable to save the work item.');
  if(adding)current.rows.push(saved);
  else Object.assign(row,saved);
  renderRows();
  el('editor').close();
  el('save-message').textContent=adding?'Line item added.':values.archived===true?'Item archived.':values.archived===false?'Item restored.':'Changes saved.';
 }catch(error){el('edit-error').textContent=error.message||'Unable to save the work item.';}
 finally{submit.disabled=cancel.disabled=archive.disabled=false;}
}
function selectOptions(id,label,values){
 el(id).replaceChildren(new Option(label,''),...Array.from(new Set(values),value=>new Option(value,value)));
 el(id).value='';
}
function renderRows(){
 const query=el('search').value.trim().toLowerCase();
 const phase=el('phase').value,status=el('status').value,team=el('team-filter').value;
 const available=current.rows.filter(row=>(row.archived===true)===showArchived);
 const rows=available.filter(row=>(!phase||row.phase===phase)&&(!status||row.status===status)&&(!team||teamNames(row.team).includes(team))&&(!query||[...Object.values(row),row.ticket?.label,row.ticket?.url].join(' ').toLowerCase().includes(query)));
 rows.sort((a,b)=>{
  const phaseDifference=(phaseOrder.get(a.phase)??phases.length)-(phaseOrder.get(b.phase)??phases.length);
  if(phaseDifference)return phaseDifference;
  if(!a.end||!b.end)return Number(!a.end)-Number(!b.end);
  return a.end.localeCompare(b.end);
 });
 const body=el('rows');
 body.replaceChildren();
 let previous;
 for(const row of rows){
  const {phase,item,team,owner,status,start,end,ticket,dependency,description}=row;
  const tr=body.insertRow();
  tr.style.setProperty('--phase-fill',phaseColors[phase]||'#fff');
  if(previous!==phase)tr.classList.add('divider');
  previous=phase;
  for(const [i,value] of [phase,item,team,owner,status,start,end,ticket?.label,dependency,description].entries()){
   const cell=tr.insertCell();
   cell.textContent=value||'—';
   if(!value)cell.classList.add('muted');
   if(i===4&&status==='Blocked')cell.classList.add('risk');
   if(i===4&&status==='Done')cell.classList.add('done');
   if(i===7&&ticket?.url&&['https://','http://'].some(prefix=>ticket.url.startsWith(prefix))){
    const a=document.createElement('a');a.href=ticket.url;a.textContent=ticket.label||'Open ticket';cell.replaceChildren(a);
   }
  }
  const button=document.createElement('button');
  button.type='button';button.textContent='Edit';button.setAttribute('aria-label','Edit '+item);
  button.addEventListener('click',()=>editRow(row));
  tr.insertCell().append(button);
 }
 if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=11;cell.textContent='No items match these filters.';}
 el('count').textContent=rows.length+' of '+available.length+(showArchived?' archived items':' items');
}
function showRelease(){
 current=releases.find(release=>'#'+release.id===location.hash)||releases.find(release=>release.id==='nov-30')||releases[0];
 for(const tab of el('releases').children){
  if(tab.hash==='#'+current.id)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
 }
 el('release-title').textContent=current.title;
 el('description').textContent=current.description;
 el('search').value='';
 selectOptions('phase','All phases',phaseChoices);
 selectOptions('status','All statuses',statuses);
 selectOptions('team-filter','All teams',teams);
 restoreFilters();
 renderRows();
}
fetch('/api/releases').then(response=>{
 if(!response.ok)throw new Error('Release data unavailable');
 return response.json();
}).then(data=>{
 releases=data;
 for(const release of releases){
  const tab=document.createElement('a');tab.className='tab';tab.href='#'+release.id;tab.textContent=release.tab;el('releases').append(tab);
 }
 window.addEventListener('hashchange',showRelease);
 el('search').addEventListener('input',applyFilters);
 for(const id of filterFields.slice(1))el(id).addEventListener('change',applyFilters);
 el('clear-filters').disabled=false;
 el('clear-filters').addEventListener('click',()=>{
  for(const id of filterFields)el(id).value='';
  applyFilters();
 });
 el('edit-form').addEventListener('submit',saveEdit);
 el('archive-edit').addEventListener('click',()=>saveItem({archived:!activeEdit.archived}));
 el('toggle-archived').addEventListener('click',()=>{
  showArchived=!showArchived;
  el('toggle-archived').textContent=showArchived?'Back to active items':'View archived';
  el('add-item').hidden=showArchived;
  renderRows();
 });
 el('add-item').disabled=false;
 el('add-item').addEventListener('click',()=>editRow({id:current.id+':new:'+crypto.randomUUID(),revision:0,phase:'Build',status:'Planned'}));
 el('cancel-edit').addEventListener('click',()=>el('editor').close());
 el('editor').addEventListener('cancel',event=>{if(el('save-edit').disabled)event.preventDefault();});
 showRelease();
}).catch(()=>{el('release-title').textContent='Release plan unavailable';el('description').textContent='Refresh the page to try again.';});
