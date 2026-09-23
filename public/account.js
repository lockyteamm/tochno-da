const loginDialog=$('#login-dialog'), contactDialog=$('#contact-dialog');
let admin=false, contacts=null, resumeAfterContacts=false;
function setAdmin(value){
  admin=value;
  $('#login-button').innerHTML=(admin?'Админ':'Логин')+' '+icon('arrow-up-right');
  $('#login-form').hidden=admin;$('#admin-panel').hidden=!admin;
  $('#login-title').textContent=admin?'Администрация':'Вход в аккаунт';
}
async function checkSession(){
  try{const response=await fetch('/api/session');if(!response.ok)throw Error();setAdmin((await response.json()).admin);}catch{setAdmin(false);}
}
$('#login-button').onclick=async()=>{await checkSession();$('#login-error').textContent='';$('#admin-error').textContent='';if(admin){location.href='/admin.html';return;}showDialog(loginDialog);$('#admin-login').focus();};
$('#close-login').onclick=()=>loginDialog.close();
loginDialog.addEventListener('close',e=>{$('#admin-password').value='';releaseDialog(e);});
loginDialog.onclick=e=>{if(e.target===loginDialog)loginDialog.close();};
$('#login-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#submit-login');if(button.disabled)return;button.disabled=true;button.textContent='Входим…';$('#login-error').textContent='';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:$('#admin-login').value,password:$('#admin-password').value})});
    const result=await response.json();if(!response.ok)throw Error(result.error);
    $('#admin-password').value='';setAdmin(true);location.href='/admin.html';
  }catch(error){$('#login-error').textContent=error.message||'Не удалось войти. Попробуйте ещё раз.';}finally{button.disabled=false;button.innerHTML='Войти '+icon('arrow-up-right');}
};
$('#admin-upload').onclick=()=>{location.href='/admin.html';};
$('#logout-button').onclick=async()=>{
  const button=$('#logout-button');button.disabled=true;
  try{const response=await fetch('/api/logout',{method:'POST'});if(!response.ok)throw Error();setAdmin(false);loginDialog.close();toast('Вы вышли из аккаунта');}
  catch{$('#admin-error').textContent='Не удалось выйти. Попробуйте ещё раз.';}finally{button.disabled=false;}
};
window.addEventListener('admin-session-expired',()=>{setAdmin(false);});
async function loadContacts(){try{const response=await fetch('/api/contacts');if(!response.ok)throw Error();contacts=await response.json();}catch{contacts=null;}}
function contactURL(name,raw,message){
  if(!raw)return null;
  try{
    const url=new URL(raw);
    const allowed={max:['max.ru','www.max.ru'],telegram:['t.me'],whatsapp:['wa.me','api.whatsapp.com']};
    if(url.protocol!=='https:'||!allowed[name].includes(url.hostname))return null;
    if(name!=='max')url.searchParams.set('text',message);
    return url.href;
  }catch{return null;}
}
function renderContacts(story){
  const message=story?`Здравствуйте! Мне понравилась история «${story.title}». Хочу похожий букет.`:'Здравствуйте! Хочу заказать букет.';
  let missing=false;
  for(const name of ['max','telegram','whatsapp']){
    const link=$('#contact-'+name);const url=contactURL(name,contacts?.[name],message);
    if(url){link.href=url;link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');$('small',link).textContent='Написать в '+({max:'MAX',telegram:'Telegram',whatsapp:'WhatsApp'}[name]);}
    else{link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.setAttribute('tabindex','-1');$('small',link).textContent='Контакт скоро появится';missing=true;}
  }
  $('#contact-note').textContent=missing?'Некоторые контакты ещё не добавлены магазином.':'';
}
async function openContacts(story=null){
  resumeAfterContacts=storyDialog.open&&!paused;if(resumeAfterContacts)togglePause();
  $('#contact-story').textContent=story?`Вам понравилось: «${story.title}»`:'';
  renderContacts(story);showDialog(contactDialog);
  await loadContacts();if(contactDialog.open)renderContacts(story);
}
$('#story-order').onclick=()=>openContacts(activeList[currentIndex]);
document.querySelectorAll('[data-contact-open]').forEach(button=>button.onclick=e=>{e.preventDefault();openContacts();});
$('#close-contacts').onclick=()=>contactDialog.close();
contactDialog.onclick=e=>{if(e.target===contactDialog)contactDialog.close();};
contactDialog.addEventListener('close',e=>{releaseDialog(e);if(resumeAfterContacts&&storyDialog.open&&paused)togglePause();resumeAfterContacts=false;});
checkSession();loadContacts();
