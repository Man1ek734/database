import "dotenv/config";
import { startWebApi } from "./webapi.js";
import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  Partials,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

const required=[
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID"
];

for(const key of required){
  if(!process.env[key]) throw new Error(`Brak zmiennej środowiskowej: ${key}`);
}

const gatewayIntents=[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages
];
if(process.env.ENABLE_MESSAGE_CONTENT_LOGS==="true"){
  gatewayIntents.push(GatewayIntentBits.MessageContent);
}
const client=new Client({
  intents:gatewayIntents,
  partials:[Partials.Message,Partials.Channel,Partials.GuildMember,Partials.User]
});

const deletedMessageCache=new Map();
const MESSAGE_CACHE_TTL_MS=24*60*60*1000;
const MESSAGE_CACHE_MAX=10000;

function rememberMessage(message){
  if(!message?.guild || !message.author || message.author.bot) return;

  deletedMessageCache.set(message.id,{
    guildId:message.guild.id,
    channelId:message.channelId,
    authorId:message.author.id,
    authorTag:message.author.tag,
    content:message.content || "",
    attachments:Array.from(message.attachments?.values?.() || []).map(a=>a.url),
    createdAt:Date.now()
  });

  if(deletedMessageCache.size>MESSAGE_CACHE_MAX){
    const oldestKey=deletedMessageCache.keys().next().value;
    if(oldestKey) deletedMessageCache.delete(oldestKey);
  }
}

setInterval(()=>{
  const cutoff=Date.now()-MESSAGE_CACHE_TTL_MS;
  for(const [id,item] of deletedMessageCache){
    if(item.createdAt<cutoff) deletedMessageCache.delete(id);
  }
},60*60*1000).unref?.();

async function getLogChannel(guild){
  const channelId=process.env.LOG_CHANNEL_ID;
  if(!channelId) return null;
  const channel=await guild.channels.fetch(channelId).catch(()=>null);
  return channel?.isTextBased() ? channel : null;
}

async function sendLogEmbed(guild,embed){
  const channel=await getLogChannel(guild);
  if(!channel) return;
  await channel.send({embeds:[embed],allowedMentions:{parse:[]}}).catch(error=>{
    console.error("Log channel send error:",error);
  });
}

function shortLogText(value,max=1000){
  const text=String(value||"").trim();
  if(!text) return "—";
  return text.length>max ? text.slice(0,max-1)+"…" : text;
}

async function roleUpdateExecutor(guild,memberId){
  try{
    const logs=await guild.fetchAuditLogs({
      type:AuditLogEvent.MemberRoleUpdate,
      limit:6
    });
    const now=Date.now();
    const entry=logs.entries.find(item=>
      item.target?.id===memberId &&
      now-item.createdTimestamp<10000
    );
    return entry?.executor || null;
  }catch{
    return null;
  }
}

const TICKET_TYPES={
  POMOC:{label:"Pomoc",emoji:"🛟",description:"Potrzebujesz pomocy lub informacji"},
  SKARGA:{label:"Skarga",emoji:"⚠️",description:"Zgłoszenie skargi"},
  ZARZAD:{label:"Sprawa do zarządu",emoji:"👑",description:"Kontakt bezpośrednio z zarządem LSSD"},
  INNE:{label:"Inne",emoji:"📌",description:"Inna sprawa"}
};

const TICKET_STAFF_RANKS=["Sheriff","Undersheriff","Assistant Sheriff","Commander"];
const LSSD_RANK_ORDER=[
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

const AUTO_JOIN_ROLE_NAMES=[
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯ ↓ Los Santos Sheriff Department ↓ ⎯⎯⎯⎯⎯⎯⎯⎯⎯",
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯ ↓ Szkolenia ↓ ⎯⎯⎯⎯⎯⎯⎯⎯⎯",
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯ ↓ Akta ↓ ⎯⎯⎯⎯⎯⎯⎯⎯⎯",
  "⎯⎯⎯⎯⎯⎯⎯⎯⎯ ↓ Obywatele ↓ ⎯⎯⎯⎯⎯⎯⎯⎯⎯",
  "» |・Obywatel"
];


function normalizeTicketRole(value=""){
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function findRankRole(guild,rankName){
  const target=normalizeTicketRole(rankName);
  if(!target) return null;

  return guild.roles.cache.find(role=>{
    const roleName=normalizeTicketRole(role.name);
    return roleName===target || roleName.endsWith(" "+target);
  }) || null;
}

async function applyPromotionRoles(interaction,targetUserId,oldRank,newRank){
  const guild=interaction.guild;
  if(!guild) return {ok:false,message:"Nie udało się zmienić rangi — brak serwera."};

  await guild.roles.fetch().catch(()=>null);
  const member=await guild.members.fetch(targetUserId).catch(()=>null);
  if(!member) return {ok:false,message:"Nie udało się znaleźć funkcjonariusza na serwerze."};

  const oldRole=findRankRole(guild,oldRank);
  const newRole=findRankRole(guild,newRank);

  if(!newRole){
    return {ok:false,message:`Nie znaleziono na Discordzie rangi „${newRank}”.`};
  }

  const me=guild.members.me;
  const highest=me?.roles?.highest?.position ?? -1;
  if(newRole.managed || newRole.position>=highest){
    return {ok:false,message:`Bot nie może nadać rangi „${newRole.name}”. Przenieś rangę bota wyżej.`};
  }

  await member.roles.add(
    newRole,
    `Awans przez ${interaction.user.tag}: ${oldRank} -> ${newRank}`
  );

  if(oldRole && oldRole.id!==newRole.id && member.roles.cache.has(oldRole.id)){
    if(!oldRole.managed && oldRole.position<highest){
      await member.roles.remove(
        oldRole,
        `Awans przez ${interaction.user.tag}: ${oldRank} -> ${newRank}`
      );
    }
  }

  return {
    ok:true,
    message:oldRole && oldRole.id!==newRole.id
      ? `Ranga Discord została zmieniona: **${oldRole.name} → ${newRole.name}**.`
      : `Nadano rangę Discord: **${newRole.name}**.`
  };
}

async function applyAutomaticDemotion(interaction,targetUserId){
  const guild=interaction.guild;
  if(!guild) return {ok:false,message:"Nie udało się zmienić rangi — brak serwera."};

  await guild.roles.fetch().catch(()=>null);
  const member=await guild.members.fetch(targetUserId).catch(()=>null);
  if(!member) return {ok:false,message:"Nie udało się znaleźć funkcjonariusza na serwerze."};

  let currentRank=null;
  let currentRole=null;

  for(const rankName of LSSD_RANK_ORDER){
    const role=findRankRole(guild,rankName);
    if(role && member.roles.cache.has(role.id)){
      currentRank=rankName;
      currentRole=role;
      break;
    }
  }

  if(!currentRank || !currentRole){
    return {ok:false,message:"Nie udało się wykryć aktualnego stopnia funkcjonariusza."};
  }

  const currentIndex=LSSD_RANK_ORDER.indexOf(currentRank);
  if(currentIndex<0 || currentIndex===LSSD_RANK_ORDER.length-1){
    return {ok:false,message:`Ranga **${currentRank}** nie ma już niższego stopnia.`};
  }

  const newRank=LSSD_RANK_ORDER[currentIndex+1];
  const newRole=findRankRole(guild,newRank);

  if(!newRole){
    return {ok:false,message:`Nie znaleziono na Discordzie niższej rangi „${newRank}”.`};
  }

  const me=guild.members.me;
  const highest=me?.roles?.highest?.position ?? -1;

  if(newRole.managed || newRole.position>=highest || currentRole.managed || currentRole.position>=highest){
    return {ok:false,message:"Bot nie może zmienić tych rang. Przenieś rangę bota wyżej w hierarchii."};
  }

  await member.roles.add(
    newRole,
    `Degradacja przez ${interaction.user.tag}: ${currentRank} -> ${newRank}`
  );

  await member.roles.remove(
    currentRole,
    `Degradacja przez ${interaction.user.tag}: ${currentRank} -> ${newRank}`
  );

  return {
    ok:true,
    oldRank:currentRank,
    newRank,
    message:`Ranga Discord została zmieniona: **${currentRank} → ${newRank}**.`
  };
}

function ticketStaffRoleIds(guild){
  const explicit=(process.env.TICKET_STAFF_ROLE_IDS||"")
    .split(",")
    .map(x=>x.trim())
    .filter(Boolean);

  if(explicit.length) return explicit;

  const targets=TICKET_STAFF_RANKS.map(normalizeTicketRole);
  return guild.roles.cache
    .filter(role=>{
      const n=normalizeTicketRole(role.name);
      return targets.some(target=>n===target || n.endsWith(" "+target));
    })
    .map(role=>role.id);
}

function ticketCloseModal(){
  const modal=new ModalBuilder()
    .setCustomId("ticket_close_modal")
    .setTitle("Zamknij ticket");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      input("close_reason","Powód zamknięcia",TextInputStyle.Paragraph,true,"Napisz powód zamknięcia ticketu")
    )
  );
  return modal;
}

async function closeTicketChannel(interaction,reason){
  const channel=interaction.channel;
  if(!channel?.topic?.includes("ticket-owner:")){
    if(interaction.deferred || interaction.replied) await interaction.editReply("❌ To nie jest kanał ticketu.").catch(()=>{});
    else await interaction.reply({content:"❌ To nie jest kanał ticketu.",ephemeral:true}).catch(()=>{});
    return;
  }

  const closer=interaction.user.toString();
  const payload={
    content:`🔒 **Ticket zostaje zamknięty.**\n**Zamknął:** ${closer}\n**Powód:** ${reason}\n\nKanał zostanie usunięty za chwilę.`,
    allowedMentions:{users:[interaction.user.id]}
  };

  if(interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply(payload);

  setTimeout(async()=>{
    await channel.delete(`Ticket zamknięty przez ${interaction.user.tag}: ${reason}`).catch(error=>console.error("Ticket delete error:",error));
  },3000);
}

function ticketPanelPayload(){
  const embed=new EmbedBuilder()
    .setTitle("🎫 LSSD • SYSTEM TICKETÓW")
    .setDescription(
      "**Wybierz kategorię zgłoszenia poniżej.**\n" +
      "Po utworzeniu ticketu obsługa LSSD zajmie się Twoją sprawą."
    )
    .setColor(0xC9AA51)
    .setFooter({text:"LSSD • Ticket Center"});

  const menu=new StringSelectMenuBuilder()
    .setCustomId("ticket_type")
    .setPlaceholder("Wybierz rodzaj ticketu")
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value,item])=>({
        label:item.label,
        value,
        description:item.description,
        emoji:item.emoji
      }))
    );

  return {embeds:[embed],components:[new ActionRowBuilder().addComponents(menu)]};
}

async function ensureTicketPanel(){
  const channelId=process.env.TICKET_PANEL_CHANNEL_ID;
  if(!channelId) return;

  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

  const recent=await channel.messages.fetch({limit:50}).catch(()=>null);
  const panelMessages=recent?.filter(msg=>
    msg.author?.id===client.user.id &&
    msg.embeds?.[0]?.title==="🎫 LSSD • SYSTEM TICKETÓW"
  );

  if(panelMessages?.size){
    for(const msg of panelMessages.values()){
      await msg.delete().catch(()=>null);
    }
  }

  await channel.send(ticketPanelPayload());
}

const commands=[
  new SlashCommandBuilder().setName("database").setDescription("Otwórz główne menu LSSD Records Database"),
  new SlashCommandBuilder().setName("raport").setDescription("Dodaj raport do LSSD Records Database")
    .addStringOption(o=>o.setName("typ").setDescription("Rodzaj raportu").setRequired(true)
      .addChoices(
        {name:"DTU",value:"DTU"},
        {name:"SERT",value:"SERT"},
        {name:"IAD",value:"IAD"},
        {name:"Raport zastępcy",value:"DEPUTY"},
        {name:"Utrata broni",value:"WEAPON_LOSS"}
      )),
  new SlashCommandBuilder().setName("utrata-broni").setDescription("Wypełnij raport o utracie broni"),
  new SlashCommandBuilder().setName("urlop").setDescription("Złóż wniosek urlopowy"),
  new SlashCommandBuilder().setName("zamknij").setDescription("Zamknij aktualny ticket")
    .addStringOption(o=>o.setName("powod").setDescription("Powód zamknięcia ticketu").setRequired(true)),
  new SlashCommandBuilder().setName("plus").setDescription("Nadaj plus funkcjonariuszowi")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, która otrzymuje plus").setRequired(true)),
  new SlashCommandBuilder().setName("minus").setDescription("Nadaj minus funkcjonariuszowi")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, która otrzymuje minus").setRequired(true)),
  new SlashCommandBuilder().setName("zawias").setDescription("Zarejestruj zawieszenie funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, którą zawieszasz").setRequired(true)),
  new SlashCommandBuilder().setName("awans").setDescription("Zarejestruj awans funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, która otrzymuje awans").setRequired(true)),
  new SlashCommandBuilder().setName("degrad").setDescription("Zarejestruj degradację funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, która otrzymuje degradację").setRequired(true)),
  new SlashCommandBuilder().setName("zwolnienia").setDescription("Zarejestruj zwolnienie funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba zwalniana ze służby").setRequired(true)),
  new SlashCommandBuilder().setName("wypowiedzenia").setDescription("Zarejestruj wypowiedzenie funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba składająca wypowiedzenie").setRequired(true))
];

async function supabaseWrite(action,table,payload,id=null){
  if(!process.env.SUPABASE_URL || !process.env.BOT_WRITE_SECRET){
    throw new Error("Supabase nie jest jeszcze skonfigurowany.");
  }

  const res=await fetch(`${process.env.SUPABASE_URL}/functions/v1/lssd-bot-write`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-bot-secret":process.env.BOT_WRITE_SECRET
    },
    body:JSON.stringify({action,table,payload,id})
  });

  const data=await res.json().catch(()=>({}));

  if(!res.ok){
    throw new Error(`Supabase ${res.status}: ${data.error || "Unknown error"}`);
  }

  return data;
}

const supabaseInsert=(table,payload)=>supabaseWrite("insert",table,payload);

function input(id,label,style=TextInputStyle.Short,required=true,placeholder=""){
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setPlaceholder(placeholder);
}

function reportModal(type){
  const modal=new ModalBuilder()
    .setCustomId(`report_modal:${type}`)
    .setTitle(`Raport ${type}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("title","Tytuł raportu",TextInputStyle.Short,true,"np. Investigation Report #024")),
    new ActionRowBuilder().addComponents(input("subject","Dotyczy / osoba / sprawa",TextInputStyle.Short,true,"np. John Doe / Davis Avenue")),
    new ActionRowBuilder().addComponents(input("badge","Twój numer odznaki",TextInputStyle.Short,true,"np. 530")),
    new ActionRowBuilder().addComponents(input("details","Treść raportu",TextInputStyle.Paragraph,true,"Opisz przebieg zdarzenia..."))
  );
  return modal;
}

function deputyReportModal(){
  const modal=new ModalBuilder()
    .setCustomId("deputy_report_modal")
    .setTitle("Raport zastępcy");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("report_date","Data raportu",TextInputStyle.Short,true,"np. 25.09.2026")),
    new ActionRowBuilder().addComponents(input("officer","Od — imię i nazwisko",TextInputStyle.Short,true,"np. Tomas Chase")),
    new ActionRowBuilder().addComponents(input("badge","Numer odznaki",TextInputStyle.Short,true,"np. 11404")),
    new ActionRowBuilder().addComponents(input("patrol_description","Przebieg patrolu",TextInputStyle.Paragraph,true,"Opisz przebieg patrolu...")),
    new ActionRowBuilder().addComponents(input("signature","Podpis — stopień + odznaka",TextInputStyle.Short,true,"np. Commander 11404"))
  );
  return modal;
}

function weaponLossModal(){
  const modal=new ModalBuilder()
    .setCustomId("weapon_loss_modal")
    .setTitle("Raport o utracie broni");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("serial_number","Numer seryjny broni",TextInputStyle.Short,true,"np. LS-458291")),
    new ActionRowBuilder().addComponents(input("weapon_model","Model broni",TextInputStyle.Short,true,"np. Glock 17")),
    new ActionRowBuilder().addComponents(input("loss_datetime","Data i godzina utraty",TextInputStyle.Short,true,"np. 25.09.2026 00:15")),
    new ActionRowBuilder().addComponents(input("badge","Twój numer odznaki",TextInputStyle.Short,true,"np. 11404")),
    new ActionRowBuilder().addComponents(input("circumstances","Opis okoliczności utraty",TextInputStyle.Paragraph,true,"Opisz dokładnie, kiedy i w jakich okolicznościach utracono broń"))
  );
  return modal;
}

function cleanOfficerName(interaction){
  const raw=interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  return String(raw)
    .replace(/^\s*\[[^\]]+\]\s*/,"")
    .replace(/^\s*\([^\)]+\)\s*/,"")
    .trim();
}

function vacationModal(){
  const modal=new ModalBuilder()
    .setCustomId("vacation_modal")
    .setTitle("Wniosek urlopowy | LSSD");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank","Stopień",TextInputStyle.Short,true,"np. Deputy Sheriff II")),
    new ActionRowBuilder().addComponents(input("from_date","Termin urlopu — od",TextInputStyle.Short,true,"DD.MM")),
    new ActionRowBuilder().addComponents(input("to_date","Termin urlopu — do",TextInputStyle.Short,true,"DD.MM")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód urlopu"))
  );
  return modal;
}

function suspensionModal(targetUserId){
  const modal=new ModalBuilder()
    .setCustomId(`suspension_modal:${targetUserId}`)
    .setTitle("Zawieszenie funkcjonariusza");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank","Stopień",TextInputStyle.Short,true,"np. Deputy Sheriff II")),
    new ActionRowBuilder().addComponents(input("from_date","Okres zawieszenia — od",TextInputStyle.Short,true,"DD.MM.RRRR")),
    new ActionRowBuilder().addComponents(input("to_date","Okres zawieszenia — do",TextInputStyle.Short,true,"DD.MM.RRRR")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód zawieszenia"))
  );
  return modal;
}

function promotionModal(targetUserId){
  const modal=new ModalBuilder()
    .setCustomId(`promotion_modal:${targetUserId}`)
    .setTitle("Awans funkcjonariusza");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("old_rank","Poprzedni stopień",TextInputStyle.Short,true,"np. Deputy Sheriff I")),
    new ActionRowBuilder().addComponents(input("new_rank","Nowy stopień",TextInputStyle.Short,true,"np. Deputy Sheriff II")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód awansu")),
    new ActionRowBuilder().addComponents(input("decision_date","Data",TextInputStyle.Short,true,"DD.MM.RRRR"))
  );
  return modal;
}

function demotionModal(targetUserId){
  const modal=new ModalBuilder()
    .setCustomId(`demotion_modal:${targetUserId}`)
    .setTitle("Degradacja funkcjonariusza");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód degradacji")),
    new ActionRowBuilder().addComponents(input("decision_date","Data",TextInputStyle.Short,true,"DD.MM.RRRR"))
  );
  return modal;
}

function plusMinusModal(type,targetUserId){
  const isPlus=type==="PLUS";
  const modal=new ModalBuilder()
    .setCustomId(`discipline_modal:${type}:${targetUserId}`)
    .setTitle(isPlus ? "Plus funkcjonariusza" : "Minus funkcjonariusza");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank","Stopień",TextInputStyle.Short,true,"np. Deputy Sheriff I")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,isPlus ? "Podaj powód nadania plusa" : "Podaj powód nadania minusa")),
    new ActionRowBuilder().addComponents(input("decision_date","Data",TextInputStyle.Short,true,"DD.MM.RRRR"))
  );
  return modal;
}

function dismissalModal(targetUserId){
  const modal=new ModalBuilder()
    .setCustomId(`dismissal_modal:${targetUserId}`)
    .setTitle("Zwolnienie funkcjonariusza");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank","Stopień",TextInputStyle.Short,true,"np. Deputy Sheriff I")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód zwolnienia")),
    new ActionRowBuilder().addComponents(input("dismissal_date","Data zwolnienia",TextInputStyle.Short,true,"DD.MM.RRRR"))
  );
  return modal;
}

function resignationModal(targetUserId){
  const modal=new ModalBuilder()
    .setCustomId(`resignation_modal:${targetUserId}`)
    .setTitle("Wypowiedzenie ze służby");
  modal.addComponents(
    new ActionRowBuilder().addComponents(input("rank","Stopień",TextInputStyle.Short,true,"np. Deputy Sheriff II")),
    new ActionRowBuilder().addComponents(input("submitted_date","Data złożenia wypowiedzenia",TextInputStyle.Short,true,"DD.MM.RRRR")),
    new ActionRowBuilder().addComponents(input("end_date","Planowana data zakończenia służby",TextInputStyle.Short,true,"DD.MM.RRRR")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód wypowiedzenia"))
  );
  return modal;
}

function personnelTargetMenu(type){
  return new UserSelectMenuBuilder()
    .setCustomId(`personnel_target:${type}`)
    .setPlaceholder("Wybierz funkcjonariusza")
    .setMinValues(1)
    .setMaxValues(1);
}

async function getTargetOfficerName(interaction,targetUserId){
  const targetMember=await interaction.guild?.members.fetch(targetUserId).catch(()=>null);
  const targetUser=targetMember?.user || await client.users.fetch(targetUserId).catch(()=>null);
  const raw=targetMember?.displayName || targetUser?.globalName || targetUser?.username || "Nieznany funkcjonariusz";
  return String(raw)
    .replace(/^\s*\[[^\]]+\]\s*/,"")
    .replace(/^\s*\([^\)]+\)\s*/,"")
    .trim();
}

function personnelPingPayload(targetUserId,actorUserId){
  const users=[...new Set([String(targetUserId),String(actorUserId)])];
  return {
    content:users.map(id=>`<@${id}>`).join(" • "),
    allowedMentions:{users}
  };
}

async function publishPersonnelChange(interaction,row,type,targetUserId){
  let title="LSSD • PERSONNEL NOTICE";
  let description=`<@${targetUserId}> — aktualizacja statusu służbowego.`;
  let color=0xC9AA51;
  const fields=[];

  if(type==="PROMOTION"){
    title="🎉 AWANS FUNKCJONARIUSZA";
    description=`<@${targetUserId}> otrzymuje awans.`;
    fields.push(
      {name:"Funkcjonariusz",value:row.officer_name || "—",inline:false},
      {name:"Poprzedni stopień",value:row.old_rank || "—",inline:false},
      {name:"Nowy stopień",value:row.new_rank || "—",inline:false},
      {name:"Decyzję wydał",value:interaction.user.toString(),inline:false},
      {name:"Powód",value:row.reason || "—",inline:false},
      {name:"Data",value:row.decision_date || "—",inline:false}
    );
  }else if(type==="DEMOTION"){
    title="⬇️ DEGRADACJA FUNKCJONARIUSZA";
    description=`<@${targetUserId}> otrzymuje degradację.`;
    color=0xD98C3F;
    fields.push(
      {name:"Funkcjonariusz",value:row.officer_name || "—",inline:false},
      {name:"Poprzedni stopień",value:row.old_rank || "—",inline:false},
      {name:"Nowy stopień",value:row.new_rank || "—",inline:false},
      {name:"Decyzję wydał",value:interaction.user.toString(),inline:false},
      {name:"Powód",value:row.reason || "—",inline:false},
      {name:"Data",value:row.decision_date || "—",inline:false}
    );
  }else if(type==="DISMISSAL"){
    title="⛔ ZWOLNIENIE FUNKCJONARIUSZA";
    description=`<@${targetUserId}> zostaje zwolniony(a) ze służby.`;
    color=0xB84A55;
    fields.push(
      {name:"Funkcjonariusz",value:row.officer_name || "—",inline:false},
      {name:"Stopień",value:row.rank || "—",inline:false},
      {name:"Decyzję wydał",value:interaction.user.toString(),inline:false},
      {name:"Powód",value:row.reason || "—",inline:false},
      {name:"Data zwolnienia",value:row.dismissal_date || "—",inline:false}
    );
  }else{
    title="📄 WYPOWIEDZENIE ZE SŁUŻBY";
    description=`<@${targetUserId}> składa wypowiedzenie ze służby.`;
    color=0x7A8AA0;
    fields.push(
      {name:"Funkcjonariusz",value:row.officer_name || "—",inline:false},
      {name:"Stopień",value:row.rank || "—",inline:false},
      {name:"Data złożenia wypowiedzenia",value:row.submitted_date || "—",inline:false},
      {name:"Planowana data zakończenia służby",value:row.end_date || "—",inline:false},
      {name:"Powód",value:row.reason || "—",inline:false}
    );
  }

  const embed=new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setColor(color)
    .setFooter({text:"Los Santos Sheriff's Department • Station 28 — Davis Avenue"})
    .setTimestamp();

  const ping=personnelPingPayload(targetUserId,interaction.user.id);
  return {content:ping.content,embeds:[embed],allowedMentions:ping.allowedMentions};
}

async function publishDisciplineLog(interaction,row,type,targetUserId){
  const isPlus=type==="PLUS";
  const parts=String(row.details||"").split("\n");
  const rank=(parts.find(x=>x.startsWith("Stopień: "))||"").replace("Stopień: ","") || "—";
  const date=(parts.find(x=>x.startsWith("Data: "))||"").replace("Data: ","") || "—";
  const reasonIndex=parts.findIndex(x=>x==="Powód:");
  const reason=reasonIndex>=0 ? parts.slice(reasonIndex+1).join("\n").trim() : "—";

  const embed=new EmbedBuilder()
    .setTitle(isPlus ? "➕ PLUS FUNKCJONARIUSZA" : "➖ MINUS FUNKCJONARIUSZA")
    .setDescription(`<@${targetUserId}> otrzymuje ${isPlus ? "plus" : "minus"}.`)
    .addFields(
      {name:"Funkcjonariusz",value:row.subject || "—",inline:false},
      {name:"Stopień",value:rank,inline:false},
      {name:"Nadane przez",value:interaction.user.toString(),inline:false},
      {name:"Powód",value:reason || "—",inline:false},
      {name:"Data",value:date,inline:false}
    )
    .setColor(isPlus ? 0x57F287 : 0xED4245)
    .setFooter({text:"Los Santos Sheriff's Department • Station 28 — Davis Avenue"})
    .setTimestamp();

  const ping=personnelPingPayload(targetUserId,interaction.user.id);
  return {content:ping.content,embeds:[embed],allowedMentions:ping.allowedMentions};
}

async function publishPromotion(interaction,row){
  const channelId=process.env.PROMOTION_CHANNEL_ID;
  if(!channelId) return;

  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

  const embed=new EmbedBuilder()
    .setTitle("LSSD • PROMOTION NOTICE")
    .setDescription(`**${row.officer_name}** otrzymuje awans.`)
    .addFields(
      {name:"Numer odznaki",value:row.badge_number || "—",inline:true},
      {name:"Poprzedni stopień",value:row.old_rank,inline:true},
      {name:"Nowy stopień",value:row.new_rank,inline:true},
      {name:"Uzasadnienie",value:row.reason || "—"},
      {name:"Zatwierdził",value:interaction.user.toString()}
    )
    .setColor(0xC9AA51)
    .setFooter({text:"Los Santos Sheriff's Department • Station 28 — Davis Avenue"})
    .setTimestamp();

  await channel.send({embeds:[embed]});
}

async function publishReportLog(interaction,row){
  const channelId=process.env.DATABASE_LOG_CHANNEL_ID;
  if(!channelId) return;

  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

  const embed=new EmbedBuilder()
    .setTitle(`DATABASE • ${row.report_type} REPORT`)
    .setDescription(row.title)
    .addFields(
      {name:"Dotyczy",value:row.subject || "—",inline:true},
      {name:"Odznaka",value:row.badge_number || "—",inline:true},
      {name:"Autor",value:interaction.user.toString(),inline:true}
    )
    .setColor(0xC9AA51)
    .setFooter({text:"Wpis zapisany w LSSD Records Database"})
    .setTimestamp();

  await channel.send({embeds:[embed]});
}

async function publishVacationLog(interaction,row){
  const parts=String(row.details||"").split("\n");
  const rank=(parts.find(x=>x.startsWith("Stopień: "))||"").replace("Stopień: ","") || "—";
  const period=(parts.find(x=>x.startsWith("Termin urlopu: "))||"").replace("Termin urlopu: ","") || "—";
  const reasonIndex=parts.findIndex(x=>x==="Powód:");
  const reason=reasonIndex>=0 ? parts.slice(reasonIndex+1).join("\n").trim() : "—";

  const embed=new EmbedBuilder()
    .setTitle("🏖️ WNIOSEK URLOPOWY | LSSD")
    .addFields(
      {name:"👮 Imię i nazwisko IC",value:row.subject || "—",inline:false},
      {name:"🎖️ Stopień",value:rank,inline:false},
      {name:"📅 Termin urlopu",value:period,inline:false},
      {name:"📝 Powód",value:reason || "—",inline:false}
    )
    .setColor(0xC9AA51)
    .setFooter({text:"Los Santos Sheriff's Department • Station 28 — Davis Avenue"})
    .setTimestamp();

  return {
    content:interaction.user.toString(),
    embeds:[embed],
    allowedMentions:{users:[interaction.user.id]}
  };
}

async function publishSuspensionLog(interaction,row,targetUserId){
  const parts=String(row.details||"").split("\n");
  const rank=(parts.find(x=>x.startsWith("Stopień: "))||"").replace("Stopień: ","") || "—";
  const period=(parts.find(x=>x.startsWith("Okres zawieszenia: "))||"").replace("Okres zawieszenia: ","") || "—";
  const decisionBy=(parts.find(x=>x.startsWith("Decyzję wydał: "))||"").replace("Decyzję wydał: ","") || cleanOfficerName(interaction);
  const reasonIndex=parts.findIndex(x=>x==="Powód:");
  const reason=reasonIndex>=0 ? parts.slice(reasonIndex+1).join("\n").trim() : "—";

  const embed=new EmbedBuilder()
    .setTitle("⚠️ ZAWIESZENIE FUNKCJONARIUSZA")
    .setDescription(`<@${targetUserId}> został(a) zawieszony(a) w służbie.`)
    .addFields(
      {name:"👤 Funkcjonariusz",value:row.subject || "—",inline:false},
      {name:"🎖️ Stopień",value:rank,inline:true},
      {name:"📅 Okres zawieszenia",value:period,inline:true},
      {name:"⚖️ Decyzję wydał",value:interaction.user.toString(),inline:false},
      {name:"📝 Powód",value:reason || "—",inline:false}
    )
    .setColor(0xD98C3F)
    .setFooter({text:"Los Santos Sheriff's Department • Station 28 — Davis Avenue"})
    .setTimestamp();

  const ping=personnelPingPayload(targetUserId,interaction.user.id);
  return {
    content:ping.content,
    embeds:[embed],
    allowedMentions:ping.allowedMentions
  };
}

async function publishWeaponLossLog(interaction,row){
  const channelId=process.env.DATABASE_LOG_CHANNEL_ID;
  if(!channelId) return;

  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

  const embed=new EmbedBuilder()
    .setTitle("DATABASE • RAPORT O UTRACIE BRONI")
    .setDescription("Zarejestrowano raport o utracie broni.")
    .addFields(
      {name:"Numer seryjny",value:row.subject?.split(" | ")[0]?.replace("SN: ","") || "—",inline:true},
      {name:"Model broni",value:row.subject?.split(" | ")[1]?.replace("Model: ","") || "—",inline:true},
      {name:"Odznaka",value:row.badge_number || "—",inline:true},
      {name:"Funkcjonariusz",value:cleanOfficerName(interaction),inline:true},
      {name:"Autor",value:interaction.user.toString(),inline:true}
    )
    .setColor(0xC9AA51)
    .setFooter({text:"LSSD Records Database • Raport o utracie broni"})
    .setTimestamp();

  await channel.send({embeds:[embed]});
}

client.on("guildMemberAdd",async member=>{
  try{
    await member.guild.roles.fetch().catch(()=>null);

    const me=member.guild.members.me;
    const botHighestPosition=me?.roles?.highest?.position ?? -1;

    for(const roleName of AUTO_JOIN_ROLE_NAMES){
      const role=member.guild.roles.cache.find(r=>r.name===roleName);

      if(!role){
        console.warn(`Auto-role not found: ${roleName}`);
        continue;
      }

      if(role.managed || role.position>=botHighestPosition){
        console.warn(`Cannot assign auto-role (move bot role above it): ${role.name}`);
        continue;
      }

      await member.roles.add(role,"Automatyczne role po dołączeniu do serwera").catch(error=>{
        console.error(`Auto-role error for ${role.name}:`,error);
      });
    }

    const joinEmbed=new EmbedBuilder()
      .setTitle("📥 Użytkownik dołączył")
      .setDescription(`${member.user.toString()} dołączył na serwer.`)
      .addFields(
        {name:"Użytkownik",value:`${member.user.tag} (${member.user.id})`,inline:false},
        {name:"Konto utworzone",value:`<t:${Math.floor(member.user.createdTimestamp/1000)}:F>`,inline:false}
      )
      .setColor(0x57F287)
      .setThumbnail(member.user.displayAvatarURL({size:128}))
      .setTimestamp();

    await sendLogEmbed(member.guild,joinEmbed);

    const channelId=process.env.WELCOME_CHANNEL_ID;
    if(!channelId) return;

    const channel=await member.guild.channels.fetch(channelId).catch(()=>null);
    if(!channel?.isTextBased()) return;

    const embed=new EmbedBuilder()
      .setTitle("⭐ LOS SANTOS SHERIFF’S DEPARTMENT")
      .setDescription(
        `Witaj ${member.user.toString()}.\n\n` +
        "Od dziś reprezentujesz Los Santos Sheriff’s Department.\n" +
        "Noś odznakę z honorem i służ mieszkańcom hrabstwa.\n\n" +
        "Service • Integrity • Community"
      )
      .setColor(0xC9AA51)
      .setFooter({text:"Los Santos Sheriff's Department"});

    await channel.send({
      embeds:[embed],
      allowedMentions:{users:[member.user.id]}
    });
  }catch(error){
    console.error("Member join handler error:",error);
  }
});

client.on("guildMemberRemove",async member=>{
  try{
    const user=member.user;
    const leaveEmbed=new EmbedBuilder()
      .setTitle("📤 Użytkownik opuścił serwer")
      .setDescription(`${user.toString()} opuścił serwer.`)
      .addFields(
        {name:"Użytkownik",value:`${user.tag} (${user.id})`,inline:false},
        {name:"Dołączył",value:member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp/1000)}:F>` : "—",inline:false}
      )
      .setColor(0xED4245)
      .setThumbnail(user.displayAvatarURL({size:128}))
      .setTimestamp();

    await sendLogEmbed(member.guild,leaveEmbed);
  }catch(error){
    console.error("Member leave log error:",error);
  }
});

client.on("messageCreate",message=>{
  try{
    rememberMessage(message);
  }catch(error){
    console.error("Message cache error:",error);
  }
});

client.on("messageDelete",async message=>{
  try{
    if(!message.guild) return;

    const cached=deletedMessageCache.get(message.id);
    deletedMessageCache.delete(message.id);

    const author=message.author || (cached?.authorId ? await client.users.fetch(cached.authorId).catch(()=>null) : null);
    if(author?.bot) return;

    const content=message.content || cached?.content || "";
    const attachmentUrls=message.attachments?.size
      ? Array.from(message.attachments.values()).map(a=>a.url)
      : (cached?.attachments || []);
    const attachmentText=attachmentUrls.join("\n");

    const authorValue=author
      ? `${author.toString()} • ${author.tag} (${author.id})`
      : cached
        ? `${cached.authorTag || "Nieznany użytkownik"} (${cached.authorId})`
        : "Nieznany użytkownik";

    const channelId=message.channelId || cached?.channelId;
    const fields=[
      {
        name:"Autor",
        value:authorValue,
        inline:false
      },
      {
        name:"Kanał",
        value:channelId ? `<#${channelId}>` : "Nieznany kanał",
        inline:false
      },
      {
        name:"Treść wiadomości",
        value:shortLogText(content || "Treść niedostępna — bot nie miał jej wcześniej w pamięci."),
        inline:false
      }
    ];

    if(attachmentText){
      fields.push({name:"Załączniki",value:shortLogText(attachmentText),inline:false});
    }

    const embed=new EmbedBuilder()
      .setTitle("🗑️ Usunięto wiadomość")
      .addFields(fields)
      .setColor(0xED4245)
      .setTimestamp();

    await sendLogEmbed(message.guild,embed);
  }catch(error){
    console.error("Message delete log error:",error);
  }
});

client.on("guildMemberUpdate",async(oldMember,newMember)=>{
  try{
    const added=newMember.roles.cache.filter(role=>!oldMember.roles.cache.has(role.id));
    const removed=oldMember.roles.cache.filter(role=>!newMember.roles.cache.has(role.id));

    if(!added.size && !removed.size) return;

    const executor=await roleUpdateExecutor(newMember.guild,newMember.id);
    const embed=new EmbedBuilder()
      .setTitle("🎭 Zmieniono role użytkownika")
      .setDescription(newMember.user.toString())
      .setColor(added.size ? 0x57F287 : 0xED4245)
      .setTimestamp();

    if(added.size){
      embed.addFields({
        name:"Nadane role",
        value:added.map(role=>`<@&${role.id}>`).join("\n"),
        inline:false
      });
    }

    if(removed.size){
      embed.addFields({
        name:"Usunięte role",
        value:removed.map(role=>`<@&${role.id}>`).join("\n"),
        inline:false
      });
    }

    embed.addFields({
      name:"Zmienił",
      value:executor ? `${executor.toString()} • ${executor.tag}` : "Nie udało się ustalić",
      inline:false
    });

    await sendLogEmbed(newMember.guild,embed);

  }catch(error){
    console.error("Role update log error:",error);
  }
});

client.once("ready",async()=>{
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),
    {body:commands.map(command=>command.toJSON())}
  );
  await ensureTicketPanel().catch(error=>console.error("Ticket panel error:",error));
  console.log(`LSSD Database Bot online jako ${client.user.tag}`);
});

client.on("interactionCreate",async interaction=>{
  try{
    if(interaction.isStringSelectMenu() && interaction.customId==="ticket_type"){
      await interaction.deferReply({ephemeral:true});

      const type=interaction.values[0];
      const config=TICKET_TYPES[type];
      if(!config){
        await interaction.editReply("❌ Nieprawidłowy typ ticketu.");
        return;
      }

      const guild=interaction.guild;
      if(!guild){
        await interaction.editReply("❌ Ticket można utworzyć tylko na serwerze.");
        return;
      }

      await guild.channels.fetch().catch(()=>null);
      const existing=guild.channels.cache.find(ch=>
        ch.type===ChannelType.GuildText &&
        ch.topic?.includes(`ticket-owner:${interaction.user.id}`) &&
        !ch.name.startsWith("closed-")
      );

      if(existing){
        await interaction.editReply(`Masz już otwarty ticket: ${existing.toString()}`);
        return;
      }

      const panelChannel=await guild.channels.fetch(process.env.TICKET_PANEL_CHANNEL_ID).catch(()=>null);
      const staffRoleIds=ticketStaffRoleIds(guild);
      const safeUser=interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g,"").slice(0,24) || "user";

      const permissionOverwrites=[
        {
          id:guild.roles.everyone.id,
          deny:[PermissionFlagsBits.ViewChannel]
        },
        {
          id:interaction.user.id,
          allow:[
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id:client.user.id,
          allow:[
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        ...staffRoleIds.map(id=>({
          id,
          allow:[
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        }))
      ];

      const ticket=await guild.channels.create({
        name:`ticket-${safeUser}`,
        type:ChannelType.GuildText,
        parent:panelChannel?.parentId || undefined,
        topic:`ticket-owner:${interaction.user.id} | type:${type}`,
        permissionOverwrites
      });

      const embed=new EmbedBuilder()
        .setTitle(`${config.emoji} ${config.label.toUpperCase()} • TICKET`)
        .setDescription(
          `Witaj ${interaction.user.toString()}!\n\n` +
          "Opisz dokładnie swoją sprawę. Członek obsługi odpowie najszybciej jak to możliwe."
        )
        .addFields(
          {name:"Kategoria",value:config.label,inline:true},
          {name:"Autor",value:interaction.user.toString(),inline:true}
        )
        .setColor(0xC9AA51)
        .setFooter({text:"LSSD Ticket System"});

      const claim=new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Przejmij")
        .setEmoji("✋")
        .setStyle(ButtonStyle.Secondary);

      const close=new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Zamknij")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger);

      const highCommandPing=staffRoleIds.map(id=>`<@&${id}>`).join(" ");
      const ticketPing=[interaction.user.toString(),highCommandPing].filter(Boolean).join(" • ");

      await ticket.send({
        content:ticketPing,
        embeds:[embed],
        components:[new ActionRowBuilder().addComponents(claim,close)],
        allowedMentions:{users:[interaction.user.id],roles:staffRoleIds}
      });

      await interaction.editReply(`✅ Ticket utworzony: ${ticket.toString()}`);
      return;
    }

    if(interaction.isButton() && interaction.customId==="ticket_claim"){
      if(!interaction.channel?.topic?.includes("ticket-owner:")){
        await interaction.reply({content:"❌ To nie jest kanał ticketu.",ephemeral:true});
        return;
      }

      await interaction.reply({
        content:`✋ Ticket przejął ${interaction.user.toString()}.`,
        allowedMentions:{users:[interaction.user.id]}
      });
      return;
    }

    if(interaction.isButton() && interaction.customId==="ticket_close"){
      if(!interaction.channel?.topic?.includes("ticket-owner:")){
        await interaction.reply({content:"❌ To nie jest kanał ticketu.",ephemeral:true});
        return;
      }

      await interaction.showModal(ticketCloseModal());
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="ticket_close_modal"){
      const reason=interaction.fields.getTextInputValue("close_reason").trim();
      await closeTicketChannel(interaction,reason);
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="zamknij"){
      const reason=interaction.options.getString("powod",true).trim();
      await closeTicketChannel(interaction,reason);
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="urlop"){
      await interaction.showModal(vacationModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="utrata-broni"){
      await interaction.showModal(weaponLossModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="plus"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(plusMinusModal("PLUS",target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="minus"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(plusMinusModal("MINUS",target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="zawias"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(suspensionModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="awans"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(promotionModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="degrad"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(demotionModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="zwolnienia"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(dismissalModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="wypowiedzenia"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(resignationModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="raport"){
      const type=interaction.options.getString("typ",true);
      if(type==="WEAPON_LOSS") await interaction.showModal(weaponLossModal());
      else if(type==="VACATION") await interaction.showModal(vacationModal());
      else if(type==="DEPUTY") await interaction.showModal(deputyReportModal());
      else await interaction.showModal(reportModal(type));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="database"){
      const menu=new StringSelectMenuBuilder()
        .setCustomId("database_type")
        .setPlaceholder("Wybierz rodzaj wpisu")
        .addOptions(
          {label:"Raport DTU",value:"DTU",description:"Detective Task Unit"},
          {label:"Raport SERT",value:"SERT",description:"Special Emergency Response Team"},
          {label:"Raport IAD",value:"IAD",description:"Internal Affairs Division"},
          {label:"Raport zastępcy",value:"DEPUTY",description:"Raport patrolowy zastępcy"},
          {label:"Raport o utracie broni",value:"WEAPON_LOSS",description:"Zgłoszenie utraty broni służbowej"},
          {label:"Urlop",value:"VACATION",description:"Złóż wniosek urlopowy"},
          {label:"Plus",value:"PLUS",description:"Nadaj plus funkcjonariuszowi"},
          {label:"Minus",value:"MINUS",description:"Nadaj minus funkcjonariuszowi"},
          {label:"Zawieszenie",value:"SUSPENSION",description:"Rejestracja zawieszenia funkcjonariusza"},
          {label:"Awans",value:"PROMOTION",description:"Rejestracja awansu"},
          {label:"Degradacja",value:"DEMOTION",description:"Rejestracja obniżenia stopnia"},
          {label:"Zwolnienie",value:"DISMISSAL",description:"Rejestracja zakończenia służby"},
          {label:"Wypowiedzenie",value:"RESIGNATION",description:"Rejestracja wypowiedzenia"}
        );

      await interaction.reply({
        content:"**LSSD Records Database**\nWybierz rodzaj wpisu:",
        components:[new ActionRowBuilder().addComponents(menu)],
        ephemeral:true
      });
      return;
    }

    if(interaction.isStringSelectMenu() && interaction.customId==="database_type"){
      const type=interaction.values[0];

      if(["PLUS","MINUS","SUSPENSION","PROMOTION","DEMOTION","DISMISSAL","RESIGNATION"].includes(type)){
        await interaction.update({
          content:"**LSSD Records Database**\nWybierz funkcjonariusza:",
          components:[new ActionRowBuilder().addComponents(personnelTargetMenu(type))]
        });
        return;
      }

      if(type==="WEAPON_LOSS") await interaction.showModal(weaponLossModal());
      else if(type==="DEPUTY") await interaction.showModal(deputyReportModal());
      else await interaction.showModal(reportModal(type));
      return;
    }

    if(interaction.isUserSelectMenu() && interaction.customId.startsWith("personnel_target:")){
      const type=interaction.customId.split(":")[1];
      const targetUserId=interaction.values[0];

      if(type==="PLUS" || type==="MINUS") await interaction.showModal(plusMinusModal(type,targetUserId));
      else if(type==="SUSPENSION") await interaction.showModal(suspensionModal(targetUserId));
      else if(type==="PROMOTION") await interaction.showModal(promotionModal(targetUserId));
      else if(type==="DEMOTION") await interaction.showModal(demotionModal(targetUserId));
      else if(type==="DISMISSAL") await interaction.showModal(dismissalModal(targetUserId));
      else if(type==="RESIGNATION") await interaction.showModal(resignationModal(targetUserId));
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="deputy_report_modal"){
      await interaction.deferReply({ephemeral:true});

      const reportDate=interaction.fields.getTextInputValue("report_date").trim();
      const officer=interaction.fields.getTextInputValue("officer").trim();
      const badge=interaction.fields.getTextInputValue("badge").trim();
      const patrolDescription=interaction.fields.getTextInputValue("patrol_description").trim();
      const signature=interaction.fields.getTextInputValue("signature").trim();

      const row=await supabaseInsert("reports",{
        report_type:"DEPUTY",
        title:"Raport zastępcy",
        subject:`Od: ${officer} ${badge}`,
        badge_number:badge,
        details:`Data raportu: ${reportDate}\n\nPrzebieg patrolu:\n${patrolDescription}\n\nZ wyrazami szacunku\n${officer}\n${signature}`,
        author_discord_id:interaction.user.id,
        author_discord_name:officer
      });

      await publishReportLog(interaction,row);
      await interaction.editReply(`✅ **Raport zastępcy** został zapisany w Database. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="weapon_loss_modal"){
      await interaction.deferReply({ephemeral:true});

      const serial=interaction.fields.getTextInputValue("serial_number").trim();
      const model=interaction.fields.getTextInputValue("weapon_model").trim();
      const lossDateTime=interaction.fields.getTextInputValue("loss_datetime").trim();
      const badge=interaction.fields.getTextInputValue("badge").trim();
      const circumstances=interaction.fields.getTextInputValue("circumstances").trim();
      const officerName=cleanOfficerName(interaction);

      const row=await supabaseInsert("reports",{
        report_type:"WEAPON_LOSS",
        title:"Raport o utracie broni",
        subject:`SN: ${serial} | Model: ${model}`,
        badge_number:badge,
        details:`Data i godzina utraty: ${lossDateTime}\n\nOpis okoliczności utraty:\n${circumstances}\n\nPodpis: ${officerName} [${badge}]`,
        author_discord_id:interaction.user.id,
        author_discord_name:officerName
      });

      await publishWeaponLossLog(interaction,row);
      await interaction.editReply(`✅ **Raport o utracie broni** został zapisany w Database. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="vacation_modal"){
      await interaction.deferReply();

      const officer=cleanOfficerName(interaction);
      const rank=interaction.fields.getTextInputValue("rank").trim();
      const fromDate=interaction.fields.getTextInputValue("from_date").trim();
      const toDate=interaction.fields.getTextInputValue("to_date").trim();
      const reason=interaction.fields.getTextInputValue("reason").trim();

      const row=await supabaseInsert("reports",{
        report_type:"VACATION",
        title:"Wniosek urlopowy",
        subject:officer,
        badge_number:null,
        details:`Stopień: ${rank}\nTermin urlopu: Od: ${fromDate} | Do: ${toDate}\nPowód:\n${reason}`,
        author_discord_id:interaction.user.id,
        author_discord_name:officer
      });

      const notice=await publishVacationLog(interaction,row);
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("report_modal:")){
      const type=interaction.customId.split(":")[1];
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("reports",{
        report_type:type,
        title:interaction.fields.getTextInputValue("title"),
        subject:interaction.fields.getTextInputValue("subject"),
        badge_number:interaction.fields.getTextInputValue("badge"),
        details:interaction.fields.getTextInputValue("details"),
        author_discord_id:interaction.user.id,
        author_discord_name:interaction.user.globalName || interaction.user.username
      });

      await publishReportLog(interaction,row);
      await interaction.editReply(`✅ Raport **${type}** został zapisany w bazie. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("suspension_modal:")){
      await interaction.deferReply();

      const targetUserId=interaction.customId.split(":")[1];
      const targetMember=await interaction.guild?.members.fetch(targetUserId).catch(()=>null);
      const targetUser=targetMember?.user || await client.users.fetch(targetUserId).catch(()=>null);
      const rawTargetName=targetMember?.displayName || targetUser?.globalName || targetUser?.username || "Nieznany funkcjonariusz";
      const officer=String(rawTargetName)
        .replace(/^\s*\[[^\]]+\]\s*/,"")
        .replace(/^\s*\([^\)]+\)\s*/,"")
        .trim();

      const rank=interaction.fields.getTextInputValue("rank").trim();
      const fromDate=interaction.fields.getTextInputValue("from_date").trim();
      const toDate=interaction.fields.getTextInputValue("to_date").trim();
      const reason=interaction.fields.getTextInputValue("reason").trim();
      const decisionBy=cleanOfficerName(interaction);

      const row=await supabaseInsert("reports",{
        report_type:"SUSPENSION",
        title:"Zawieszenie funkcjonariusza",
        subject:officer,
        badge_number:null,
        details:`Stopień: ${rank}\nOkres zawieszenia: od ${fromDate} do ${toDate}\nDecyzję wydał: ${decisionBy}\nPowód:\n${reason}`,
        author_discord_id:interaction.user.id,
        author_discord_name:decisionBy
      });

      const notice=await publishSuspensionLog(interaction,row,targetUserId);
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("promotion_modal:")){
      await interaction.deferReply();
      const targetUserId=interaction.customId.split(":")[1];
      const officer=await getTargetOfficerName(interaction,targetUserId);
      const oldRank=interaction.fields.getTextInputValue("old_rank").trim();
      const newRank=interaction.fields.getTextInputValue("new_rank").trim();

      let roleChange;
      try{
        roleChange=await applyPromotionRoles(interaction,targetUserId,oldRank,newRank);
      }catch(error){
        console.error("Promotion role change error:",error);
        roleChange={ok:false,message:"Nie udało się automatycznie zmienić rangi na Discordzie."};
      }

      const row=await supabaseInsert("promotions",{
        officer_name:officer,
        badge_number:null,
        old_rank:oldRank,
        new_rank:newRank,
        reason:interaction.fields.getTextInputValue("reason").trim(),
        decision_date:interaction.fields.getTextInputValue("decision_date").trim(),
        promoted_by:cleanOfficerName(interaction),
        promoted_by_discord_id:interaction.user.id
      });

      const notice=await publishPersonnelChange(interaction,row,"PROMOTION",targetUserId);
      notice.content += roleChange.ok
        ? `\n✅ ${roleChange.message}`
        : `\n⚠️ ${roleChange.message}`;
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("demotion_modal:")){
      await interaction.deferReply();
      const targetUserId=interaction.customId.split(":")[1];
      const officer=await getTargetOfficerName(interaction,targetUserId);

      let roleChange;
      try{
        roleChange=await applyAutomaticDemotion(interaction,targetUserId);
      }catch(error){
        console.error("Demotion role change error:",error);
        roleChange={ok:false,message:"Nie udało się automatycznie zmienić rangi na Discordzie."};
      }

      if(!roleChange.ok){
        await interaction.editReply(`❌ ${roleChange.message}`);
        return;
      }

      const row=await supabaseInsert("demotions",{
        officer_name:officer,
        badge_number:null,
        old_rank:roleChange.oldRank,
        new_rank:roleChange.newRank,
        reason:interaction.fields.getTextInputValue("reason").trim(),
        decision_date:interaction.fields.getTextInputValue("decision_date").trim(),
        demoted_by:cleanOfficerName(interaction),
        demoted_by_discord_id:interaction.user.id
      });

      const notice=await publishPersonnelChange(interaction,row,"DEMOTION",targetUserId);
      notice.content += `\n✅ ${roleChange.message}`;
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("discipline_modal:")){
      await interaction.deferReply();
      const [,type,targetUserId]=interaction.customId.split(":");
      const officer=await getTargetOfficerName(interaction,targetUserId);
      const rank=interaction.fields.getTextInputValue("rank").trim();
      const reason=interaction.fields.getTextInputValue("reason").trim();
      const date=interaction.fields.getTextInputValue("decision_date").trim();
      const actor=cleanOfficerName(interaction);

      const row=await supabaseInsert("reports",{
        report_type:type,
        title:type==="PLUS" ? "Plus funkcjonariusza" : "Minus funkcjonariusza",
        subject:officer,
        badge_number:null,
        details:`Stopień: ${rank}\nNadane przez: ${actor}\nPowód:\n${reason}\nData: ${date}`,
        author_discord_id:interaction.user.id,
        author_discord_name:actor
      });

      const notice=await publishDisciplineLog(interaction,row,type,targetUserId);
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("dismissal_modal:")){
      await interaction.deferReply();
      const targetUserId=interaction.customId.split(":")[1];
      const officer=await getTargetOfficerName(interaction,targetUserId);

      const row=await supabaseInsert("dismissals",{
        officer_name:officer,
        badge_number:null,
        rank:interaction.fields.getTextInputValue("rank").trim(),
        reason:interaction.fields.getTextInputValue("reason").trim(),
        dismissal_date:interaction.fields.getTextInputValue("dismissal_date").trim(),
        dismissed_by:cleanOfficerName(interaction),
        dismissed_by_discord_id:interaction.user.id
      });

      const notice=await publishPersonnelChange(interaction,row,"DISMISSAL",targetUserId);
      await interaction.editReply(notice);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId.startsWith("resignation_modal:")){
      await interaction.deferReply();
      const targetUserId=interaction.customId.split(":")[1];
      const officer=await getTargetOfficerName(interaction,targetUserId);

      const row=await supabaseInsert("resignations",{
        officer_name:officer,
        badge_number:null,
        rank:interaction.fields.getTextInputValue("rank").trim(),
        submitted_date:interaction.fields.getTextInputValue("submitted_date").trim(),
        end_date:interaction.fields.getTextInputValue("end_date").trim(),
        reason:interaction.fields.getTextInputValue("reason").trim(),
        submitted_by:cleanOfficerName(interaction),
        submitted_by_discord_id:interaction.user.id
      });

      const notice=await publishPersonnelChange(interaction,row,"RESIGNATION",targetUserId);
      await interaction.editReply(notice);
      return;
    }

  }catch(error){
    console.error(error);
    const msg="❌ Nie udało się zapisać wpisu. Sprawdź konfigurację bota i Supabase.";
    if(interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(()=>{});
    else await interaction.reply({content:msg,ephemeral:true}).catch(()=>{});
  }
});

startWebApi({writeRecord:supabaseWrite});

client.login(process.env.DISCORD_TOKEN);
