import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const LSSD_RANKS=[
  "Sheriff","Undersheriff","Assistant Sheriff","Commander",
  "Captain II","Captain I","Lieutenant II","Lieutenant I",
  "Sergeant II","Sergeant I","Corporal II","Corporal I",
  "Deputy Sheriff III","Deputy Sheriff II","Deputy Sheriff I","Deputy Sheriff Trainee"
];

const EDIT_FIELDS={
  reports:["report_type","title","subject","details","badge_number"],
  promotions:["officer_name","badge_number","old_rank","new_rank","reason"],
  demotions:["officer_name","badge_number","old_rank","new_rank","reason"],
  dismissals:["officer_name","badge_number","rank","reason"],
  resignations:["officer_name","badge_number","rank","end_date","reason"]
};

const SESSION_TTL_SECONDS=7*24*60*60;
const roleCache={expires:0,roles:[]};

function settings(){
  const webAppUrl=process.env.WEB_APP_URL || "https://man1ek734.github.io/database/";
  const publicBaseUrl=process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  return {webAppUrl,publicBaseUrl,webOrigin:new URL(webAppUrl).origin};
}

function signValue(value){
  if(!process.env.BOT_WRITE_SECRET) throw new Error("Brak BOT_WRITE_SECRET");
  return createHmac("sha256",process.env.BOT_WRITE_SECRET).update(value).digest("base64url");
}

function createSession(user){
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({
    sub:user.id,
    username:user.username,
    globalName:user.global_name || user.globalName || user.username,
    avatar:user.avatar || null,
    iat:now,
    exp:now+SESSION_TTL_SECONDS
  })).toString("base64url");
  return payload+"."+signValue(payload);
}

function verifySession(token){
  if(!token || !token.includes(".")) return null;
  const parts=token.split(".");
  const payload=parts[0];
  const sig=parts[1];
  const expected=signValue(payload);
  const a=Buffer.from(sig || "");
  const b=Buffer.from(expected);
  if(a.length!==b.length || !timingSafeEqual(a,b)) return null;
  try{
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!data.exp || data.exp<Math.floor(Date.now()/1000)) return null;
    return data;
  }catch{return null}
}

function parseCookies(header=""){
  const result={};
  for(const raw of header.split(";")){
    const item=raw.trim();
    if(!item) continue;
    const i=item.indexOf("=");
    if(i<0) continue;
    result[decodeURIComponent(item.slice(0,i))]=decodeURIComponent(item.slice(i+1));
  }
  return result;
}

function getBearer(req){
  const h=req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function sendJson(res,status,data,origin,webOrigin){
  if(origin===webOrigin){
    res.setHeader("Access-Control-Allow-Origin",webOrigin);
    res.setHeader("Vary","Origin");
  }
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.statusCode=status;
  res.end(JSON.stringify(data));
}

async function readJson(req){
  let body="";
  for await(const chunk of req){
    body+=chunk;
    if(body.length>100000) throw new Error("Payload too large");
  }
  return body ? JSON.parse(body) : {};
}

function discordAvatarUrl(userId,hash,guildId=null){
  if(hash){
    const ext=hash.startsWith("a_") ? "gif" : "png";
    if(guildId){
      return "https://cdn.discordapp.com/guilds/"+guildId+"/users/"+userId+"/avatars/"+hash+"."+ext+"?size=128";
    }
    return "https://cdn.discordapp.com/avatars/"+userId+"/"+hash+"."+ext+"?size=128";
  }

  let index=0;
  try{
    index=Number((BigInt(userId)>>22n)%6n);
  }catch{}
  return "https://cdn.discordapp.com/embed/avatars/"+index+".png";
}

function normalizeRoleName(value=""){
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function detectLssdRank(roleNames){
  // Dokładne rangi z serwera LSSD. Ozdobniki Discorda są usuwane przez normalizeRoleName().
  const exactRanks=[
    "Sheriff",
    "Undersheriff",
    "Assistant Sheriff",
    "Commander",
    "Captain II",
    "Captain I",
    "Lieutenant II",
    "Lieutenant I",
    "Sergeant II",
    "Sergeant I",
    "Corporal II",
    "Corporal I",
    "Deputy Sheriff III",
    "Deputy Sheriff II",
    "Deputy Sheriff I",
    "Deputy Sheriff Trainee"
  ];

  const normalizedToRank=new Map(
    exactRanks.map(rank=>[normalizeRoleName(rank),rank])
  );

  const found=[];
  for(const rawRole of roleNames){
    const normalized=normalizeRoleName(rawRole);
    const rank=normalizedToRank.get(normalized);
    if(rank) found.push(rank);
  }

  if(!found.length) return null;

  const hierarchyIndex=new Map(exactRanks.map((rank,index)=>[rank,index]));
  found.sort((a,b)=>(hierarchyIndex.get(a)??999)-(hierarchyIndex.get(b)??999));
  return found[0];
}

function cleanServerNickname(value=""){
  return String(value)
    .replace(/^\s*\[[^\]]+\]\s*/,"")
    .replace(/^\s*\([^\)]+\)\s*/,"")
    .trim();
}

async function getGuildRoles(){
  if(Date.now()<roleCache.expires && roleCache.roles.length) return roleCache.roles;
  const url="https://discord.com/api/v10/guilds/"+process.env.DISCORD_GUILD_ID+"/roles";
  const res=await fetch(url,{headers:{Authorization:"Bot "+process.env.DISCORD_TOKEN}});
  if(!res.ok) throw new Error("Discord roles "+res.status);
  roleCache.roles=await res.json();
  roleCache.expires=Date.now()+5*60*1000;
  return roleCache.roles;
}

async function getMemberPermissions(userId){
  const url="https://discord.com/api/v10/guilds/"+process.env.DISCORD_GUILD_ID+"/members/"+userId;
  const memberRes=await fetch(url,{headers:{Authorization:"Bot "+process.env.DISCORD_TOKEN}});
  if(memberRes.status===404) return {member:false,roles:[],rank:null,canEdit:false};
  if(!memberRes.ok) throw new Error("Discord member "+memberRes.status);
  const member=await memberRes.json();
  const guildRoles=await getGuildRoles();
  const names=member.roles.map(id=>{
    const role=guildRoles.find(r=>r.id===id);
    return role ? role.name : null;
  }).filter(Boolean);
  const detectedRank=detectLssdRank(names);
  const normalizedRoles=names.map(normalizeRoleName);
  const isHighCommand=normalizedRoles.some(role=>
    role==="high command" ||
    role==="high comend" ||
    role.includes("high command") ||
    role.includes("high comend") ||
    role==="hc"
  );

  const avatarUrl = member.avatar
    ? discordAvatarUrl(userId,member.avatar,process.env.DISCORD_GUILD_ID)
    : discordAvatarUrl(userId,member.user?.avatar || null);

  return {
    member:true,
    roles:names,
    rank:detectedRank,
    isHighCommand,
    canEdit:isHighCommand,
    canDelete:isHighCommand,
    nickname:cleanServerNickname(member.nick || member.user?.global_name || member.user?.username || ""),
    memberAvatarUrl:avatarUrl
  };
}

export function startWebApi({writeRecord}){
  const {webAppUrl,publicBaseUrl,webOrigin}=settings();

  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin || null;
    try{
      const url=new URL(req.url || "/",publicBaseUrl);

      if(req.method==="OPTIONS"){
        if(origin===webOrigin){
          res.setHeader("Access-Control-Allow-Origin",webOrigin);
          res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
          res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
          res.setHeader("Vary","Origin");
        }
        res.statusCode=204;
        res.end();
        return;
      }

      if(url.pathname==="/health"){
        sendJson(res,200,{ok:true},origin,webOrigin);
        return;
      }

      if(url.pathname==="/auth/discord"){
        const state=randomBytes(24).toString("base64url");
        const redirectUri=publicBaseUrl+"/auth/discord/callback";
        const auth=new URL("https://discord.com/oauth2/authorize");
        auth.searchParams.set("client_id",process.env.DISCORD_CLIENT_ID);
        auth.searchParams.set("response_type","token");
        auth.searchParams.set("redirect_uri",redirectUri);
        auth.searchParams.set("scope","identify");
        auth.searchParams.set("state",state);
        auth.searchParams.set("prompt","consent");

        res.setHeader("Set-Cookie","oauth_state="+encodeURIComponent(state)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600");
        res.statusCode=302;
        res.setHeader("Location",auth.toString());
        res.end();
        return;
      }

      if(url.pathname==="/auth/discord/callback"){
        const cookies=parseCookies(req.headers.cookie || "");
        const expectedState=String(cookies.oauth_state || "");
        const target=JSON.stringify(webAppUrl);
        const expected=JSON.stringify(expectedState);

        res.statusCode=200;
        res.setHeader("Content-Type","text/html; charset=utf-8");
        res.setHeader("Cache-Control","no-store");
        res.setHeader("Set-Cookie","oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
        res.end(`<!doctype html>
<html lang="pl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logowanie Discord</title></head>
<body style="font-family:system-ui;background:#090d15;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0">
<div id="msg">Logowanie przez Discord...</div>
<script>
(async()=>{
  const params=new URLSearchParams(location.hash.slice(1));
  const expected=${expected};
  const state=params.get("state")||"";
  const token=params.get("access_token")||"";
  const msg=document.getElementById("msg");

  if(!token || !expected || state!==expected){
    msg.textContent="Nie udało się zweryfikować logowania Discord.";
    return;
  }

  try{
    const r=await fetch("/api/discord-login",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({access_token:token})
    });
    const data=await r.json();
    if(!r.ok || !data.session) throw new Error(data.error||"Błąd logowania");
    location.replace(${target}+"#discord_session="+encodeURIComponent(data.session));
  }catch(e){
    msg.textContent="Nie udało się zalogować przez Discord. Spróbuj ponownie.";
  }
})();
</script>
</body>
</html>`);
        return;
      }

      if(url.pathname==="/api/discord-login" && req.method==="POST"){
        const body=await readJson(req);
        const accessToken=String(body.access_token || "");
        if(!accessToken){
          sendJson(res,400,{error:"Brak tokenu Discord."},origin,webOrigin);
          return;
        }

        const userRes=await fetch("https://discord.com/api/v10/users/@me",{
          headers:{Authorization:"Bearer "+accessToken}
        });
        if(!userRes.ok){
          sendJson(res,401,{error:"Nieprawidłowe logowanie Discord."},origin,webOrigin);
          return;
        }

        const user=await userRes.json();
        const session=createSession(user);
        sendJson(res,200,{session},origin,webOrigin);
        return;
      }

      if(url.pathname==="/api/me" && req.method==="GET"){
        const session=verifySession(getBearer(req));
        if(!session){
          sendJson(res,401,{authenticated:false},origin,webOrigin);
          return;
        }
        const perms=await getMemberPermissions(session.sub);
        const userAvatarUrl=discordAvatarUrl(session.sub,session.avatar || null);
        sendJson(res,200,{
          authenticated:true,
          user:{
            id:session.sub,
            username:session.username,
            globalName:session.globalName,
            avatar:session.avatar,
            avatarUrl:userAvatarUrl
          },
          ...perms
        },origin,webOrigin);
        return;
      }

      if(url.pathname==="/api/update" && req.method==="POST"){
        const session=verifySession(getBearer(req));
        if(!session){
          sendJson(res,401,{error:"Musisz zalogowac sie przez Discord."},origin,webOrigin);
          return;
        }
        const perms=await getMemberPermissions(session.sub);
        if(!perms.canEdit){
          sendJson(res,403,{error:"Tylko High Command może edytować wpisy."},origin,webOrigin);
          return;
        }
        const body=await readJson(req);
        const table=body.table;
        const id=body.id;
        const changes=body.changes;
        const allowed=EDIT_FIELDS[table];
        if(!allowed || !id || !changes || typeof changes!=="object" || Array.isArray(changes)){
          sendJson(res,400,{error:"Nieprawidlowe dane."},origin,webOrigin);
          return;
        }
        const clean={};
        for(const key of allowed){
          if(Object.prototype.hasOwnProperty.call(changes,key)){
            clean[key]=typeof changes[key]==="string" ? changes[key].trim() : changes[key];
          }
        }
        if(!Object.keys(clean).length){
          sendJson(res,400,{error:"Brak pol do zmiany."},origin,webOrigin);
          return;
        }
        const row=await writeRecord("update",table,clean,id);
        sendJson(res,200,{ok:true,row,rank:perms.rank},origin,webOrigin);
        return;
      }

      if(url.pathname==="/api/delete" && req.method==="POST"){
        const session=verifySession(getBearer(req));
        if(!session){
          sendJson(res,401,{error:"Musisz zalogowac sie przez Discord."},origin,webOrigin);
          return;
        }

        const perms=await getMemberPermissions(session.sub);
        if(!perms.canDelete){
          sendJson(res,403,{error:"Tylko High Command może usuwać wpisy."},origin,webOrigin);
          return;
        }

        const body=await readJson(req);
        const table=body.table;
        const id=body.id;
        if(!EDIT_FIELDS[table] || !id){
          sendJson(res,400,{error:"Nieprawidlowe dane."},origin,webOrigin);
          return;
        }

        await writeRecord("delete",table,{},id);
        sendJson(res,200,{ok:true},origin,webOrigin);
        return;
      }

      sendJson(res,404,{error:"Not found"},origin,webOrigin);
    }catch(error){
      console.error("HTTP API error",error);
      sendJson(res,500,{error:"Blad serwera."},origin,webOrigin);
    }
  });

  server.listen(3000,"0.0.0.0",()=>{
    console.log("LSSD web API listening on port 3000");
  });
}
