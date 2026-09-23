import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const dbPath = path.join(dataDir, 'stories.json');
const passwordSalt = randomBytes(16);
const passwordHash = scryptSync(process.env.ADMIN_PASSWORD || 'Admin123', passwordSalt, 64);
const adminLogin = process.env.ADMIN_LOGIN || 'Admin';
const sessions = new Map();
const loginAttempts = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
function sessionToken(req) { return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('flower_session='))?.slice(15); }
function isAdmin(req) {
  const token=sessionToken(req), expires=sessions.get(token);
  if(!expires) return false;
  if(expires<Date.now()){sessions.delete(token);return false;}
  return true;
}
function sessionCookie(token, age=28800) { return `flower_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`; }
const seed = [
  ['Нежность без повода', 'Пионы, в которые невозможно не влюбиться.', 'bouquets', 'flowers-1.jpg'],
  ['Красный — значит любовь', 'Когда хочется сказать самое главное без слов.', 'bouquets', 'flowers-2.jpg'],
  ['Маленькое большое счастье', 'Собираем красоту из самых простых моментов.', 'details', 'flowers-3.jpg'],
  ['Ваш особенный день', 'Букет, который останется в воспоминаниях.', 'bouquets', 'flowers-4.jpg'],
  ['В мастерской', 'Много цветов, немного магии и любовь к своему делу.', 'studio', 'flowers-5.jpg'],
  ['Просто потому что', 'Для цветов не нужен повод. Только тот самый человек.', 'details', 'flowers-6.jpg'],
];
let stories = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : seed.map((s, i) => ({ id: `demo-${i+1}`, title:s[0], caption:s[1], category:s[2], src:`/assets/${s[3]}`, type:'image', views:0, demo:true, createdAt:new Date(Date.now()-i*3600000).toISOString() }));
stories=stories.map(s=>({...s,status:s.status||'published',updatedAt:s.updatedAt||s.createdAt,deletedAt:s.deletedAt||null}));
const visible = s => !s.deletedAt && s.status==='published';
const save = () => { fs.writeFileSync(dbPath+'.tmp', JSON.stringify(stories,null,2)); fs.renameSync(dbPath+'.tmp',dbPath); };
// Assign once and persist so refreshing a story does not change its starting count.
let viewsMigrated=false;
for(const story of stories){
  if(!story.randomViewsAssigned){story.views=randomInt(1000,10001);story.randomViewsAssigned=true;viewsMigrated=true;}
}
if(viewsMigrated)save();
const contactsPath=path.join(dataDir,'contacts.json');
const readContacts=()=>fs.existsSync(contactsPath)?JSON.parse(fs.readFileSync(contactsPath,'utf8')):{telegram:'https://t.me/tochnoda_ru',max:null,whatsapp:null};
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function textFields(input){
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>80)fail('Введите название до 80 символов.');
  if(input.caption!==undefined&&(typeof input.caption!=='string'||input.caption.length>400))fail('Описание должно быть не длиннее 400 символов.');
  if(input.status!==undefined&&!['published','draft'].includes(input.status))fail('Неизвестный статус публикации.');
  return {title:input.title.trim(),caption:input.caption||'',status:input.status||'published'};
}
function storeMedia(data){
  if(typeof data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail('Не удалось прочитать файл.');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>30*1024*1024)fail('Максимальный размер файла — 30 МБ.',413);
  const kind=sniff(bytes);if(!kind)fail('Поддерживаются JPG, PNG, WebP, GIF, MP4 и WebM.');
  const filename=`${randomUUID()}.${kind[1]}`;fs.writeFileSync(path.join(uploadDir,filename),bytes);
  return {src:`/uploads/${filename}`,type:kind[0]};
}
function validateContacts(input){
  const output={};const hosts={telegram:['t.me'],max:['max.ru','www.max.ru'],whatsapp:['wa.me','api.whatsapp.com']};
  for(const name of Object.keys(hosts)){
    const raw=input[name];if(raw===null||raw===''){output[name]=null;continue;}
    if(typeof raw!=='string'||raw.length>500)fail(`Проверьте контакт ${name}.`);
    let url;try{url=new URL(raw);}catch{fail(`Нужна полная ссылка для ${name}, начиная с https://.`);}
    if(url.protocol!=='https:'||!hosts[name].includes(url.hostname)||url.username||url.password||url.port||url.pathname==='/')fail(`Недопустимая ссылка для ${name}.`);
    output[name]=url.href;
  }
  return output;
}
const json = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.svg':'image/svg+xml'};
function sniff(b) {
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image','png'];
  if(b[0]===255 && b[1]===216 && b[2]===255) return ['image','jpg'];
  if(b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return ['image','webp'];
  if(/^GIF8[79]a$/.test(b.toString('ascii',0,6))) return ['image','gif'];
  if(b.toString('ascii',4,8)==='ftyp' && /isom|iso2|mp4|avc1|M4V|MSNV/.test(b.toString('ascii',8,40))) return ['video','mp4'];
  if(b.subarray(0,4).equals(Buffer.from([26,69,223,163])) && b.subarray(0,256).includes(Buffer.from('webm'))) return ['video','webm'];
  return null;
}
async function body(req, limit=43*1024*1024) {
  let size=0; const chunks=[];
  for await(const chunk of req) { size+=chunk.length; if(size>limit) { const e=new Error('Запрос слишком большой. Максимум для файла — 30 МБ.'); e.status=413; throw e; } chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { const e=new Error('Некорректный запрос.'); e.status=400; throw e; }
}
const server = http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  try {
    const url=new URL(req.url,'http://localhost');
    // Reject cross-site writes: compare origin host against this request's host (proxy header aware).
    const mutation=!['GET','HEAD'].includes(req.method);
    if(mutation&&req.headers.origin){let originHost='';try{originHost=new URL(req.headers.origin).host}catch{};const hosts=new Set([req.headers.host,String(req.headers['x-forwarded-host']||'').split(',')[0].trim()].filter(Boolean));if(!hosts.has(originHost))return json(res,403,{error:'Недопустимый источник запроса.'});}
    if(mutation && req.headers['sec-fetch-site']==='cross-site') return json(res,403,{error:'Недопустимый источник запроса.'});
    if(url.pathname.startsWith('/api/admin/')&&!isAdmin(req))return json(res,401,{error:'Войдите в аккаунт администратора.'});
    if(url.pathname==='/api/session' && req.method==='GET') return json(res,200,{admin:isAdmin(req)});
    if(url.pathname==='/api/login' && req.method==='POST') {
      const address=req.socket.remoteAddress;
      let attempt=loginAttempts.get(address);
      if(!attempt || attempt.resetAt<Date.now()){attempt={count:0,resetAt:Date.now()+60000};loginAttempts.set(address,attempt);}
      if(attempt.count>=5) return json(res,429,{error:'Слишком много попыток. Попробуйте через минуту.'});
      const input=await body(req,8192);
      const validPassword=typeof input.password==='string' && input.password.length<=256 && timingSafeEqual(scryptSync(input.password,passwordSalt,64),passwordHash);
      if(input.login!==adminLogin || !validPassword){attempt.count++;return json(res,401,{error:'Неверный логин или пароль.'});}
      loginAttempts.delete(address);
      for(const [token,expires] of sessions) if(expires<Date.now())sessions.delete(token);
      sessions.delete(sessionToken(req));
      const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+sessionLifetime);
      res.setHeader('Set-Cookie',sessionCookie(token));return json(res,200,{admin:true});
    }
    if(url.pathname==='/api/logout' && req.method==='POST') {
      sessions.delete(sessionToken(req));res.setHeader('Set-Cookie',sessionCookie('',0));return json(res,200,{admin:false});
    }
    if(url.pathname==='/api/contacts' && req.method==='GET') {
      return json(res,200,readContacts());
    }
    if(url.pathname==='/api/admin/contacts' && req.method==='PUT'){
      const input=validateContacts(await body(req,8192));
      fs.writeFileSync(contactsPath+'.tmp',JSON.stringify(input,null,2));fs.renameSync(contactsPath+'.tmp',contactsPath);return json(res,200,input);
    }
    if(url.pathname==='/api/admin/stories' && req.method==='GET')return json(res,200,stories);
    if(url.pathname==='/api/admin/stories/reorder' && req.method==='POST'){
      const {ids}=await body(req,1024*1024);const active=stories.filter(s=>!s.deletedAt);
      if(!Array.isArray(ids)||ids.length!==active.length||new Set(ids).size!==ids.length||ids.some(id=>!active.some(s=>s.id===id)))return json(res,409,{error:'Состав ленты изменился. Обновите панель и повторите перестановку.'});
      const byId=new Map(active.map(s=>[s.id,s]));stories=[...ids.map(id=>byId.get(id)),...stories.filter(s=>s.deletedAt)];save();return json(res,200,stories);
    }
    const adminStory=url.pathname.match(/^\/api\/admin\/stories\/([a-z0-9-]+)(\/restore)?$/);
    if(adminStory){
      const item=stories.find(s=>s.id===adminStory[1]);if(!item)return json(res,404,{error:'Публикация не найдена.'});
      if(adminStory[2] && req.method==='POST'){
        if(!item.deletedAt)return json(res,409,{error:'Публикация уже восстановлена.'});
        item.deletedAt=null;item.status='draft';item.updatedAt=new Date().toISOString();save();return json(res,200,item);
      }
      if(!adminStory[2] && req.method==='DELETE'){
        if(!item.deletedAt){item.deletedAt=new Date().toISOString();item.updatedAt=item.deletedAt;save();}
        return json(res,200,item);
      }
      if(!adminStory[2] && req.method==='PATCH'){
        if(item.deletedAt)return json(res,409,{error:'Сначала восстановите публикацию из корзины.'});
        const input=await body(req);
        if(input.expectedUpdatedAt && input.expectedUpdatedAt!==item.updatedAt)return json(res,409,{error:'Публикация уже изменена в другой вкладке. Обновите панель.'});
        const fields=textFields({...item,...input});const media=input.data!==undefined?storeMedia(input.data):{};
        Object.assign(item,fields,media,{updatedAt:new Date().toISOString()});save();return json(res,200,item);
      }
      return json(res,405,{error:'Метод не поддерживается.'});
    }
    if(url.pathname==='/api/stories' && req.method==='GET') return json(res,200,stories.filter(visible));
    if(url.pathname==='/api/stories' && req.method==='POST') {
      if(!isAdmin(req)) return json(res,401,{error:'Загрузка доступна только администрации. Войдите в аккаунт.'});
      const input=await body(req);
      const fields=textFields(input);const media=storeMedia(input.data);const now=new Date().toISOString();
      const item={id:randomUUID(),...fields,...media,views:randomInt(1000,10001),randomViewsAssigned:true,createdAt:now,updatedAt:now,deletedAt:null};
      stories.unshift(item); save(); return json(res,201,item);
    }
    const view=url.pathname.match(/^\/api\/stories\/([a-z0-9-]+)\/view$/);
    if(view && req.method==='POST') { const item=stories.find(s=>s.id===view[1]&&visible(s)); if(!item) return json(res,404,{error:'История не найдена.'}); item.views=Math.min(10000,item.views+1); save(); return json(res,200,{views:item.views}); }
    if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Метод не поддерживается.'});
    const isUpload=url.pathname.startsWith('/uploads/');
    if(isUpload){res.setHeader('Cache-Control','no-store');if(!isAdmin(req)&&!stories.some(s=>visible(s)&&s.src===url.pathname))return json(res,404,{error:'Не найдено.'});}
    const base=isUpload?uploadDir:path.join(root,'public');
    const relative=isUpload?url.pathname.slice(9):(url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1));
    const file=path.resolve(base,relative);
    if(!file.startsWith(base+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res,404,{error:'Не найдено.'});
    const stat=fs.statSync(file); const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes'};
    let start=0,end=stat.size-1,status=200;
    if(req.headers.range) {
      const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if(!range) {res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}); return res.end();}
      start=Number(range[1]); end=range[2]?Math.min(Number(range[2]),end):end;
      if(start>end || start>=stat.size) {res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}); return res.end();}
      status=206; headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length']=end-start+1;
    res.writeHead(status,headers);
    if(req.method==='HEAD') return res.end();
    fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
  } catch(e) { if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Не удалось сохранить историю. Попробуйте ещё раз.'}); else res.destroy(); }
});
server.listen(Number(process.env.PORT||4173),process.env.HOST||'0.0.0.0',()=>console.log(`ТОЧНО ДА → http://localhost:${server.address().port}`));
