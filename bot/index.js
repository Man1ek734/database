import "dotenv/config";
import { startWebApi } from "./webapi.js";
import {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
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

const client=new Client({intents:[GatewayIntentBits.Guilds]});

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
  new SlashCommandBuilder().setName("zawias").setDescription("Zarejestruj zawieszenie funkcjonariusza")
    .addUserOption(o=>o.setName("funkcjonariusz").setDescription("Osoba, którą zawieszasz").setRequired(true)),
  new SlashCommandBuilder().setName("awans").setDescription("Zarejestruj awans funkcjonariusza"),
  new SlashCommandBuilder().setName("degrad").setDescription("Zarejestruj degradację funkcjonariusza"),
  new SlashCommandBuilder().setName("zwolnienia").setDescription("Zarejestruj zwolnienie funkcjonariusza"),
  new SlashCommandBuilder().setName("wypowiedzenia").setDescription("Zarejestruj wypowiedzenie funkcjonariusza")
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

function promotionModal(){
  const modal=new ModalBuilder()
    .setCustomId("promotion_modal")
    .setTitle("Rejestracja awansu");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("officer","Funkcjonariusz — Imię Nazwisko")),
    new ActionRowBuilder().addComponents(input("old_rank","Poprzedni stopień",TextInputStyle.Short,true,"np. Deputy Sheriff I")),
    new ActionRowBuilder().addComponents(input("new_rank","Nowy stopień",TextInputStyle.Short,true,"np. Deputy Sheriff II")),
    new ActionRowBuilder().addComponents(input("reason","Powód",TextInputStyle.Paragraph,true,"Podaj powód awansu")),
    new ActionRowBuilder().addComponents(input("decision_date","Data",TextInputStyle.Short,true,"DD.MM.RRRR"))
  );
  return modal;
}

function demotionModal(){
  const modal=new ModalBuilder()
    .setCustomId("demotion_modal")
    .setTitle("Rejestracja degradacji");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("officer","Imię i nazwisko funkcjonariusza")),
    new ActionRowBuilder().addComponents(input("badge","Numer odznaki")),
    new ActionRowBuilder().addComponents(input("old_rank","Poprzedni stopień")),
    new ActionRowBuilder().addComponents(input("new_rank","Nowy stopień")),
    new ActionRowBuilder().addComponents(input("reason","Powód / uzasadnienie",TextInputStyle.Paragraph,true,"Krótko opisz podstawę degradacji"))
  );
  return modal;
}

function dismissalModal(){
  const modal=new ModalBuilder()
    .setCustomId("dismissal_modal")
    .setTitle("Rejestracja zwolnienia");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("officer","Imię i nazwisko funkcjonariusza")),
    new ActionRowBuilder().addComponents(input("badge","Numer odznaki")),
    new ActionRowBuilder().addComponents(input("rank","Stopień w momencie zwolnienia")),
    new ActionRowBuilder().addComponents(input("reason","Powód / uzasadnienie",TextInputStyle.Paragraph,true,"Krótko opisz podstawę zwolnienia"))
  );
  return modal;
}

function resignationModal(){
  const modal=new ModalBuilder()
    .setCustomId("resignation_modal")
    .setTitle("Rejestracja wypowiedzenia");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("officer","Imię i nazwisko funkcjonariusza")),
    new ActionRowBuilder().addComponents(input("badge","Numer odznaki")),
    new ActionRowBuilder().addComponents(input("rank","Aktualny stopień")),
    new ActionRowBuilder().addComponents(input("end_date","Ostatni dzień służby",TextInputStyle.Short,false,"np. 30.09.2026")),
    new ActionRowBuilder().addComponents(input("reason","Powód / treść wypowiedzenia",TextInputStyle.Paragraph,true,"Krótko opisz wypowiedzenie"))
  );
  return modal;
}

async function publishPersonnelChange(interaction,row,type){
  const channelId =
    type==="PROMOTION" ? process.env.PROMOTION_CHANNEL_ID :
    type==="DEMOTION" ? (process.env.DEMOTION_CHANNEL_ID || process.env.PROMOTION_CHANNEL_ID) :
    type==="DISMISSAL" ? (process.env.DISMISSAL_CHANNEL_ID || process.env.PROMOTION_CHANNEL_ID) :
    (process.env.RESIGNATION_CHANNEL_ID || process.env.DISMISSAL_CHANNEL_ID || process.env.PROMOTION_CHANNEL_ID);

  if(!channelId) return;
  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

  const title =
    type==="PROMOTION" ? "LSSD • PROMOTION NOTICE" :
    type==="DEMOTION" ? "LSSD • DEMOTION NOTICE" :
    type==="DISMISSAL" ? "LSSD • DISMISSAL NOTICE" :
    "LSSD • RESIGNATION NOTICE";

  const description =
    type==="PROMOTION" ? `**${row.officer_name}** otrzymuje awans.` :
    type==="DEMOTION" ? `**${row.officer_name}** otrzymuje degradację.` :
    type==="DISMISSAL" ? `**${row.officer_name}** zostaje zwolniony ze służby.` :
    `**${row.officer_name}** składa wypowiedzenie ze służby.`;

  const fields=[];

  if(type==="PROMOTION"){
    fields.push(
      {name:"Funkcjonariusz",value:row.officer_name || "—",inline:false},
      {name:"Poprzedni stopień",value:row.old_rank || "—",inline:false},
      {name:"Nowy stopień",value:row.new_rank || "—",inline:false},
      {name:"Decyzję wydał",value:row.promoted_by || cleanOfficerName(interaction),inline:false},
      {name:"Powód",value:row.reason || "—",inline:false},
      {name:"Data",value:row.decision_date || "—",inline:false}
    );
  }else{
    fields.push({name:"Numer odznaki",value:row.badge_number || "—",inline:true});

    if(type==="DEMOTION"){
      fields.push(
        {name:"Poprzedni stopień",value:row.old_rank || "—",inline:true},
        {name:"Nowy stopień",value:row.new_rank || "—",inline:true}
      );
    }else{
      fields.push({name:"Stopień",value:row.rank || "—",inline:true});
    }

    if(type==="RESIGNATION" && row.end_date){
      fields.push({name:"Ostatni dzień służby",value:row.end_date,inline:true});
    }

    fields.push(
      {name:"Uzasadnienie",value:row.reason || "—"},
      {name:"Wprowadził",value:interaction.user.toString()}
    );
  }

  const embed=new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setColor(type==="PROMOTION" ? 0xC9AA51 : type==="DEMOTION" ? 0xD98C3F : type==="DISMISSAL" ? 0xB84A55 : 0x7A8AA0)
    .setFooter({text:"Los Santos Sheriff's Department • Station 11 — Davis Avenue"})
    .setTimestamp();

  await channel.send({embeds:[embed]});
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
    .setFooter({text:"Los Santos Sheriff's Department • Station 11 — Davis Avenue"})
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

async function publishSuspensionLog(interaction,row,targetUserId){
  const channelId=process.env.DATABASE_LOG_CHANNEL_ID;
  if(!channelId) return;

  const channel=await client.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return;

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
      {name:"⚖️ Decyzję wydał",value:decisionBy,inline:false},
      {name:"📝 Powód",value:reason || "—",inline:false}
    )
    .setColor(0xD98C3F)
    .setFooter({text:"Los Santos Sheriff's Department • Station 11 — Davis Avenue"})
    .setTimestamp();

  await channel.send({
    content:`<@${targetUserId}>`,
    embeds:[embed],
    allowedMentions:{users:[targetUserId]}
  });
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

client.once("ready",async()=>{
  const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),
    {body:commands.map(command=>command.toJSON())}
  );
  console.log(`LSSD Database Bot online jako ${client.user.tag}`);
});

client.on("interactionCreate",async interaction=>{
  try{
    if(interaction.isChatInputCommand() && interaction.commandName==="utrata-broni"){
      await interaction.showModal(weaponLossModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="zawias"){
      const target=interaction.options.getUser("funkcjonariusz",true);
      await interaction.showModal(suspensionModal(target.id));
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="awans"){
      await interaction.showModal(promotionModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="degrad"){
      await interaction.showModal(demotionModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="zwolnienia"){
      await interaction.showModal(dismissalModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="wypowiedzenia"){
      await interaction.showModal(resignationModal());
      return;
    }

    if(interaction.isChatInputCommand() && interaction.commandName==="raport"){
      const type=interaction.options.getString("typ",true);
      if(type==="WEAPON_LOSS") await interaction.showModal(weaponLossModal());
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
      if(type==="PROMOTION") await interaction.showModal(promotionModal());
      else if(type==="DEMOTION") await interaction.showModal(demotionModal());
      else if(type==="DISMISSAL") await interaction.showModal(dismissalModal());
      else if(type==="RESIGNATION") await interaction.showModal(resignationModal());
      else if(type==="WEAPON_LOSS") await interaction.showModal(weaponLossModal());
      else if(type==="DEPUTY") await interaction.showModal(deputyReportModal());
      else await interaction.showModal(reportModal(type));
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
      await interaction.deferReply({ephemeral:true});

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

      await publishSuspensionLog(interaction,row,targetUserId);
      await interaction.editReply(`✅ Zawieszenie **${officer}** zostało zapisane i opublikowane. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="promotion_modal"){
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("promotions",{
        officer_name:interaction.fields.getTextInputValue("officer").trim(),
        badge_number:null,
        old_rank:interaction.fields.getTextInputValue("old_rank").trim(),
        new_rank:interaction.fields.getTextInputValue("new_rank").trim(),
        reason:interaction.fields.getTextInputValue("reason").trim(),
        decision_date:interaction.fields.getTextInputValue("decision_date").trim(),
        promoted_by:cleanOfficerName(interaction),
        promoted_by_discord_id:interaction.user.id
      });

      await publishPersonnelChange(interaction,row,"PROMOTION");
      await interaction.editReply(`✅ Awans został zapisany w bazie i opublikowany na Discordzie. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="demotion_modal"){
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("demotions",{
        officer_name:interaction.fields.getTextInputValue("officer"),
        badge_number:interaction.fields.getTextInputValue("badge"),
        old_rank:interaction.fields.getTextInputValue("old_rank"),
        new_rank:interaction.fields.getTextInputValue("new_rank"),
        reason:interaction.fields.getTextInputValue("reason"),
        demoted_by:interaction.user.globalName || interaction.user.username,
        demoted_by_discord_id:interaction.user.id
      });

      await publishPersonnelChange(interaction,row,"DEMOTION");
      await interaction.editReply(`✅ Degradacja została zapisana w bazie i opublikowana na Discordzie. ID: \`${row.id}\``);
      return;
    }

    if(interaction.isModalSubmit() && interaction.customId==="dismissal_modal"){
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("dismissals",{
        officer_name:interaction.fields.getTextInputValue("officer"),
        badge_number:interaction.fields.getTextInputValue("badge"),
        rank:interaction.fields.getTextInputValue("rank"),
        reason:interaction.fields.getTextInputValue("reason"),
        dismissed_by:interaction.user.globalName || interaction.user.username,
        dismissed_by_discord_id:interaction.user.id
      });

      await publishPersonnelChange(interaction,row,"DISMISSAL");
      await interaction.editReply(`✅ Zwolnienie zostało zapisane w bazie i opublikowane na Discordzie. ID: \`${row.id}\``);
    }

    if(interaction.isModalSubmit() && interaction.customId==="resignation_modal"){
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("resignations",{
        officer_name:interaction.fields.getTextInputValue("officer"),
        badge_number:interaction.fields.getTextInputValue("badge"),
        rank:interaction.fields.getTextInputValue("rank"),
        end_date:interaction.fields.getTextInputValue("end_date") || null,
        reason:interaction.fields.getTextInputValue("reason"),
        submitted_by:interaction.user.globalName || interaction.user.username,
        submitted_by_discord_id:interaction.user.id
      });

      await publishPersonnelChange(interaction,row,"RESIGNATION");
      await interaction.editReply(`✅ Wypowiedzenie zostało zapisane w bazie i opublikowane na Discordzie. ID: \`${row.id}\``);
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
