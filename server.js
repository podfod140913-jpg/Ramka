// Рамка: сервер без зависимостей. Нужен Node.js 18+. Запуск: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000;
const DB=path.join(process.env.DATA_DIR||__dirname,'data.json');
let db={users:{},sessions:{}};
try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch(e){}
const save=()=>{fs.writeFileSync(DB+'.tmp',JSON.stringify(db));fs.renameSync(DB+'.tmp',DB)};
const rnd=n=>crypto.randomBytes(n).toString('hex');
const hash=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const same=(a,b)=>{a=Buffer.from(a);b=Buffer.from(b);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const send=(res,code,body,type='application/json',h={})=>{res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',...h});res.end(typeof body==='string'?body:JSON.stringify(body))};
const readBody=req=>new Promise((ok,no)=>{let s='';req.on('data',c=>{s+=c;if(s.length>10000){no(new Error('big'));req.destroy()}});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}})});
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(c=>c.trim().split('=')).filter(p=>p[0]));
const authUser=req=>{const s=db.sessions[cookies(req).sid];return s&&s.exp>Date.now()?db.users[s.uid]||null:null};
const tries={};
const limited=ip=>{const now=Date.now(),t=(tries[ip]=(tries[ip]||[]).filter(x=>now-x<600000));if(t.length>=15)return true;t.push(now);return false};
const startSession=(uid,req)=>{const sid=rnd(24);db.sessions[sid]={uid,exp:Date.now()+30*864e5};save();
 return{'Set-Cookie':`sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`}};
const pub=(u,req)=>({email:u.email,nick:u.nick,color:u.color,hasKey:!!u.faceitKey,
 overlayUrl:(req.headers['x-forwarded-proto']||'http')+'://'+req.headers.host+'/o/'+u.token});

// Запрос к FACEIT идёт с сервера, ключ пользователя в браузер не попадает
const cache={};
async function stats(u){
 if(!u.faceitKey)return{error:'Подключите FACEIT API'};
 if(!u.nick)return{error:'Укажите ник на FACEIT'};
 const k=u.faceitKey+u.nick,c=cache[u.id];
 if(c&&c.k===k&&Date.now()-c.t<30000)return c.v;
 let v;
 try{
  const r=await fetch('https://open.faceit.com/data/v4/players?nickname='+encodeURIComponent(u.nick),
   {headers:{Authorization:'Bearer '+u.faceitKey},signal:AbortSignal.timeout(8000)});
  if(r.status===404)v={error:'Игрок не найден'};
  else if(r.status===401||r.status===403)v={error:'Неверный API-ключ'};
  else if(!r.ok)v={error:'FACEIT ответил ошибкой '+r.status};
  else{const j=await r.json(),g=j.games||{},x=g.cs2||g.csgo;
   v=x?{nick:j.nickname,level:x.skill_level,elo:x.faceit_elo}:{error:'У игрока нет CS2 на FACEIT'}}
 }catch(e){v={error:'Не удалось связаться с FACEIT'}}
 cache[u.id]={t:Date.now(),k,v};return v;
}

const overlay=(t,c)=>`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Рамка</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@800&family=Unbounded:wght@800&display=swap" rel="stylesheet">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.bar{height:100%;box-sizing:border-box;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:0 20px;border-radius:14px;background:#1c1a35;border:3px solid ${c};color:#fff;font:800 28px Manrope,sans-serif}
.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.e{text-align:right;font:800 26px Unbounded,sans-serif}.e small{font-size:.55em;opacity:.7;margin-left:4px}svg{width:64px;height:64px}</style></head>
<body><div class="bar"><div class="n" id="n"></div><svg id="l" viewBox="0 0 44 44"></svg><div class="e"><span id="e"></span><small>ELO</small></div></div>
<script src="/lvl.js"></script><script>
function go(){fetch('/o/${t}/data').then(function(r){return r.json()}).then(function(d){if(d.error)return;
document.getElementById('n').textContent=d.nick;document.getElementById('l').innerHTML=lvlSvg(d.level);document.getElementById('e').textContent=d.elo}).catch(function(){})}
go();setInterval(go,30000);</script></body></html>`;

http.createServer(async(req,res)=>{
 try{
  const p=new URL(req.url,'http://x').pathname;
  const ip=(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress;
  if(req.method==='GET'){
    if(p==='/admin'){
    const k=new URL(req.url,'http://x').searchParams.get('key')||'';
    if(!process.env.ADMIN_KEY||!same(k,process.env.ADMIN_KEY))return send(res,404,{error:'Не найдено'});
    return send(res,200,Object.values(db.users).map(u=>({email:u.email,nick:u.nick,hasKey:!!u.faceitKey})));
   }
   if(p==='/')return send(res,200,fs.readFileSync(path.join(__dirname,'public/index.html'),'utf8'),'text/html');
   if(p==='/lvl.js')return send(res,200,fs.readFileSync(path.join(__dirname,'public/lvl.js'),'utf8'),'application/javascript');
   const m=p.match(/^\/o\/([a-f0-9]{32})(\/data)?$/);
   if(m){const u=Object.values(db.users).find(x=>x.token===m[1]);
    if(!u)return send(res,404,{error:'Не найдено'});
    return m[2]?send(res,200,await stats(u)):send(res,200,overlay(m[1],u.color),'text/html')}
   if(p==='/api/me'||p==='/api/preview'){
    const u=authUser(req);if(!u)return send(res,401,{error:'Нужен вход'});
    return send(res,200,p==='/api/me'?pub(u,req):await stats(u))}
   return send(res,404,{error:'Не найдено'});
  }
  if(req.method!=='POST')return send(res,405,{error:'Метод не поддерживается'});
  if(!(req.headers['content-type']||'').includes('application/json'))return send(res,415,{error:'Неверный формат'});
  const b=await readBody(req);
  if(p==='/api/register'||p==='/api/login'){
   if(limited(ip))return send(res,429,{error:'Слишком много попыток, подождите 10 минут'});
   const email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>100)return send(res,400,{error:'Проверьте почту'});
   let u=Object.values(db.users).find(x=>x.email===email);
   if(p==='/api/register'){
    if(pw.length<8)return send(res,400,{error:'Пароль минимум 8 символов'});
    if(u)return send(res,409,{error:'Эта почта уже зарегистрирована'});
    const salt=rnd(16);
    u=db.users[rnd(8)]={email,salt,hash:hash(pw,salt),token:rnd(16),color:'#ff5500',nick:'',faceitKey:''};
    u.id=Object.keys(db.users).find(k=>db.users[k]===u);
   }else if(!u||!same(u.hash,hash(pw,u.salt)))return send(res,401,{error:'Неверная почта или пароль'});
   return send(res,200,pub(u,req),'application/json',startSession(u.id,req));
  }
  const u=authUser(req);
  if(!u)return send(res,401,{error:'Нужен вход'});
  if(p==='/api/logout'){delete db.sessions[cookies(req).sid];save();return send(res,200,{ok:1},'application/json',{'Set-Cookie':'sid=; Max-Age=0; Path=/'})}
  if(p==='/api/settings'){
   if(typeof b.faceitKey==='string'&&b.faceitKey.trim())u.faceitKey=b.faceitKey.trim().slice(0,100);
   if(b.faceitKey===null)u.faceitKey='';
   if(typeof b.nick==='string')u.nick=b.nick.trim().slice(0,40);
   if(typeof b.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(b.color))u.color=b.color;
   save();return send(res,200,pub(u,req));
  }
  send(res,404,{error:'Не найдено'});
 }catch(e){send(res,500,{error:'Ошибка сервера'})}
}).listen(PORT,()=>console.log('Рамка запущена: http://localhost:'+PORT));
