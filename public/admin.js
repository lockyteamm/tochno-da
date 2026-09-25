const $=(selector,root=document)=>root.querySelector(selector);
const MAX_FILE=80*1024*1024;
// Windows часто отдаёт пустой type для .mov и .heic, поэтому решаем по расширению: сервер всё равно проверяет сигнатуру байтов.
const isVideoFile=file=>/\.(mp4|mov|webm)$/i.test(file.name)||file.type.startsWith('video');
const isHeicFile=file=>/\.heic$/i.test(file.name)||/image\/hei/i.test(file.type);
const isAllowedFile=file=>isVideoFile(file)||isHeicFile(file)||/\.(jpe?g|png|webp|gif)$/i.test(file.name)||file.type.startsWith('image');
const symbols={plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="m6 6 12 12M6 18 18 6"/>','arrow-up-right':'<path d="M7 17 17 7M6 7h11v11"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',logout:'<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',hide:'<path d="m3 3 18 18M10 5c7-1 12 7 12 7a19 19 0 0 1-4 4M6 6a20 20 0 0 0-4 6s3 7 10 7c2 0 4-1 5-2"/>',edit:'<path d="m15 4 5 5M3 21l5-1L21 7l-4-4L4 16l-1 5Z"/>',play:'<path d="m8 4 12 8-12 8Z"/>',chart:'<path d="M5 20V10M12 20V4M19 20v-7"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',grip:'<path d="M9 4v1m6-1v1M9 11v1m6-1v1M9 18v1m6-1v1"/>',flower:'<path d="M12 7C6-4-2 8 7 12c-11 6 1 14 5 5 6 11 14-1 5-5 11-6-1-14-5-5Z"/><circle cx="12" cy="12" r="3"/>',restore:'<path d="M4 4v6h6M4 10a8 8 0 1 1 0 6"/>',chat:'<path d="M21 11a9 9 0 0 1-13 8L3 21l1-6A9 9 0 1 1 21 11Z"/>',check:'<path d="m5 12 4 4L20 5"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/>',up:'<path d="M12 20V4m-6 6 6-6 6 6"/>',down:'<path d="M12 4v16m-6-6 6 6 6-6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 17 5-5 4 4 4-7 5 7"/><circle cx="8" cy="8" r="1"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]||''}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.outerHTML=icon(el.dataset.icon));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let items=[],page='stories',status='all',search='',type='all',busy=false,coverBusy=false,editing=null,file=null,fileURL=null,covers=[],coverPick=null,editorDirty=false,editorSaving=false,settingsDirty=false,dragged=null,toastTimer,confirmResolve=null,settingsVersion=0;
const editor=$('#editor-dialog'),confirmDialog=$('#confirm-dialog'),preview=$('#preview-dialog');
const activeItems=()=>items.filter(s=>!s.deletedAt);
const canReorder=()=>page==='stories'&&status==='all'&&!search&&type==='all'&&!busy;
function toast(text){$('#admin-toast').textContent=text;$('#admin-toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#admin-toast').classList.remove('visible'),3200);}
function show(dialog){dialog.returnFocus=document.activeElement;dialog.showModal();document.body.classList.add('modal-open');}
function closed(e){document.body.classList.toggle('modal-open',!!$('dialog[open]'));if(e.target.returnFocus?.isConnected)e.target.returnFocus.focus();}
for(const dialog of [editor,confirmDialog,preview])dialog.addEventListener('close',closed);
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const data=await response.json();
  if(response.status===401){showAuth();throw Error('Сессия завершилась. Войдите в аккаунт ещё раз.');}
  if(!response.ok)throw Error(data.error||'Не удалось выполнить действие. Попробуйте ещё раз.');
  return data;
}
function showAuth(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('#dashboard').hidden=true;$('#auth-screen').hidden=false;$('#initial-loading').hidden=true;$('#auth-password').value='';}
async function boot(){
  try{const session=await api('/api/session');if(!session.admin){showAuth();return;}$('#auth-screen').hidden=true;$('#dashboard').hidden=false;await refresh();await loadSettings();}
  catch(error){if($('#dashboard').hidden){showAuth();$('#auth-error').textContent=error.message;}else{$('#admin-error').textContent=error.message;$('#retry-admin').hidden=false;}}
  finally{$('#initial-loading').hidden=true;}
}
$('#auth-form').onsubmit=async e=>{
  e.preventDefault();const button=$('button[type=submit]',e.target);button.disabled=true;$('#auth-error').textContent='';
  try{await api('/api/login',{method:'POST',body:JSON.stringify({login:$('#auth-login').value,password:$('#auth-password').value})});$('#auth-password').value='';await boot();}
  catch(error){$('#auth-error').textContent=error.message;}finally{button.disabled=false;}
};
async function refresh(){items=await api('/api/admin/stories');render();$('#admin-error').textContent='';$('#retry-admin').hidden=true;}
$('#retry-admin').onclick=()=>boot();
function render(){
  const active=activeItems(),deleted=items.filter(s=>s.deletedAt);
  $('#stat-published').textContent=active.filter(s=>s.status==='published').length;
  $('#stat-drafts').textContent=active.filter(s=>s.status==='draft').length;
  $('#stat-videos').textContent=active.filter(s=>s.type==='video').length;
  $('#stat-views').textContent=active.reduce((sum,s)=>sum+s.views,0).toLocaleString('ru');
  $('#nav-count').textContent=active.length;$('#trash-count').textContent=deleted.length||'';
  const filtered=active.filter(s=>(status==='all'||s.status===status)&&(type==='all'||s.type===type)&&(!search||`${s.title} ${s.caption}`.toLocaleLowerCase('ru').includes(search)));
  $('#admin-grid').innerHTML=filtered.map(s=>card(s,active.indexOf(s),active.length)).join('');
  $('#trash-grid').innerHTML=deleted.map(s=>card(s,0,0)).join('');
  $('#admin-empty').hidden=!!filtered.length;$('#trash-empty').hidden=!!deleted.length;
  $('#order-hint').textContent=canReorder()?'Перетаскивайте карточки или используйте стрелки, чтобы менять порядок на сайте.':'Чтобы менять порядок, выберите «Все» и сбросьте поиск и фильтр формата.';
}
function card(s,index,total){
  const title=esc(s.title),draft=s.status==='draft',trash=!!s.deletedAt;
  const date=new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(trash?s.deletedAt:s.createdAt));
  return `<article class="admin-card" data-id="${s.id}"><div class="admin-card-media">${s.type==='video'?`<video src="${esc(s.src)}#t=0.1" preload="metadata" muted playsinline></video>`:`<img src="${esc(s.src)}" alt="${title}" loading="lazy">`}<span class="admin-card-status ${draft?'draft':''}"><i></i>${trash?'В корзине':draft?'Черновик':'Опубликовано'}</span><button class="preview-card" data-action="preview" aria-label="Предпросмотр: ${title}"></button>${!trash?`<button class="drag-handle" draggable="${canReorder()}" data-action="grip" aria-label="Перетащить: ${title}" title="Перетащите или используйте стрелки ниже" ${canReorder()?'':'disabled'}>${icon('grip')}</button><span class="card-position">${String(index+1).padStart(2,'0')}</span>`:''}<span class="admin-card-kind">${icon(s.type==='video'?'play':'image')}${s.type==='video'?'Видео':'Фото'}</span></div><div class="admin-card-copy"><h3>${title}</h3><p class="admin-card-description">${esc(s.caption||'Без описания')}</p><div class="admin-card-meta"><span>${icon('eye')}${s.views} просмотров</span><span>${trash?'Удалено ':''}${esc(date)}</span></div><div class="admin-card-actions">${trash?`<button class="edit-card" data-action="restore">${icon('restore')} Восстановить</button><button class="edit-card purge-card" data-action="purge">${icon('trash')} Удалить навсегда</button>`:`<button class="edit-card" data-action="edit">${icon('edit')} Изменить</button><button class="small-action" data-action="up" aria-label="Выше: ${title}" title="Выше в сетке" ${!canReorder()||index===0?'disabled':''}>${icon('up')}</button><button class="small-action" data-action="down" aria-label="Ниже: ${title}" title="Ниже в сетке" ${!canReorder()||index===total-1?'disabled':''}>${icon('down')}</button><button class="small-action" data-action="status" aria-label="${draft?'Опубликовать':'Скрыть'}: ${title}" title="${draft?'Опубликовать':'Скрыть в черновики'}">${icon(draft?'eye':'hide')}</button><button class="small-action delete-action" data-action="delete" aria-label="Удалить: ${title}" title="В корзину">${icon('trash')}</button>`}</div></div></article>`;
}
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=async()=>{
  const target=button.dataset.page;if(page===target)return;
  if(settingsDirty&&!await confirm('Уйти без сохранения?','Изменённые контакты не будут сохранены.','Уйти'))return;
  if(settingsDirty){await loadSettings();settingsDirty=false;}
  page=target;$('#publications-page').hidden=page!=='stories';$('#trash-page').hidden=page!=='trash';$('#settings-page').hidden=page!=='settings';
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b===button));render();
});
document.querySelectorAll('[data-status]').forEach(button=>button.onclick=()=>{status=button.dataset.status;document.querySelectorAll('[data-status]').forEach(b=>b.classList.toggle('active',b===button));render();});
$('#admin-search').oninput=e=>{search=e.target.value.trim().toLocaleLowerCase('ru');render();};
$('#admin-type').onchange=e=>{type=e.target.value;render();};
function confirm(title,message,accept){
  $('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-accept').textContent=accept;show(confirmDialog);
  return new Promise(resolve=>{confirmResolve=resolve;});
}
function finishConfirm(result){const resolve=confirmResolve;confirmResolve=null;confirmDialog.close();resolve?.(result);}
$('#confirm-cancel').onclick=()=>finishConfirm(false);$('#confirm-accept').onclick=()=>finishConfirm(true);
confirmDialog.addEventListener('cancel',e=>{e.preventDefault();finishConfirm(false);});
confirmDialog.addEventListener('close',()=>{if(confirmResolve){confirmResolve(false);confirmResolve=null;}});
async function mutate(task,message){
  if(busy)return;busy=true;
  try{await task();await refresh();if(message)toast(message);}catch(error){$('#admin-error').textContent=error.message;toast(error.message);}finally{busy=false;render();}
}
for(const grid of [$('#admin-grid'),$('#trash-grid')])grid.onclick=async e=>{
  const button=e.target.closest('[data-action]'),article=e.target.closest('[data-id]');if(!button||!article||busy)return;
  const s=items.find(s=>s.id===article.dataset.id);if(!s)return;
  const action=button.dataset.action;
  if(action==='edit')return openEditor(s);
  if(action==='preview')return openPreview(s);
  if(action==='delete'){
    if(!await confirm('Убрать историю в корзину?',`«${s.title}» исчезнет с сайта. Вы сможете восстановить её в разделе «Корзина».`,'В корзину'))return;
    return mutate(()=>api(`/api/admin/stories/${s.id}`,{method:'DELETE'}),'История перемещена в корзину');
  }
  if(action==='restore')return mutate(()=>api(`/api/admin/stories/${s.id}/restore`,{method:'POST'}),'История восстановлена в черновики');
  if(action==='purge'){
    if(!s.deletedAt)return;
    if(!await confirm('Удалить историю навсегда?',`«${s.title}» и её фото или видео будут стёрты. Восстановить не получится.`,'Удалить навсегда'))return;
    return mutate(()=>api(`/api/admin/stories/${s.id}/purge`,{method:'POST'}),'История удалена навсегда');
  }
  if(action==='status')return mutate(()=>api(`/api/admin/stories/${s.id}`,{method:'PATCH',body:JSON.stringify({status:s.status==='draft'?'published':'draft',expectedUpdatedAt:s.updatedAt})}),s.status==='draft'?'История опубликована':'История скрыта в черновики');
  if(action==='up'||action==='down'){
    const ids=activeItems().map(s=>s.id),from=ids.indexOf(s.id),to=from+(action==='up'?-1:1);if(to<0||to>=ids.length)return;
    [ids[from],ids[to]]=[ids[to],ids[from]];return reorder(ids,s.id);
  }
};
async function reorder(ids,focusId){
  if(busy)return;$('#save-state').textContent='Сохраняем…';busy=true;
  try{items=await api('/api/admin/stories/reorder',{method:'POST',body:JSON.stringify({ids})});$('#save-state').textContent='Порядок сохранён';toast('Порядок на сайте обновлён');}
  catch(error){$('#save-state').textContent='Не удалось сохранить';$('#admin-error').textContent=error.message;try{await refresh();}catch{}toast(error.message);}
  finally{busy=false;render();if(focusId)$(`[data-id="${focusId}"] .drag-handle`)?.focus();}
}
$('#admin-grid').addEventListener('dragstart',e=>{
  const handle=e.target.closest('.drag-handle');if(!handle||!canReorder()){e.preventDefault();return;}
  dragged=handle.closest('[data-id]').dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragged);handle.closest('.admin-card').classList.add('dragging');
});
$('#admin-grid').addEventListener('dragover',e=>{if(!dragged||!canReorder())return;const card=e.target.closest('.admin-card');if(!card)return;e.preventDefault();document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));card.classList.add('drag-over');});
$('#admin-grid').addEventListener('drop',e=>{
  e.preventDefault();const target=e.target.closest('[data-id]')?.dataset.id;if(!dragged||!target||dragged===target)return;
  const id=dragged,ids=activeItems().map(s=>s.id),from=ids.indexOf(id),to=ids.indexOf(target);ids.splice(from,1);ids.splice(to,0,id);dragged=null;reorder(ids,id);
});
$('#admin-grid').addEventListener('dragend',()=>{dragged=null;document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging'));});
// Кадры читает браузер из локального файла: сервер ничего не перекодирует и не хранит лишнего.
function grabFrames(videoFile,spots){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(videoFile),video=document.createElement('video'),canvas=document.createElement('canvas'),results=[];
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(overall);video.removeEventListener('error',finish);video.remove();URL.revokeObjectURL(url);video.removeAttribute('src');resolve(results);};
    const overall=setTimeout(finish,14000);
    video.muted=true;video.playsInline=true;video.preload='auto';
    video.style.cssText='position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(video);
    video.addEventListener('error',finish);
    const seek=time=>new Promise(done=>{
      const stop=value=>{video.removeEventListener('seeked',ok);video.removeEventListener('error',bad);clearTimeout(timer);done(value);};
      const ok=()=>stop(true),bad=()=>stop(false),timer=setTimeout(()=>stop(false),3500);
      video.addEventListener('seeked',ok);video.addEventListener('error',bad);
      try{video.currentTime=time}catch{stop(false);}
    });
    video.onloadedmetadata=async()=>{
      const duration=Number(video.duration)||0;
      if(!duration||!video.videoWidth||!video.videoHeight)return finish();
      const width=Math.min(480,video.videoWidth),scale=width/video.videoWidth;
      canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const context=canvas.getContext('2d');
      for(const spot of spots){
        if(settled)break;
        if(await seek(duration*spot)){
          context.drawImage(video,0,0,canvas.width,canvas.height);
          const data=canvas.toDataURL('image/jpeg',.7);
          if(data.startsWith('data:image/jpeg;base64,'))results.push(data.slice(23));
        }
      }
      finish();
    };
    video.src=url;
  });
}
function paintCovers(){
  $('#cover-options').innerHTML=covers.map((data,index)=>`<button type="button" class="cover-option${index===coverPick?' selected':''}" data-cover="${index}" aria-label="Кадр ${index+1}" aria-pressed="${index===coverPick}"><img src="data:image/jpeg;base64,${data}" alt=""></button>`).join('');
}
function resetCovers(){covers=[];coverPick=null;$('#cover-options').replaceChildren();$('#cover-picker').hidden=true;}
const evenSpots=Array.from({length:6},(_,index)=>(index+.5)/6);
function randomSpots(){
  const spots=[];
  for(let tries=0;tries<80&&spots.length<6;tries++){const value=.05+Math.random()*.9;if(spots.every(other=>Math.abs(other-value)>.08))spots.push(value);}
  while(spots.length<6)spots.push(.05+Math.random()*.9);
  return spots.sort((a,b)=>a-b);
}
async function buildCovers(videoFile,spots=evenSpots){
  if(coverBusy)return;coverBusy=true;
  resetCovers();$('#cover-picker').hidden=false;$('#cover-hint').textContent='Выбираем кадры из видео…';$('#cover-shuffle').disabled=true;paintCovers();
  const frames=await grabFrames(videoFile,spots);
  coverBusy=false;$('#cover-shuffle').disabled=false;
  if(!frames.length){$('#cover-hint').textContent='Кадры прочитать не удалось.';return;}
  covers=frames;coverPick=Math.floor(frames.length/2);paintCovers();
  $('#cover-hint').textContent=`${frames.length} кадров из видео — выберите нужный`;
}
$('#cover-options').onclick=e=>{const button=e.target.closest('[data-cover]');if(!button)return;coverPick=Number(button.dataset.cover);paintCovers();editorDirty=true;};
$('#cover-shuffle').onclick=()=>{if(file&&isVideoFile(file))buildCovers(file,randomSpots());};
function clearFile(){if(fileURL)URL.revokeObjectURL(fileURL);fileURL=null;file=null;$('#editor-file').value='';resetCovers();}
function displayMedia(s){
  const media=document.createElement(s.type==='video'?'video':'img');media.src=s.src;if(s.type==='video'){media.muted=true;media.playsInline=true;media.preload='metadata';}else media.alt='Предпросмотр публикации';
  $('#editor-media').replaceChildren(media);$('#editor-drop').classList.add('has-media');$('#file-prompt').textContent='Заменить фото или видео';
}
function updateCounts(){$('#title-count').textContent=`${$('#editor-title').value.length} / 80`;$('#caption-count').textContent=`${$('#editor-caption').value.length} / 400`;$('#bouquet-count').textContent=`${$('#editor-bouquet').value.length} / 300`;$('#editor-status-note').textContent=$('#editor-status').value==='draft'?'Черновик виден только администрации.':'История будет видна посетителям сайта.';}
function openEditor(s=null){
  editing=s;clearFile();$('#editor-form').reset();$('#editor-media').replaceChildren();$('#editor-drop').classList.remove('has-media');$('#file-prompt').textContent='Добавьте фото или видео';$('#editor-error').textContent='';
  $('#editor-heading').textContent=s?'Редактировать историю':'Новая история';$('#editor-eyebrow').textContent=s?'КАЖДАЯ ДЕТАЛЬ ВАЖНА':'НОВЫЙ МОМЕНТ';
  $('#editor-title').value=s?.title||'';$('#editor-caption').value=s?.caption||'';$('#editor-bouquet').value=s?.bouquet||'';$('#editor-status').value=s?.status||'draft';
  $('#editor-file-note').textContent=s?'Можно заменить фото или видео — название и описание сохранятся.':'Вертикальные фото и видео особенно красиво выглядят в сторис.';
  if(s)displayMedia(s);updateCounts();editorDirty=false;show(editor);
}
$('#new-story').onclick=()=>openEditor();
$('#editor-form').addEventListener('input',()=>{editorDirty=true;updateCounts();});
async function closeEditor(){if(editorSaving)return;if(editorDirty&&!await confirm('Закрыть без сохранения?','Изменения этой истории будут потеряны.','Закрыть'))return;editorDirty=false;editor.close();}
$('#close-editor').onclick=closeEditor;$('#cancel-editor').onclick=closeEditor;
editor.addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
editor.addEventListener('close',()=>{const v=$('#editor-media video');v?.pause();$('#editor-media').replaceChildren();clearFile();});
function chooseFile(next){
  if(!next)return;$('#editor-error').textContent='';
  if(!isAllowedFile(next)){clearFile();if(editing)displayMedia(editing);else{$('#editor-media').replaceChildren();$('#editor-drop').classList.remove('has-media');}$('#editor-error').textContent='Выберите JPG, PNG, WebP, GIF, HEIC, MP4, MOV или WebM.';return;}
  if(next.size>MAX_FILE){clearFile();if(editing)displayMedia(editing);else{$('#editor-media').replaceChildren();$('#editor-drop').classList.remove('has-media');}$('#editor-error').textContent=`Максимальный размер — ${MAX_FILE/1024/1024} МБ.`;return;}
  clearFile();file=next;const label=`${file.name} · ${(file.size/1024/1024).toFixed(1)} МБ`;editorDirty=true;
  // Браузер не показывает HEIC, поэтому превью не делаем: сервер всё равно сохранит из него обычный JPG.
  if(isHeicFile(next)){$('#editor-file-note').textContent=`${label} — на сайте сохранится как JPG`;return;}
  fileURL=URL.createObjectURL(file);displayMedia({src:fileURL,type:isVideoFile(file)?'video':'image'});$('#editor-file-note').textContent=label;if(isVideoFile(file))buildCovers(file);
}
$('#editor-file').onchange=e=>chooseFile(e.target.files[0]);
for(const event of ['dragover','dragenter'])$('#editor-drop').addEventListener(event,e=>{e.preventDefault();$('#editor-drop').classList.add('drag-over');});
for(const event of ['dragleave','drop'])$('#editor-drop').addEventListener(event,e=>{e.preventDefault();$('#editor-drop').classList.remove('drag-over');if(event==='drop')chooseFile(e.dataTransfer.files[0]);});
// Файл уходит на сервер потоком (не base64 внутри JSON), поэтому 80 МБ не превращаются в ~350 МБ в памяти.
function uploadFile(file,onProgress){
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.open('POST','/api/admin/media');
    request.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.min(99,Math.round(e.loaded/e.total*100)));};
    request.onload=()=>{
      let result={};try{result=JSON.parse(request.responseText);}catch{}
      if(request.status>=200&&request.status<300)resolve(result);else reject(Error(result.error||'Не удалось загрузить файл на сервер.'));
    };
    request.onerror=()=>reject(Error('Связь с сервером оборвалась — попробуйте ещё раз.'));
    request.send(file);
  });
}
$('#editor-form').onsubmit=async e=>{
  e.preventDefault();if(editorSaving)return;if(!editing&&!file){$('#editor-error').textContent='Добавьте фото или видео.';return;}
  editorSaving=true;const button=$('#save-editor');button.disabled=true;button.textContent='Сохраняем…';$('#editor-error').textContent='';
  const payload={title:$('#editor-title').value,caption:$('#editor-caption').value,bouquet:$('#editor-bouquet').value.trim(),status:$('#editor-status').value};
  try{
    if(file){
      const note=$('#editor-file-note'),label=`${file.name} · ${(file.size/1024/1024).toFixed(1)} МБ`;
      payload.media=await uploadFile(file,percent=>{button.textContent=`Загружаем ${percent}%`;note.textContent=`${label} — загружаем ${percent}%`;});
      if(isVideoFile(file))payload.cover=coverPick===null?null:covers[coverPick]||null;
    }if(editing)payload.expectedUpdatedAt=editing.updatedAt;
    await api(editing?`/api/admin/stories/${editing.id}`:'/api/stories',{method:editing?'PATCH':'POST',body:JSON.stringify(payload)});
    editorDirty=false;editor.close();await refresh();toast(payload.status==='draft'?'Черновик сохранён':'История сохранена и опубликована');
  }catch(error){$('#editor-error').textContent=error.message;}finally{editorSaving=false;button.disabled=false;button.innerHTML='Сохранить историю '+icon('check');}
};
function openPreview(s){
  const media=document.createElement(s.type==='video'?'video':'img');media.src=s.src;if(s.type==='video'){media.controls=true;media.playsInline=true;media.autoplay=true;}else media.alt=s.title;
  $('#preview-media').replaceChildren(media);$('#preview-title').textContent=s.title;$('#preview-caption').textContent=s.caption;show(preview);
}
$('#close-preview').onclick=()=>preview.close();preview.addEventListener('close',()=>{$('#preview-media video')?.pause();$('#preview-media').replaceChildren();});
async function loadSettings(){const values=await api('/api/contacts');for(const key of ['telegram','max','whatsapp','address','coordinates'])$('#setting-'+key).value=values[key]||'';settingsDirty=false;$('#settings-saved').textContent='';}
$('#settings-form').oninput=()=>{settingsDirty=true;settingsVersion++;$('#settings-saved').textContent='Есть несохранённые изменения';};
$('#settings-form').onsubmit=async e=>{
  e.preventDefault();const button=$('button[type=submit]',e.target);if(button.disabled)return;button.disabled=true;$('#settings-error').textContent='';
  const payload={};for(const key of ['telegram','max','whatsapp','address','coordinates'])payload[key]=$('#setting-'+key).value.trim();
  if(payload.whatsapp&&!/^https:\/\//.test(payload.whatsapp)){
    const number=payload.whatsapp.replace(/[+\s()\-]/g,'');if(!/^\d{7,15}$/.test(number)){$('#settings-error').textContent='Введите номер WhatsApp с кодом страны или ссылку https://wa.me/…';button.disabled=false;return;}payload.whatsapp='https://wa.me/'+number;
  }
  const version=settingsVersion;
  try{const saved=await api('/api/admin/contacts',{method:'PUT',body:JSON.stringify(payload)});if(version===settingsVersion){for(const key of Object.keys(saved))$('#setting-'+key).value=saved[key]||'';settingsDirty=false;$('#settings-saved').textContent='Контакты сохранены';}toast('Контакты магазина обновлены');}
  catch(error){$('#settings-error').textContent=error.message;}finally{button.disabled=false;}
};
async function logout(){if(settingsDirty&&!await confirm('Выйти без сохранения?','Изменённые контакты не будут сохранены.','Выйти'))return;try{await api('/api/logout',{method:'POST'});settingsDirty=false;location.href='/';}catch(error){toast(error.message);}}
$('#admin-logout').onclick=logout;
const mobile=document.createElement('div');mobile.className='admin-mobile-actions';mobile.innerHTML='<a href="/">На сайт ↗</a><button id="mobile-logout">Выйти</button>';$('.admin-sidebar').append(mobile);$('#mobile-logout').onclick=logout;
window.addEventListener('beforeunload',e=>{if(editorDirty||settingsDirty){e.preventDefault();e.returnValue='';}});
boot();
