// Smart Study Planner - Single-file app
// Data model: tasks array saved under 'ssplanner_tasks' in localStorage
(()=>{
  const LS_KEY = 'ssplanner_tasks';
  let tasks = [];
  let reminderTimeouts = {}; // store timeouts for reminders while page is open

  // Helpers
  const qs = s=>document.querySelector(s);
  const qsa = s=>Array.from(document.querySelectorAll(s));

  function uid(){return 't_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7)}

  function load(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      tasks = raw?JSON.parse(raw):[];
    }catch(e){tasks=[]}
  }
  function save(){localStorage.setItem(LS_KEY, JSON.stringify(tasks));updateUI();}

  function addTask(t){tasks.push(t); save(); scheduleReminder(t);}
  function updateTask(id, patch){ const i=tasks.findIndex(x=>x.id===id); if(i>-1){tasks[i]=Object.assign({},tasks[i],patch); save();}}
  function deleteTask(id){tasks=tasks.filter(x=>x.id!==id); save();}

  // UI render
  function updateUI(){
    // stats
    const total = tasks.length; const completed = tasks.filter(t=>t.done).length;
    qs('#stats').textContent = `Tasks: ${total} • Completed: ${completed}`;

    // progress
    const pct = total?Math.round((completed/total)*100):0;
    qs('#progressPct').textContent = pct+'%'; qs('#progressBar').style.width = pct+'%';

    // list
    renderList(); renderTimeline();
  }

  function renderList(){
    const container = qs('#list'); container.innerHTML='';
    const filter = qs('#filterStatus').value; const search = qs('#search').value.trim().toLowerCase(); const sortBy = qs('#sortBy').value;
    let out = tasks.slice();
    if(filter==='active') out = out.filter(t=>!t.done);
    if(filter==='completed') out = out.filter(t=>t.done);
    if(search) out = out.filter(t=> (t.title||'').toLowerCase().includes(search) || (t.subject||'').toLowerCase().includes(search));

    // sort
    if(sortBy==='date_asc') out.sort((a,b)=> (a.datetime||'').localeCompare(b.datetime||''));
    else if(sortBy==='date_desc') out.sort((a,b)=> (b.datetime||'').localeCompare(a.datetime||''));
    else if(sortBy==='priority'){
      const order = {high:0, medium:1, low:2}; out.sort((a,b)=> (order[a.priority]||2)-(order[b.priority]||2));
    }

    if(out.length===0){container.innerHTML='<div class="empty">No tasks yet — add one on the left.</div>'; return}

    out.forEach(t=>{
      const el = document.createElement('div'); el.className='task-card';
      const left = document.createElement('div'); left.className='task-left';
      const title = document.createElement('h4'); title.className='task-title'; title.textContent = t.title + (t.done? ' ✅':'');
      left.appendChild(title);
      const meta = document.createElement('div'); meta.className='task-meta';
      meta.textContent = `${t.subject||'No subject'} • ${formatDT(t.datetime)} • ${t.duration? t.duration+' min':''}`;
      left.appendChild(meta);
      if(t.notes){ const notes = document.createElement('div'); notes.className='task-meta'; notes.style.marginTop='6px'; notes.textContent = t.notes; left.appendChild(notes)}

      const tags = document.createElement('div'); tags.className='tags';
      const ptag = document.createElement('span'); ptag.className='tag'; ptag.textContent = t.priority || 'medium'; tags.appendChild(ptag);
      if(t.remind){ const r = document.createElement('span'); r.className='tag'; r.textContent='reminder'; tags.appendChild(r)}
      left.appendChild(tags);

      const actions = document.createElement('div'); actions.className='actions';
      const doneBtn = document.createElement('button'); doneBtn.className='small-btn'; doneBtn.textContent = t.done? 'Mark Active':'Mark Done'; doneBtn.onclick = ()=>{ updateTask(t.id, {done:!t.done}); };
      const editBtn = document.createElement('button'); editBtn.className='small-btn'; editBtn.textContent='Edit'; editBtn.onclick = ()=>{ populateForm(t); window.scrollTo({top:0,behavior:'smooth'}); };
      const delBtn = document.createElement('button'); delBtn.className='small-btn'; delBtn.textContent='Delete'; delBtn.onclick = ()=>{ if(confirm('Delete this task?')){ cancelReminder(t.id); deleteTask(t.id); }};
      actions.appendChild(doneBtn); actions.appendChild(editBtn); actions.appendChild(delBtn);

      el.appendChild(left); el.appendChild(actions);
      container.appendChild(el);
    })
  }

  function renderTimeline(){
    const tl = qs('#timelineList'); tl.innerHTML='';
    const upcoming = tasks.filter(t=>t.datetime && !t.done).slice().sort((a,b)=> (a.datetime||'').localeCompare(b.datetime||'')).slice(0,10);
    if(upcoming.length===0){ tl.innerHTML='<div class="empty">No upcoming scheduled tasks.</div>'; return }
    upcoming.forEach(t=>{
      const item = document.createElement('div'); item.className='timeline-item';
      const dot = document.createElement('div'); dot.className='dot';
      dot.style.background = t.priority==='high'? 'var(--danger)': (t.priority==='medium'? 'var(--accent2)':'var(--muted)');
      const txt = document.createElement('div'); txt.innerHTML = `<strong>${t.title}</strong><div style="font-size:13px;color:var(--muted)">${formatDT(t.datetime)} • ${t.subject||''}</div>`;
      item.appendChild(dot); item.appendChild(txt);
      tl.appendChild(item);
    })
  }

  function formatDT(dt){ if(!dt) return 'No date'; const d = new Date(dt); if(isNaN(d)) return 'Invalid'; return d.toLocaleString(); }

  // Form
  function resetForm(){ qs('#taskId').value=''; qs('#taskForm').reset(); }
  function populateForm(t){ qs('#taskId').value = t.id; qs('#title').value=t.title; qs('#subject').value=t.subject||''; if(t.datetime){ const d = new Date(t.datetime); qs('#date').value = d.toISOString().slice(0,10); qs('#time').value = d.toTimeString().slice(0,5);} else {qs('#date').value=''; qs('#time').value=''}; qs('#duration').value = t.duration||''; qs('#priority').value = t.priority||'medium'; qs('#notes').value = t.notes||''; qs('#remind').checked = !!t.remind; }

  // Reminders (only while page is open): best-effort using Notification API + setTimeout
  async function requestNotificationPermission(){ if(!('Notification' in window)) return false; if(Notification.permission==='granted') return true; if(Notification.permission==='denied') return false; const p = await Notification.requestPermission(); return p==='granted'; }

  function scheduleAllReminders(){ cancelAllReminders(); tasks.forEach(scheduleReminder); }
  function scheduleReminder(t){ try{ if(!t.remind || !t.datetime || t.done) return; const when = new Date(t.datetime).getTime(); const now = Date.now(); const diff = when - now; if(diff<=0) return; // due in past
      // only schedule reminders up to 7 days away to avoid piling timeouts
      if(diff>1000*60*60*24*30) return; // ignore >30 days
      cancelReminder(t.id);
      reminderTimeouts[t.id] = setTimeout(()=>{ showNotification(t); }, diff);
  }catch(e){}
  }
  function cancelReminder(id){ if(reminderTimeouts[id]){ clearTimeout(reminderTimeouts[id]); delete reminderTimeouts[id]; } }
  function cancelAllReminders(){ Object.keys(reminderTimeouts).forEach(k=>{ clearTimeout(reminderTimeouts[k]); }); reminderTimeouts={}; }

  function showNotification(t){ if('Notification' in window && Notification.permission==='granted'){
    const n = new Notification('Study Reminder: '+t.title, {body: (t.subject? t.subject+' • ':'') + (t.duration? t.duration+' min • ':'') + (t.notes? t.notes.slice(0,80):''),silent:false});
    n.onclick = ()=> window.focus();
  } else {
    // fallback: small in-page alert
    alert('Reminder: '+t.title + (t.subject? ' • '+t.subject:''));
  }}

  // Import / Export
  function exportJSON(){ const data = JSON.stringify(tasks, null, 2); const blob = new Blob([data],{type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download = 'ssplanner_export_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); URL.revokeObjectURL(url); }
  function importJSON(file){ const reader = new FileReader(); reader.onload = e=>{ try{ const arr = JSON.parse(e.target.result); if(Array.isArray(arr)){ // merge carefully
        arr.forEach(it=>{ if(!it.id) it.id = uid(); tasks.push(it); }); save(); alert('Imported '+arr.length+' items.'); } else alert('File does not contain an array of tasks'); }catch(err){ alert('Invalid file'); }}; reader.readAsText(file);
  }

  // sample tasks helper
  function addSample(){ const now = new Date(); const t1 = {id:uid(), title:'Math — Practice problems', subject:'Math', datetime:new Date(now.getTime()+1000*60*60).toISOString(), duration:60, priority:'high', notes:'Chapters 3 & 4', remind:true, done:false};
    const t2 = {id:uid(), title:'History — Read notes', subject:'History', datetime:new Date(now.getTime()+1000*60*60*4).toISOString(), duration:30, priority:'medium', notes:'World War II summary', remind:false, done:false};
    const t3 = {id:uid(), title:'CS — Project work', subject:'Computer Science', datetime:new Date(now.getTime()+1000*60*60*24).toISOString(), duration:120, priority:'medium', notes:'Finish feature X', remind:true, done:false};
    [t1,t2,t3].forEach(addTask);
  }

  // Events
  qs('#taskForm').addEventListener('submit', async ev=>{
    ev.preventDefault();
    const id = qs('#taskId').value || uid();
    const title = qs('#title').value.trim(); if(!title) return alert('Please enter a title');
    const subject = qs('#subject').value.trim();
    const date = qs('#date').value; const time = qs('#time').value; let datetime=''; if(date){ datetime = new Date(date + 'T' + (time||'00:00')).toISOString(); }
    const duration = qs('#duration').value? parseInt(qs('#duration').value):'';
    const priority = qs('#priority').value; const notes = qs('#notes').value; const remind = qs('#remind').checked;
    const existing = tasks.find(x=>x.id===id);
    const payload = {id,title,subject,datetime,duration,priority,notes,remind,done: existing? existing.done:false};
    if(existing){ updateTask(id, payload); } else { addTask(payload); }
    resetForm();
  });

  qs('#resetBtn').addEventListener('click', ev=>{ resetForm(); });
  qs('#search').addEventListener('input', ()=> updateUI());
  qs('#filterStatus').addEventListener('change', ()=> updateUI());
  qs('#sortBy').addEventListener('change', ()=> updateUI());
  qs('#addSample').addEventListener('click', ()=>{ addSample(); });

  qs('#exportBtn').addEventListener('click', ()=> exportJSON());
  qs('#importBtn').addEventListener('click', ()=> qs('#importFile').click());
  qs('#importFile').addEventListener('change', (e)=>{ if(e.target.files && e.target.files[0]) importJSON(e.target.files[0]); e.target.value=''; });

  // keyboard quick add: press 'n' to focus title
  document.addEventListener('keydown', (e)=>{ if(e.key==='n' && !e.metaKey && !e.ctrlKey){ qs('#title').focus(); }});

  // init
  load(); updateUI();
  // ask for notification permission if any tasks have reminders
  (async ()=>{
    const anyRemind = tasks.some(t=>t.remind && !t.done && t.datetime);
    if(anyRemind) await requestNotificationPermission();
    scheduleAllReminders();
  })();

  // expose some functions to console for debugging
  window.__ssplanner = {tasks, save, load, addSample, exportJSON};

})();