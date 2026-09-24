import "dotenv/config";
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
  "DISCORD_GUILD_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
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
        {name:"Deputy",value:"DEPUTY"}
      )),
  new SlashCommandBuilder().setName("awans").setDescription("Zarejestruj awans funkcjonariusza"),
  new SlashCommandBuilder().setName("degrad").setDescription("Zarejestruj degradację funkcjonariusza"),
  new SlashCommandBuilder().setName("zwolnienia").setDescription("Zarejestruj zwolnienie funkcjonariusza"),
  new SlashCommandBuilder().setName("wypowiedzenia").setDescription("Zarejestruj wypowiedzenie funkcjonariusza")
];

async function supabaseInsert(table,payload){
  const res=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer:"return=representation"
    },
    body:JSON.stringify(payload)
  });

  if(!res.ok){
    const body=await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }

  const data=await res.json();
  return data[0];
}

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

function promotionModal(){
  const modal=new ModalBuilder()
    .setCustomId("promotion_modal")
    .setTitle("Rejestracja awansu");

  modal.addComponents(
    new ActionRowBuilder().addComponents(input("officer","Imię i nazwisko funkcjonariusza")),
    new ActionRowBuilder().addComponents(input("badge","Numer odznaki")),
    new ActionRowBuilder().addComponents(input("old_rank","Poprzedni stopień")),
    new ActionRowBuilder().addComponents(input("new_rank","Nowy stopień")),
    new ActionRowBuilder().addComponents(input("reason","Powód / uzasadnienie",TextInputStyle.Paragraph,true,"Krótko opisz podstawę awansu"))
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

  const fields=[{name:"Numer odznaki",value:row.badge_number || "—",inline:true}];

  if(type==="PROMOTION" || type==="DEMOTION"){
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
      await interaction.showModal(reportModal(type));
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
          {label:"Raport Deputy",value:"DEPUTY",description:"Raport funkcjonariusza patrolowego"},
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
      else await interaction.showModal(reportModal(type));
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

    if(interaction.isModalSubmit() && interaction.customId==="promotion_modal"){
      await interaction.deferReply({ephemeral:true});

      const row=await supabaseInsert("promotions",{
        officer_name:interaction.fields.getTextInputValue("officer"),
        badge_number:interaction.fields.getTextInputValue("badge"),
        old_rank:interaction.fields.getTextInputValue("old_rank"),
        new_rank:interaction.fields.getTextInputValue("new_rank"),
        reason:interaction.fields.getTextInputValue("reason"),
        promoted_by:interaction.user.globalName || interaction.user.username,
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

client.login(process.env.DISCORD_TOKEN);
