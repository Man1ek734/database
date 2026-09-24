const cfg = window.LSSD_CONFIG || {};
const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const supabaseClient = configured
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const state={reports:[],promotions:[],currentView:"dashboard",forcedType:"ALL",query:""};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmt=d=>new Intl.DateTimeFormat("pl-PL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(d));
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

function initials(email="SV"){
  const raw=email.split("@")[0].replace(/[._-]+/g," ").trim();
  return raw.split(" ").filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "SV";
}

async function boot(){
  if(!configured){
    state.reports=[];
    state.promotions=[];
    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#userName").textContent="LSSD Database";
    $("#userEmail").textContent="Skonfiguruj Supabase w config.js";
    $("#userInitials").textContent="DM";
    renderAll();
    return;
  }

  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session) enterApp(session.user);
}

async function enterApp(user){
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#userEmail").textContent=user.email || "Authorized User";
  $("#userName").textContent=(user.user_metadata?.display_name || user.email?.split("@")[0] || "Authorized User");
  $("#userInitials").textContent=initials(user.email);
  await loadData();
}

async function loadData(){
  if(!configured){renderAll();return}
  const [{data:reports,error:re},{data:promotions,error:pe}] = await Promise.all([
    supabaseClient.from("reports").select("*").order("created_at",{ascending:false}),
    supabaseClient.from("promotions").select("*").order("created_at",{ascending:false})
  ]);
  if(re||pe){
    console.error(re||pe);
    return;
  }
  state.reports=reports||[];
  state.promotions=promotions||[];
  renderAll();
}

function renderAll(){
  $("#statReports").textContent=state.reports.length;
  $("#statSpecial").textContent=state.reports.filter(r=>["DTU","SERT"].includes(r.report_type)).length;
  $("#statIad").textContent=state.reports.filter(r=>r.report_type==="IAD").length;
  $("#statPromotions").textContent=state.promotions.length;

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
        <div><span class="type-badge">${escapeHtml(r.report_type)}</span></div>
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
  const list=state.promotions.filter(p=>!q || [p.officer_name,p.badge_number,p.old_rank,p.new_rank,p.reason,p.promoted_by].join(" ").toLowerCase().includes(q));
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
        <span>Odznaka: ${escapeHtml(p.badge_number||"—")}</span>
        <span>Nadał: ${escapeHtml(p.promoted_by||"—")}</span>
      </div>
    </article>`).join("") || '<div class="empty">Brak pasujących awansów.</div>';
}

function switchView(view){
  state.currentView=view;
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".view").forEach(v=>v.classList.remove("active-view"));

  if(view==="dashboard"){
    $("#dashboardView").classList.add("active-view");
    $("#pageTitle").textContent="Dashboard";
    state.forcedType="ALL";
  }else if(view==="promotions"){
    $("#promotionsView").classList.add("active-view");
    $("#pageTitle").textContent="Awanse";
    state.forcedType="ALL";
    renderPromotions();
  }else{
    $("#reportsView").classList.add("active-view");
    const map={
      "reports-all":["Wszystkie raporty","ALL"],
      "reports-dtu":["Raporty DTU","DTU"],
      "reports-sert":["Raporty SERT","SERT"],
      "reports-iad":["Raporty IAD","IAD"],
      "reports-deputy":["Raporty Deputy","DEPUTY"]
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

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!configured){
    $("#loginMessage").textContent="Najpierw wpisz SUPABASE_URL i SUPABASE_ANON_KEY w config.js.";
    return;
  }
  $("#loginMessage").textContent="Logowanie...";
  const {data,error}=await supabaseClient.auth.signInWithPassword({
    email:$("#loginEmail").value.trim(),
    password:$("#loginPassword").value
  });
  if(error){$("#loginMessage").textContent=error.message;return}
  $("#loginMessage").textContent="";
  await enterApp(data.user);
});

$("#logoutBtn").addEventListener("click",async()=>{
  if(configured) await supabaseClient.auth.signOut();
  location.reload();
});
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$$("[data-jump]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.jump)));
$("#reportTypeFilter").addEventListener("change",()=>{if(state.forcedType==="ALL")renderReports()});
$("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderReports();renderPromotions()});

boot();
