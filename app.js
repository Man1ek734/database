const cfg = window.LSSD_CONFIG || {};
const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabaseClient = configured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const state={reports:[],promotions:[],demotions:[],dismissals:[],resignations:[],currentView:"dashboard",lastNonSearchView:"dashboard",forcedType:"ALL",query:""};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmt=d=>new Intl.DateTimeFormat("pl-PL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(d));
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const normalizeSearch=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const reportTypeLabel=t=>t==="WEAPON_LOSS"?"UTRATA BRONI":t==="DEPUTY"?"RAPORT ZASTĘPCY":t==="SUSPENSION"?"ZAWIESZENIE":t==="VACATION"?"URLOP":t==="PLUS"?"PLUS":t==="MINUS"?"MINUS":t;
const matchesQuery=(values,q)=>{
  if(!q) return true;
  const hay=normalizeSearch(values.join(" "));
  const tokens=q.split(/\s+/).filter(Boolean);
  return tokens.every(token=>hay.includes(token));
};

async function boot(){
  await loadData();
}

async function loadData(){
  if(!configured){renderAll();return}
  const [
    {data:reports,error:re},
    {data:promotions,error:pe},
    {data:demotions,error:de},
    {data:dismissals,error:di},
    {data:resignations,error:ri}
  ] = await Promise.all([
    supabaseClient.from("reports").select("*").order("created_at",{ascending:false}),
    supabaseClient.from("promotions").select("*").order("created_at",{ascending:false}),
    supabaseClient.from("demotions").select("*").order("created_at",{ascending:false}),
    supabaseClient.from("dismissals").select("*").order("created_at",{ascending:false}),
    supabaseClient.from("resignations").select("*").order("created_at",{ascending:false})
  ]);
  if(re||pe||de||di||ri){
    console.error(re||pe||de||di);
    return;
  }
  state.reports=reports||[];
  state.promotions=promotions||[];
  state.demotions=demotions||[];
  state.dismissals=dismissals||[];
  state.resignations=resignations||[];
  renderAll();
}

function renderAll(){
  const reportCount=type=>state.reports.filter(r=>r.report_type===type).length;
  $("#statAllEntries").textContent=
    state.reports.length+
    state.promotions.length+
    state.demotions.length+
    state.dismissals.length+
    state.resignations.length;

  $("#statReports").textContent=state.reports.length;
  $("#statDtu").textContent=reportCount("DTU");
  $("#statSert").textContent=reportCount("SERT");
  $("#statIad").textContent=reportCount("IAD");
  $("#statDeputy").textContent=reportCount("DEPUTY");
  $("#statWeaponLoss").textContent=reportCount("WEAPON_LOSS");
  $("#statSuspensions").textContent=reportCount("SUSPENSION");
  $("#statVacation").textContent=reportCount("VACATION");
  $("#statPlus").textContent=reportCount("PLUS");
  $("#statMinus").textContent=reportCount("MINUS");
  $("#statPromotions").textContent=state.promotions.length;
  $("#statDemotions").textContent=state.demotions.length;
  $("#statDismissals").textContent=state.dismissals.length;
  $("#statResignations").textContent=state.resignations.length;

  $("#recentReports").innerHTML=state.reports.slice(0,5).map(r=>`
    <div class="compact-item">
      <div><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.subject||"—")} • ${fmt(r.created_at)}</small></div>
      <span class="type-badge">${escapeHtml(r.report_type)}</span>
    </div>`).join("") || '<div class="empty">Brak raportów.</div>';

  $("#recentPromotions").innerHTML=state.promotions.slice(0,5).map(p=>`
    <div class="compact-item">
      <div><strong>${escapeHtml(p.officer_name)}</strong><small>${escapeHtml(p.old_rank)} → ${escapeHtml(p.new_rank)}</small></div>
      <span class="type-badge">${escapeHtml(p.badge_number||"—")}</span>
    </div>`).join("") || '<div class="empty">Brak awansów.</div>';

  renderReports();
  renderPromotions();
  renderDemotions();
  renderDismissals();
  renderResignations();
  renderSearchResults();
}

function filteredReports(){
  const selectType=$("#reportTypeFilter")?.value || "ALL";
  const type=state.forcedType!=="ALL" ? state.forcedType : selectType;
  const q=state.query.toLowerCase().trim();
  return state.reports.filter(r=>{
    const matchesType=type==="ALL" || r.report_type===type;
    const hay=[r.title,r.subject,r.details,r.badge_number,r.author_discord_name,r.report_type].join(" ").toLowerCase();
    return matchesType && (!q || hay.includes(q));
  });
}

function renderReports(){
  const list=filteredReports();
  $("#reportsGrid").innerHTML=list.map(r=>`
    <article class="record-card">
      <div class="record-top">
        <div><span class="type-badge">${escapeHtml(reportTypeLabel(r.report_type))}</span></div>
        <small class="muted">${fmt(r.created_at)}</small>
      </div>
      <h3>${escapeHtml(r.title)}</h3>
      <p><strong>Dotyczy:</strong> ${escapeHtml(r.subject||"—")}</p>
      <p>${escapeHtml(r.details||"Brak opisu.")}</p>
      <div class="record-meta">
        <span>Odznaka: ${escapeHtml(r.badge_number||"—")}</span>
        <span>Autor: ${escapeHtml(r.author_discord_name||"—")}</span>
        <span>ID: ${escapeHtml(r.id)}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak pasujących raportów.</div>';
}

function renderPromotions(){
  const q=state.query.toLowerCase().trim();
  const list=state.promotions.filter(p=>!q || [p.officer_name,p.old_rank,p.new_rank,p.reason,p.promoted_by,p.decision_date].join(" ").toLowerCase().includes(q));
  $("#promotionsGrid").innerHTML=list.map(p=>`
    <article class="record-card">
      <div class="record-top">
        <div><span class="type-badge">PROMOTION</span></div>
        <small class="muted">${fmt(p.created_at)}</small>
      </div>
      <h3>${escapeHtml(p.officer_name)}</h3>
      <div class="promotion-rank">${escapeHtml(p.old_rank)} <b>→</b> ${escapeHtml(p.new_rank)}</div>
      <p>${escapeHtml(p.reason||"Brak uzasadnienia.")}</p>
      <div class="record-meta">
        <span>Decyzję wydał: ${escapeHtml(p.promoted_by||"—")}</span>
        <span>Data: ${escapeHtml(p.decision_date||"—")}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak pasujących awansów.</div>';
}

function renderDemotions(){
  const q=state.query.toLowerCase().trim();
  const list=state.demotions.filter(p=>!q || [p.officer_name,p.old_rank,p.new_rank,p.reason,p.demoted_by,p.decision_date].join(" ").toLowerCase().includes(q));
  $("#demotionsGrid").innerHTML=list.map(p=>`
    <article class="record-card">
      <div class="record-top">
        <div><span class="type-badge">DEMOTION</span></div>
        <small class="muted">${fmt(p.created_at)}</small>
      </div>
      <h3>${escapeHtml(p.officer_name)}</h3>
      <div class="promotion-rank">${escapeHtml(p.old_rank)} <b>→</b> ${escapeHtml(p.new_rank)}</div>
      <p>${escapeHtml(p.reason||"Brak uzasadnienia.")}</p>
      <div class="record-meta">
        <span>Decyzję wydał: ${escapeHtml(p.demoted_by||"—")}</span>
        <span>Data: ${escapeHtml(p.decision_date||"—")}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak degradacji.</div>';
}

function renderDismissals(){
  const q=state.query.toLowerCase().trim();
  const list=state.dismissals.filter(p=>!q || [p.officer_name,p.rank,p.reason,p.dismissed_by,p.dismissal_date].join(" ").toLowerCase().includes(q));
  $("#dismissalsGrid").innerHTML=list.map(p=>`
    <article class="record-card">
      <div class="record-top">
        <div><span class="type-badge">DISMISSAL</span></div>
        <small class="muted">${fmt(p.created_at)}</small>
      </div>
      <h3>${escapeHtml(p.officer_name)}</h3>
      <div class="promotion-rank">${escapeHtml(p.rank||"—")} <b>→</b> ZWOLNIONY</div>
      <p>${escapeHtml(p.reason||"Brak uzasadnienia.")}</p>
      <div class="record-meta">
        <span>Decyzję wydał: ${escapeHtml(p.dismissed_by||"—")}</span>
        <span>Data zwolnienia: ${escapeHtml(p.dismissal_date||"—")}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak zwolnień.</div>';
}

function renderResignations(){
  const q=state.query.toLowerCase().trim();
  const list=state.resignations.filter(p=>!q || [p.officer_name,p.rank,p.reason,p.submitted_date,p.end_date].join(" ").toLowerCase().includes(q));
  $("#resignationsGrid").innerHTML=list.map(p=>`
    <article class="record-card">
      <div class="record-top">
        <div><span class="type-badge">RESIGNATION</span></div>
        <small class="muted">${fmt(p.created_at)}</small>
      </div>
      <h3>${escapeHtml(p.officer_name)}</h3>
      <div class="promotion-rank">${escapeHtml(p.rank||"—")} <b>→</b> WYPOWIEDZENIE</div>
      <p>${escapeHtml(p.reason||"Brak powodu.")}</p>
      <div class="record-meta">
        <span>Data złożenia: ${escapeHtml(p.submitted_date||"—")}</span>
        <span>Planowane zakończenie: ${escapeHtml(p.end_date||"—")}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak wypowiedzeń.</div>';
}

function renderSearchResults(){
  const grid=$("#searchResultsGrid");
  const summary=$("#searchSummary");
  if(!grid || !summary) return;

  const q=normalizeSearch(state.query);
  if(!q){
    summary.textContent="Wpisz frazę w wyszukiwarce.";
    grid.innerHTML='<div class="empty">Brak aktywnego wyszukiwania.</div>';
    return;
  }

  const results=[];

  state.reports.forEach(r=>{
    if(matchesQuery([r.title,r.subject,r.details,r.badge_number,r.author_discord_name,r.report_type],q)){
      results.push({
        type:`RAPORT • ${reportTypeLabel(r.report_type)}`,
        title:r.title,
        subtitle:r.subject || "—",
        description:r.details || "Brak opisu.",
        meta:[`Odznaka: ${r.badge_number||"—"}`,`Autor: ${r.author_discord_name||"—"}`,fmt(r.created_at)]
      });
    }
  });

  state.promotions.forEach(p=>{
    if(matchesQuery([p.officer_name,p.old_rank,p.new_rank,p.reason,p.promoted_by,p.decision_date,"awans"],q)){
      results.push({
        type:"AWANS",
        title:p.officer_name,
        subtitle:`${p.old_rank} → ${p.new_rank}`,
        description:p.reason || "Brak uzasadnienia.",
        meta:[`Decyzję wydał: ${p.promoted_by||"—"}`,`Data: ${p.decision_date||"—"}`,fmt(p.created_at)]
      });
    }
  });

  state.demotions.forEach(p=>{
    if(matchesQuery([p.officer_name,p.old_rank,p.new_rank,p.reason,p.demoted_by,p.decision_date,"degradacja"],q)){
      results.push({
        type:"DEGRADACJA",
        title:p.officer_name,
        subtitle:`${p.old_rank} → ${p.new_rank}`,
        description:p.reason || "Brak uzasadnienia.",
        meta:[`Decyzję wydał: ${p.demoted_by||"—"}`,`Data: ${p.decision_date||"—"}`,fmt(p.created_at)]
      });
    }
  });

  state.dismissals.forEach(p=>{
    if(matchesQuery([p.officer_name,p.rank,p.reason,p.dismissed_by,p.dismissal_date,"zwolnienie"],q)){
      results.push({
        type:"ZWOLNIENIE",
        title:p.officer_name,
        subtitle:`${p.rank||"—"} → ZWOLNIONY`,
        description:p.reason || "Brak uzasadnienia.",
        meta:[`Odznaka: ${p.badge_number||"—"}`,`Zatwierdził: ${p.dismissed_by||"—"}`,fmt(p.created_at)]
      });
    }
  });

  state.resignations.forEach(p=>{
    if(matchesQuery([p.officer_name,p.rank,p.reason,p.submitted_date,p.end_date,"wypowiedzenie"],q)){
      results.push({
        type:"WYPOWIEDZENIE",
        title:p.officer_name,
        subtitle:`${p.rank||"—"} • ${p.end_date||"brak daty zakończenia"}`,
        description:p.reason || "Brak uzasadnienia.",
        meta:[`Data złożenia: ${p.submitted_date||"—"}`,`Planowane zakończenie: ${p.end_date||"—"}`,fmt(p.created_at)]
      });
    }
  });

  summary.textContent=`Znaleziono: ${results.length} • osoba / fraza: „${state.query}”`;

  grid.innerHTML=results.map(r=>`
    <article class="record-card">
      <div class="record-top">
        <span class="type-badge">${escapeHtml(r.type)}</span>
      </div>
      <h3>${escapeHtml(r.title)}</h3>
      <div class="promotion-rank">${escapeHtml(r.subtitle)}</div>
      <p>${escapeHtml(r.description)}</p>
      <div class="record-meta">
        ${r.meta.map(m=>`<span>${escapeHtml(m)}</span>`).join("")}
      </div>
    </article>`).join("") || '<div class="empty">Nic nie znaleziono.</div>';
}

function switchView(view){
  state.currentView=view;
  if(view!=="search") state.lastNonSearchView=view;
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".view").forEach(v=>v.classList.remove("active-view"));

  if(view==="search"){
    $("#searchResultsView").classList.add("active-view");
    $("#pageTitle").textContent="Wyniki wyszukiwania";
    state.forcedType="ALL";
    renderSearchResults();
  }else if(view==="dashboard"){
    $("#dashboardView").classList.add("active-view");
    $("#pageTitle").textContent="Dashboard";
    state.forcedType="ALL";
  }else if(view==="promotions"){
    $("#promotionsView").classList.add("active-view");
    $("#pageTitle").textContent="Awanse";
    state.forcedType="ALL";
    renderPromotions();
  }else if(view==="demotions"){
    $("#demotionsView").classList.add("active-view");
    $("#pageTitle").textContent="Degradacje";
    state.forcedType="ALL";
    renderDemotions();
  }else if(view==="dismissals"){
    $("#dismissalsView").classList.add("active-view");
    $("#pageTitle").textContent="Zwolnienia";
    state.forcedType="ALL";
    renderDismissals();
  }else if(view==="resignations"){
    $("#resignationsView").classList.add("active-view");
    $("#pageTitle").textContent="Wypowiedzenia";
    state.forcedType="ALL";
    renderResignations();
  }else{
    $("#reportsView").classList.add("active-view");
    const map={
      "reports-all":["Wszystkie raporty","ALL"],
      "reports-dtu":["Raporty DTU","DTU"],
      "reports-sert":["Raporty SERT","SERT"],
      "reports-iad":["Raporty IAD","IAD"],
      "reports-deputy":["Raporty zastępcy","DEPUTY"],
      "reports-weapon-loss":["Utrata broni","WEAPON_LOSS"],
      "reports-suspensions":["Zawieszenia","SUSPENSION"],
      "reports-vacation":["Urlopy","VACATION"],
      "reports-plus":["Plusy","PLUS"],
      "reports-minus":["Minusy","MINUS"],
      "reports-plus":["Plusy","PLUS"],
      "reports-minus":["Minusy","MINUS"]
    };
    const [label,type]=map[view]||map["reports-all"];
    $("#pageTitle").textContent=label;
    $("#reportsHeading").textContent=label;
    $("#reportsEyebrow").textContent=type==="ALL"?"REPORTS":type+" REPORTS";
    state.forcedType=type;
    $("#reportTypeFilter").value=type==="ALL"?"ALL":type;
    renderReports();
  }
}

const statsGrid=$(".stats-grid");
const statsToggleBtn=$("#statsToggleBtn");
if(statsGrid && statsToggleBtn){
  statsToggleBtn.addEventListener("click",()=>{
    const collapsed=statsGrid.classList.toggle("stats-collapsed");
    statsToggleBtn.textContent=collapsed ? "Rozwiń" : "Zwiń";
    statsToggleBtn.setAttribute("aria-expanded",String(!collapsed));
  });
}

$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$$("[data-jump]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.jump)));
$("#reportTypeFilter").addEventListener("change",()=>{if(state.forcedType==="ALL")renderReports()});
$("#searchInput").addEventListener("input",e=>{
  state.query=e.target.value;
  const q=normalizeSearch(state.query);

  if(q){
    switchView("search");
  }else{
    switchView(state.lastNonSearchView || "dashboard");
  }

  renderReports();
  renderPromotions();
  renderDemotions();
  renderDismissals();
  renderResignations();
  renderSearchResults();
});

boot();
