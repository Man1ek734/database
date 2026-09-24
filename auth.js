const lssdApiUrl=String((window.LSSD_CONFIG||{}).API_URL||"").replace(/\/$/,"");
state.auth=null;
state.canEdit=false;
state.canDelete=false;
state.editing=null;

function lssdShowLoginToast(message){
  const toast=$("#loginToast");
  if(!toast) return;
  toast.textContent=message;
  toast.classList.remove("hidden");
  clearTimeout(window.__lssdLoginToastTimer);
  window.__lssdLoginToastTimer=setTimeout(()=>toast.classList.add("hidden"),9000);
}

function lssdAuthHeader(){
  const token=localStorage.getItem("lssd_discord_session");
  return token ? {Authorization:"Bearer "+token} : {};
}

function lssdSetLoggedOut(){
  state.auth=null;
  state.canEdit=false;
  state.canDelete=false;
  $("#discordLoginBtn")?.classList.remove("hidden");
  $("#discordLogoutBtn")?.classList.add("hidden");
  $("#userName").textContent="LSSD Database";
  $("#userEmail").textContent="Niezalogowany";
  $("#userRank").textContent="Tylko odczyt";
  const avatar=$("#userAvatar");
  if(avatar){
    avatar.src="assets/lssd-logo.webp";
    avatar.alt="LSSD";
  }
}

function lssdSetLoggedIn(data){
  state.auth=data;
  const managementRanks=["Sheriff","Undersheriff","Assistant Sheriff","Commander"];
  const managementByRank=managementRanks.includes(data.rank);
  state.canEdit=Boolean(data.canEdit || managementByRank);
  state.canDelete=Boolean(data.canDelete || managementByRank);
  $("#discordLoginBtn")?.classList.add("hidden");
  $("#discordLogoutBtn")?.classList.remove("hidden");

  const pseudonym=data.nickname || data.user?.globalName || data.user?.username || "Discord User";
  $("#userName").textContent=pseudonym;
  $("#userEmail").textContent=data.member ? "Los Santos Sheriff's Department" : "Nie jesteś na serwerze LSSD";
  $("#userRank").textContent=data.rank ? data.rank : "Brak rozpoznanej rangi";

  const avatar=$("#userAvatar");
  if(avatar){
    avatar.src=data.memberAvatarUrl || data.user?.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png";
    avatar.alt=pseudonym;
    avatar.onerror=()=>{
      avatar.onerror=null;
      avatar.src="https://cdn.discordapp.com/embed/avatars/0.png";
    };
  }
}

async function lssdRestoreDiscordSession(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,""));
  const loginToken=hash.get("discord_login");
  const incoming=hash.get("discord_session");

  if(loginToken && lssdApiUrl){
    try{
      const claim=await fetch(lssdApiUrl+"/api/claim-login",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token:loginToken})
      });
      const data=await claim.json().catch(()=>({}));
      if(!claim.ok || !data.session) throw new Error(data.error || "login");
      localStorage.setItem("lssd_discord_session",data.session);
    }catch(error){
      console.error("Discord login failed",error);
      lssdShowLoginToast("Link logowania wygasł albo został już użyty. Wpisz ponownie /login na Discordzie.");
    }
    history.replaceState(null,"",location.pathname+location.search);
  }else if(incoming){
    localStorage.setItem("lssd_discord_session",incoming);
    history.replaceState(null,"",location.pathname+location.search);
  }

  const token=localStorage.getItem("lssd_discord_session");
  if(!token || !lssdApiUrl){
    lssdSetLoggedOut();
    return;
  }

  try{
    const res=await fetch(lssdApiUrl+"/api/me",{headers:lssdAuthHeader()});
    if(!res.ok) throw new Error("session");
    lssdSetLoggedIn(await res.json());
  }catch{
    localStorage.removeItem("lssd_discord_session");
    lssdSetLoggedOut();
  }
}

function lssdActionButtons(table,id){
  const wrap=document.createElement("div");
  wrap.className="record-actions";

  if(state.canEdit){
    const edit=document.createElement("button");
    edit.type="button";
    edit.className="edit-btn";
    edit.textContent="Edytuj";
    edit.dataset.editTable=table;
    edit.dataset.editId=id;
    wrap.appendChild(edit);
  }

  if(state.canDelete){
    const del=document.createElement("button");
    del.type="button";
    del.className="delete-btn";
    del.textContent="Usuń";
    del.dataset.deleteTable=table;
    del.dataset.deleteId=id;
    wrap.appendChild(del);
  }

  return wrap.childElementCount ? wrap : null;
}

function lssdDecorateCards(gridSelector,records,table){
  if(!state.canEdit && !state.canDelete) return;
  const cards=$(gridSelector+" .record-card");
  cards.forEach((card,i)=>{
    const row=records[i];
    if(!row || card.querySelector(".record-actions")) return;
    const actions=lssdActionButtons(table,row.id);
    if(actions) card.appendChild(actions);
  });
}

const lssdBaseRenderReports=renderReports;
renderReports=function(){
  lssdBaseRenderReports();
  lssdDecorateCards("#reportsGrid",filteredReports(),"reports");
};

const lssdBaseRenderPromotions=renderPromotions;
renderPromotions=function(){
  lssdBaseRenderPromotions();
  const q=state.query.toLowerCase().trim();
  const rows=state.promotions.filter(p=>!q || [p.officer_name,p.badge_number,p.old_rank,p.new_rank,p.reason,p.promoted_by].join(" ").toLowerCase().includes(q));
  lssdDecorateCards("#promotionsGrid",rows,"promotions");
};

const lssdBaseRenderDemotions=renderDemotions;
renderDemotions=function(){
  lssdBaseRenderDemotions();
  const q=state.query.toLowerCase().trim();
  const rows=state.demotions.filter(p=>!q || [p.officer_name,p.badge_number,p.old_rank,p.new_rank,p.reason,p.demoted_by].join(" ").toLowerCase().includes(q));
  lssdDecorateCards("#demotionsGrid",rows,"demotions");
};

const lssdBaseRenderDismissals=renderDismissals;
renderDismissals=function(){
  lssdBaseRenderDismissals();
  const q=state.query.toLowerCase().trim();
  const rows=state.dismissals.filter(p=>!q || [p.officer_name,p.badge_number,p.rank,p.reason,p.dismissed_by].join(" ").toLowerCase().includes(q));
  lssdDecorateCards("#dismissalsGrid",rows,"dismissals");
};

function lssdSearchRows(){
  const q=normalizeSearch(state.query);
  const rows=[];
  if(!q) return rows;

  state.reports.forEach(r=>{
    if(matchesQuery([r.title,r.subject,r.details,r.badge_number,r.author_discord_name,r.report_type],q)) rows.push({table:"reports",row:r});
  });
  state.promotions.forEach(p=>{
    if(matchesQuery([p.officer_name,p.badge_number,p.old_rank,p.new_rank,p.reason,p.promoted_by,"awans"],q)) rows.push({table:"promotions",row:p});
  });
  state.demotions.forEach(p=>{
    if(matchesQuery([p.officer_name,p.badge_number,p.old_rank,p.new_rank,p.reason,p.demoted_by,"degradacja"],q)) rows.push({table:"demotions",row:p});
  });
  state.dismissals.forEach(p=>{
    if(matchesQuery([p.officer_name,p.badge_number,p.rank,p.reason,p.dismissed_by,"zwolnienie"],q)) rows.push({table:"dismissals",row:p});
  });
  state.resignations.forEach(p=>{
    if(matchesQuery([p.officer_name,p.badge_number,p.rank,p.reason,p.submitted_by,p.end_date,"wypowiedzenie"],q)) rows.push({table:"resignations",row:p});
  });
  return rows;
}

const lssdBaseRenderSearchResults=renderSearchResults;
renderSearchResults=function(){
  lssdBaseRenderSearchResults();
  if(!state.canEdit && !state.canDelete) return;
  const rows=lssdSearchRows();
  const cards=$("#searchResultsGrid .record-card");
  cards.forEach((card,i)=>{
    const item=rows[i];
    if(!item || card.querySelector(".record-actions")) return;
    const actions=lssdActionButtons(item.table,item.row.id);
    if(actions) card.appendChild(actions);
  });
};

const LSSD_EDIT_FIELDS={
  reports:[
    ["report_type","Typ raportu","select",["DTU","SERT","IAD","DEPUTY"]],
    ["title","Tytuł","text"],["subject","Dotyczy","text"],["badge_number","Numer odznaki","text"],["details","Treść raportu","textarea"]
  ],
  promotions:[
    ["officer_name","Imię i nazwisko","text"],["badge_number","Numer odznaki","text"],["old_rank","Poprzednia ranga","text"],["new_rank","Nowa ranga","text"],["reason","Uzasadnienie","textarea"]
  ],
  demotions:[
    ["officer_name","Imię i nazwisko","text"],["badge_number","Numer odznaki","text"],["old_rank","Poprzednia ranga","text"],["new_rank","Nowa ranga","text"],["reason","Uzasadnienie","textarea"]
  ],
  dismissals:[
    ["officer_name","Imię i nazwisko","text"],["badge_number","Numer odznaki","text"],["rank","Ranga","text"],["reason","Uzasadnienie","textarea"]
  ],
  resignations:[
    ["officer_name","Imię i nazwisko","text"],["badge_number","Numer odznaki","text"],["rank","Ranga","text"],["end_date","Ostatni dzień służby","text"],["reason","Powód / treść wypowiedzenia","textarea"]
  ]
};

async function lssdDeleteRecord(table,id){
  if(!state.canDelete) return;

  const row=lssdGetRow(table,id);
  const label=row?.title || row?.officer_name || "ten wpis";
  if(!window.confirm("Na pewno usunąć: "+label+"?")) return;

  const res=await fetch(lssdApiUrl+"/api/delete",{
    method:"POST",
    headers:{"Content-Type":"application/json",...lssdAuthHeader()},
    body:JSON.stringify({table,id})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    lssdShowLoginToast(data.error || "Nie udało się usunąć wpisu.");
    return;
  }

  const list=state[table]||[];
  const i=list.findIndex(x=>x.id===id);
  if(i>=0) list.splice(i,1);
  renderAll();
  lssdShowLoginToast("Wpis został usunięty.");
}

function lssdGetRow(table,id){
  return (state[table]||[]).find(x=>x.id===id);
}

function lssdOpenEdit(table,id){
  if(!state.canEdit) return;
  const row=lssdGetRow(table,id);
  const defs=LSSD_EDIT_FIELDS[table];
  if(!row || !defs) return;

  state.editing={table,id};
  $("#editModalTitle").textContent="Edytuj wpis";
  $("#editMessage").textContent="";
  $("#editFields").innerHTML="";

  for(const def of defs){
    const [key,label,type,options]=def;
    const wrapper=document.createElement("label");
    wrapper.className="edit-label";
    wrapper.append(document.createTextNode(label));
    let input;

    if(type==="textarea"){
      input=document.createElement("textarea");
      input.rows=5;
      input.value=String(row[key]??"");
    }else if(type==="select"){
      input=document.createElement("select");
      for(const option of options){
        const el=document.createElement("option");
        el.value=option;
        el.textContent=option;
        if(option===String(row[key]??"")) el.selected=true;
        input.appendChild(el);
      }
    }else{
      input=document.createElement("input");
      input.value=String(row[key]??"");
    }

    input.dataset.editField=key;
    wrapper.appendChild(input);
    $("#editFields").appendChild(wrapper);
  }

  $("#editModal").classList.remove("hidden");
}

function lssdCloseEdit(){
  state.editing=null;
  $("#editModal").classList.add("hidden");
  $("#editFields").innerHTML="";
  $("#editMessage").textContent="";
}

async function lssdSaveEdit(){
  if(!state.editing || !state.canEdit) return;
  const table=state.editing.table;
  const id=state.editing.id;
  const changes={};
  $$("#editFields [data-edit-field]").forEach(el=>changes[el.dataset.editField]=el.value);

  $("#editMessage").textContent="Zapisywanie...";
  const res=await fetch(lssdApiUrl+"/api/update",{
    method:"POST",
    headers:{"Content-Type":"application/json",...lssdAuthHeader()},
    body:JSON.stringify({table,id,changes})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    $("#editMessage").textContent=data.error || "Nie udało się zapisać zmian.";
    return;
  }

  const list=state[table]||[];
  const i=list.findIndex(x=>x.id===id);
  if(i>=0) list[i]=data.row;
  renderAll();
  lssdCloseEdit();
}

$("#discordLoginBtn")?.addEventListener("click",()=>{
  if(!lssdApiUrl){
    lssdShowLoginToast("Logowanie Discord jest chwilowo niedostępne.");
    return;
  }
  location.href=lssdApiUrl+"/auth/discord";
});
$("#discordLogoutBtn")?.addEventListener("click",()=>{
  localStorage.removeItem("lssd_discord_session");
  lssdSetLoggedOut();
  renderAll();
});
$("#closeEditModal")?.addEventListener("click",lssdCloseEdit);
$("#cancelEditBtn")?.addEventListener("click",lssdCloseEdit);
$("#editModal")?.addEventListener("click",e=>{if(e.target.id==="editModal")lssdCloseEdit()});
$("#editForm")?.addEventListener("submit",async e=>{e.preventDefault();await lssdSaveEdit()});

document.addEventListener("click",e=>{
  const edit=e.target.closest("[data-edit-table]");
  if(edit){
    lssdOpenEdit(edit.dataset.editTable,edit.dataset.editId);
    return;
  }

  const del=e.target.closest("[data-delete-table]");
  if(del){
    lssdDeleteRecord(del.dataset.deleteTable,del.dataset.deleteId);
  }
});

lssdRestoreDiscordSession().then(()=>renderAll());
