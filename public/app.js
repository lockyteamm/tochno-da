const $ = (s, root=document) => root.querySelector(s);
const icons = { 'arrow-up-right':'<path d="M7 17 17 7M6 7h11v11"/>','arrow-down':'<path d="M12 4v16m-6-6 6 6 6-6"/>',plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="m6 6 12 12M6 18 18 6"/>',eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',play:'<path d="m8 4 12 8-12 8Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',image:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 7"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',flower:'<path d="M12 7C6-4-2 8 7 12c-11 6 1 14 5 5 6 11 14-1 5-5 11-6-1-14-5-5Z"/><circle cx="12" cy="12" r="3"/>','volume-off':'<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',volume:'<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>' };
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.image}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.outerHTML=icon(el.dataset.icon));
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readSet = key => {try{return new Set(JSON.parse(localStorage.getItem(key)||'[]'));}catch{return new Set();}};
const viewed=readSet('flower-viewed');
const persist=(key,set)=>{try{localStorage.setItem(key,JSON.stringify([...set]));}catch{}};
let stories=[], activeList=[], currentIndex=0, paused=false, muted=true, animation=0, elapsed=0, lastFrame=0, selectedFile=null, previewURL=null, toastTimer, previousFocus;
const storyDialog=$('#story-dialog'), uploadDialog=$('#upload-dialog');
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2800);}
function list(){return stories;}
function render(){
  const visible=list(); $('#empty-state').hidden=!!visible.length;
  $('#feed').innerHTML=visible.map(s=>`<article class="story-card"><button class="card-open" data-open="${s.id}" aria-label="Открыть историю: ${escapeHTML(s.title)}">${s.type==='video'?`<video src="${s.src}#t=0.1" preload="metadata" muted playsinline></video>`:`<img src="${s.src}" alt="${escapeHTML(s.title)}" loading="lazy">`}<span class="card-gradient"></span><span class="card-kind">${icon(s.type==='video'?'play':'image')}</span><div class="card-copy"><h3>${escapeHTML(s.title)}</h3><div class="card-meta"><span>${icon('eye')} ${s.views}</span><span>${s.type==='video'?'Видео':'Фотоистория'}</span></div></div></button></article>`).join('');
}
async function load(){try{const response=await fetch('/api/stories');if(!response.ok)throw Error();stories=await response.json();render();openFromHash();}catch{$('#feed').innerHTML='<div class="load-error"><p>Не удалось загрузить истории.</p><button class="button button-outline" id="retry-load">Попробовать ещё раз</button></div>';$('#retry-load').onclick=load;}}
function openFromHash(){const id=location.hash.match(/^#story=([a-z0-9-]+)$/)?.[1];if(!id)return;activeList=list();const index=activeList.findIndex(s=>s.id===id);if(index>=0)openStory(index);}
$('#feed').onclick=e=>{const open=e.target.closest('[data-open]');if(open){activeList=list();openStory(activeList.findIndex(s=>s.id===open.dataset.open));}};
function showDialog(dialog){dialog.returnFocus=document.activeElement;dialog.showModal();document.body.classList.add('modal-open');}
function releaseDialog(event){document.body.classList.toggle('modal-open',!!document.querySelector('dialog[open]'));const focus=event?.target?.returnFocus;if(focus?.isConnected)focus.focus();}
function openStory(index){
  if(index<0)return;
  if(index>=activeList.length){storyDialog.close();return;}
  cancelAnimationFrame(animation);currentIndex=index;paused=false;elapsed=0;lastFrame=0;
  const s=activeList[index];
  const media=document.createElement(s.type==='video'?'video':'img');media.src=s.src;
  if(s.type==='video'){media.autoplay=true;media.playsInline=true;media.muted=muted;media.onended=()=>openStory(currentIndex+1);media.onloadedmetadata=()=>media.play().catch(()=>{paused=true;updatePause();});}else{media.alt=s.title;}
  media.onerror=()=>{paused=true;updatePause();toast('Не удалось открыть медиа. Переключитесь на следующую историю.');};
  const oldVideo=$('#story-media video');if(oldVideo){oldVideo.onended=null;oldVideo.pause();}
  $('#story-media').replaceChildren(media);
  $('#story-title').textContent=s.title;$('#story-caption').textContent=s.caption;
  $('#story-time').textContent=s.demo?'Цветочное вдохновение':new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(new Date(s.createdAt));
  $('#story-progress').innerHTML=activeList.map((_,i)=>`<div class="progress-track"><div class="progress-fill" style="width:${i<index?100:0}%"></div></div>`).join('');
  $('#sound-story').hidden=s.type!=='video';$('#sound-story').innerHTML=icon(muted?'volume-off':'volume');
  updatePause();
  if(!storyDialog.open)showDialog(storyDialog);
  if(!viewed.has(s.id)){fetch(`/api/stories/${s.id}/view`,{method:'POST'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{s.views=data.views;viewed.add(s.id);persist('flower-viewed',viewed);render();}).catch(()=>{});}
  animation=requestAnimationFrame(tick);
}
function tick(now){
  if(!storyDialog.open)return;
  const media=$('#story-media').firstElementChild;
  const delta=lastFrame?Math.min(now-lastFrame,100):0;lastFrame=now;
  if(!paused&&!document.hidden){
    if(media.tagName==='VIDEO'){elapsed=media.duration?media.currentTime/media.duration*100:0;}
    else if(media.complete&&media.naturalWidth){elapsed+=delta/6500*100;}
    const fill=$('#story-progress').children[currentIndex]?.firstElementChild;if(fill)fill.style.width=`${Math.min(elapsed,100)}%`;
    if(media.tagName!=='VIDEO'&&elapsed>=100){openStory(currentIndex+1);return;}
  }
  animation=requestAnimationFrame(tick);
}
function updatePause(){$('#pause-story').innerHTML=icon(paused?'play':'pause');$('#pause-story').setAttribute('aria-label',paused?'Продолжить':'Приостановить');}
function togglePause(){paused=!paused;const video=$('#story-media video');if(video){if(paused)video.pause();else video.play().catch(()=>{paused=true;updatePause();});}updatePause();}
$('#pause-story').onclick=togglePause;$('#sound-story').onclick=()=>{muted=!muted;const video=$('#story-media video');if(video)video.muted=muted;$('#sound-story').innerHTML=icon(muted?'volume-off':'volume');$('#sound-story').setAttribute('aria-label',muted?'Включить звук':'Выключить звук');};
let suppressTapUntil=0;
$('#prev-story').onclick=()=>{if(Date.now()>suppressTapUntil)openStory(currentIndex-1);};$('#next-story').onclick=()=>{if(Date.now()>suppressTapUntil)openStory(currentIndex+1);};$('#close-story').onclick=()=>storyDialog.close();
storyDialog.addEventListener('close',event=>{cancelAnimationFrame(animation);const video=$('#story-media video');if(video){video.onended=null;video.pause();}$('#story-media').replaceChildren();releaseDialog(event);});
storyDialog.onclick=e=>{if(e.target===storyDialog)storyDialog.close();};
document.addEventListener('keydown',e=>{if(!storyDialog.open||document.querySelector('#contact-dialog[open]'))return;if(e.key==='ArrowRight'){e.preventDefault();openStory(currentIndex+1);}if(e.key==='ArrowLeft'){e.preventDefault();openStory(currentIndex-1);}if(e.code==='Space'){e.preventDefault();togglePause();}});
document.addEventListener('visibilitychange',()=>{if(storyDialog.open){const v=$('#story-media video');if(document.hidden){v?.pause();}else{lastFrame=0;if(v&&!paused)v.play().catch(()=>{});}}});
let touchStart=0;
$('.viewer').addEventListener('touchstart',e=>{touchStart=e.changedTouches[0].clientX;},{passive:true});
$('.viewer').addEventListener('touchend',e=>{if(e.target.closest('a,.icon-button'))return;const diff=e.changedTouches[0].clientX-touchStart;if(Math.abs(diff)>55){suppressTapUntil=Date.now()+400;openStory(currentIndex+(diff<0?1:-1));}},{passive:true});
$('#close-upload').onclick=()=>uploadDialog.close();uploadDialog.addEventListener('close',releaseDialog);uploadDialog.onclick=e=>{if(e.target===uploadDialog)uploadDialog.close();};
function selectFile(file){
  $('#upload-error').textContent='';if(!file)return;
  selectedFile=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('#upload-preview').replaceChildren();
  if(!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'].includes(file.type)){$('#upload-error').textContent='Выберите JPG, PNG, WebP, GIF, MP4 или WebM.';return;}
  if(file.size>30*1024*1024){$('#upload-error').textContent='Файл больше 30 МБ. Выберите файл поменьше.';return;}
  selectedFile=file;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(file);
  const preview=document.createElement(file.type.startsWith('video')?'video':'img');preview.src=previewURL;if(preview.tagName==='VIDEO'){preview.muted=true;preview.playsInline=true;preview.autoplay=true;preview.loop=true;}else preview.alt='Предпросмотр публикации';$('#upload-preview').replaceChildren(preview);
}
$('#media-input').onchange=e=>selectFile(e.target.files[0]);
for(const event of ['dragover','dragenter'])$('#drop-zone').addEventListener(event,e=>{e.preventDefault();$('#drop-zone').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('#drop-zone').addEventListener(event,e=>{e.preventDefault();$('#drop-zone').classList.remove('dragging');if(event==='drop')selectFile(e.dataTransfer.files[0]);});
const toBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
$('#upload-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#publish-button');if(button.disabled)return;
  if(!selectedFile){$('#upload-error').textContent='Сначала выберите фото или видео.';return;}
  button.disabled=true;button.textContent='Публикуем…';$('#upload-error').textContent='';
  try{const response=await fetch('/api/stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:$('#upload-name').value,caption:$('#upload-caption').value,data:await toBase64(selectedFile)})});const result=await response.json();if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('admin-session-expired'));throw Error(result.error);}stories.unshift(result);render();uploadDialog.close();$('#upload-form').reset();selectedFile=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;$('#upload-preview').replaceChildren();$('#stories').scrollIntoView({behavior:'smooth'});toast('История опубликована. Пусть красота радует всех!');}catch(error){$('#upload-error').textContent=error.message||'Не удалось загрузить файл. Попробуйте ещё раз.';}finally{button.disabled=false;button.innerHTML=icon('plus')+' Опубликовать историю';}
};
load();
setInterval(()=>{if(!document.querySelector('dialog[open]'))load();},30000);
