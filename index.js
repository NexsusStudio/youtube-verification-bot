require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, Partials, Collection, Events,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
  ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "requests.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ requests: {} }, null, 2));

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (e) { console.error("Could not read data file:", e); return { requests: {} }; }
}
function writeData(data) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function safeId(value) { return String(value || "").replace(/[^0-9]/g, ""); }
function roleNames() {
  return {
    category: process.env.VERIFY_CATEGORY_NAME || "VERIFICATION",
    submit: process.env.VERIFY_SUBMIT_CHANNEL_NAME || "verification-submit",
    admin: process.env.VERIFY_ADMIN_CHANNEL_NAME || "verification-admin",
    subscriber: process.env.SUBSCRIBER_ROLE_NAME || "SUBSCRIBER"
  };
}
function trustedRoleIds() {
  return (process.env.ADMIN_ROLE_IDS || "").split(",").map(safeId).filter(Boolean);
}
function isTrusted(member, guild) {
  if (!member || !guild) return false;
  if (guild.ownerId === member.id) return true;
  const ids = trustedRoleIds();
  if (ids.length) return ids.some(id => member.roles.cache.has(id));
  return member.roles.cache.some(role => ["admin", "owner"].includes(role.name.toLowerCase()));
}
function validYouTubeLink(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return ["youtube.com", "m.youtube.com", "youtu.be"].includes(host) &&
      (u.protocol === "https:" || u.protocol === "http:");
  } catch { return false; }
}
function makeReviewEmbed(req) {
  return new EmbedBuilder()
    .setTitle("YouTube Verification Request")
    .setColor(req.status === "WAITING" ? 0xF1C40F : req.status === "APPROVED" ? 0x2ECC71 : 0xE74C3C)
    .addFields(
      { name: "Member", value: `<@${req.userId}> (${req.userTag || "unknown"})`, inline: false },
      { name: "YouTube Link", value: req.youtubeLink, inline: false },
      { name: "Status", value: `\`${req.status}\``, inline: true },
      { name: "Request ID", value: `\`${req.id}\``, inline: true }
    )
    .setImage(req.screenshotUrl)
    .setTimestamp(new Date(req.createdAt));
}
function reviewButtons(req) {
  const row = new ActionRowBuilder();
  if (req.status === "WAITING") {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ytverify:approve:${req.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ytverify:reject:${req.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
    );
  } else {
    row.addComponents(new ButtonBuilder().setCustomId(`ytverify:closed:${req.id}`).setLabel(req.status).setStyle(ButtonStyle.Secondary).setDisabled(true));
  }
  return row;
}
async function sendDM(user, content) {
  try { await user.send(content); return true; }
  catch { return false; }
}

client.once(Events.ClientReady, c => {
  console.log(`Bot online as ${c.user.tag}`);
  console.log(`Guild configured: ${process.env.GUILD_ID}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "verification-help") {
        return interaction.reply({
          content: `To request verification, open <#${await findSubmitChannelId(interaction.guild)}>, then use \`/verify\` with your YouTube link and a screenshot showing the subscription. Your request will be reviewed by the server team.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "setup-verification") {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: "Only a server manager can run this command.", ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const names = roleNames();

        let subscriberRole = guild.roles.cache.find(r => r.name === names.subscriber);
        if (!subscriberRole) subscriberRole = await guild.roles.create({ name: names.subscriber, color: 0x3498DB, reason: "YouTube verification setup" });

        let adminRole = guild.roles.cache.find(r => r.name === "Admin");
        if (!adminRole) adminRole = await guild.roles.create({ name: "Admin", color: 0xE67E22, reason: "YouTube verification setup; assign only to trusted staff" });
        let ownerRole = guild.roles.cache.find(r => r.name === "Owner");
        if (!ownerRole) ownerRole = await guild.roles.create({ name: "Owner", color: 0xE74C3C, reason: "YouTube verification setup; assign only to trusted staff" });

        let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === names.category);
        if (!category) category = await guild.channels.create({ name: names.category, type: ChannelType.GuildCategory });

        const staffRoles = [adminRole, ownerRole];
        const baseOverwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ManageChannels] },
          ...staffRoles.map(role => ({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }))
        ];

        let submit = guild.channels.cache.find(c => c.name === names.submit && c.parentId === category.id);
        if (!submit) submit = await guild.channels.create({
          name: names.submit, type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.EmbedLinks] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AttachFiles] }
          ]
        });

        let admin = guild.channels.cache.find(c => c.name === names.admin && c.parentId === category.id);
        if (!admin) admin = await guild.channels.create({
          name: names.admin, type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: baseOverwrites
        });
        else await admin.permissionOverwrites.set(baseOverwrites);

        const trustedIds = trustedRoleIds();
        const configHint = trustedIds.length
          ? `Configured trusted role IDs: ${trustedIds.join(", ")}`
          : "Approvals currently recognize the roles named exactly Admin and Owner, plus the server owner.";
        await interaction.editReply(
          `Setup complete.\n` +
          `• Subscriber role: <@&${subscriberRole.id}>\n` +
          `• Admin role: <@&${adminRole.id}>\n` +
          `• Owner role: <@&${ownerRole.id}>\n` +
          `• Submission channel: <#${submit.id}>\n` +
          `• Private review channel: <#${admin.id}>\n\n` +
          `Important: assign Admin/Owner only to trusted staff. These roles were created without Administrator permissions. Make sure the bot's role is above SUBSCRIBER in Server Settings → Roles.\n${configHint}`
        );
        return;
      }

      if (interaction.commandName === "verify") {
        if (!interaction.inGuild()) return interaction.reply({ content: "Use this command inside the Discord server.", ephemeral: true });
        const guild = interaction.guild;
        const submitChannelName = roleNames().submit;
        const submitChannel = guild.channels.cache.find(c => c.name === submitChannelName);
        if (submitChannel && interaction.channelId !== submitChannel.id) {
          return interaction.reply({ content: `Please use this command in <#${submitChannel.id}>.`, ephemeral: true });
        }

        const youtubeLink = interaction.options.getString("youtube_link", true).trim();
        const screenshot = interaction.options.getAttachment("screenshot", true);
        if (!validYouTubeLink(youtubeLink)) {
          return interaction.reply({ content: "That doesn't look like a valid YouTube link. Use a link from youtube.com or youtu.be.", ephemeral: true });
        }
        if (!screenshot.contentType?.startsWith("image/")) {
          return interaction.reply({ content: "Please attach an image screenshot (PNG, JPG, or WEBP).", ephemeral: true });
        }
        const adminChannel = guild.channels.cache.find(c => c.name === roleNames().admin && c.type === ChannelType.GuildText);
        if (!adminChannel) {
          return interaction.reply({ content: "Verification channels are not set up yet. Ask a server manager to run `/setup-verification`.", ephemeral: true });
        }

        const data = readData();
        const prior = Object.values(data.requests).find(r => r.userId === interaction.user.id && r.status === "WAITING");
        if (prior) return interaction.reply({ content: "You already have a request waiting for review. Please wait for an Admin/Owner.", ephemeral: true });

        const id = `${Date.now().toString(36)}-${interaction.user.id.slice(-4)}`;
        const req = {
          id, userId: interaction.user.id, userTag: interaction.user.tag,
          youtubeLink, screenshotUrl: screenshot.url, status: "WAITING",
          createdAt: new Date().toISOString(), reviewMessageId: null, reviewChannelId: adminChannel.id
        };
        data.requests[id] = req;
        writeData(data);

        const reviewMessage = await adminChannel.send({
          content: `New YouTube verification request from <@${interaction.user.id}>`,
          embeds: [makeReviewEmbed(req)],
          components: [reviewButtons(req)],
          allowedMentions: { users: [] }
        });
        req.reviewMessageId = reviewMessage.id;
        writeData(data);

        return interaction.reply({ content: `Your request has been submitted. Status: \`WAITING\`. The team will review it in <#${adminChannel.id}>.`, ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("ytverify:")) {
      const [, action, requestId] = interaction.customId.split(":");
      if (action === "closed") return interaction.reply({ content: "This request has already been reviewed.", ephemeral: true });
      if (!interaction.inGuild() || !isTrusted(interaction.member, interaction.guild)) {
        return interaction.reply({ content: "Only the server Owner or an authorized Admin/Owner role can review requests.", ephemeral: true });
      }
      const data = readData();
      const req = data.requests[requestId];
      if (!req) return interaction.reply({ content: "Request not found. It may have been lost if the bot's storage was reset.", ephemeral: true });
      if (req.status !== "WAITING") return interaction.reply({ content: `This request was already marked ${req.status}.`, ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const member = await guild.members.fetch(req.userId).catch(() => null);

      if (action === "approve") {
        const subscriberRole = guild.roles.cache.find(r => r.name === roleNames().subscriber);
        if (!subscriberRole) return interaction.editReply("SUBSCRIBER role not found. Ask a manager to run `/setup-verification` again.");
        if (!member) {
          req.status = "APPROVED";
          req.reviewedBy = interaction.user.id;
          req.reviewedAt = new Date().toISOString();
          writeData(data);
          await interaction.message.edit({ embeds: [makeReviewEmbed(req)], components: [reviewButtons(req)] });
          return interaction.editReply("Approved, but the member is no longer in this server, so the role could not be assigned.");
        }
        if (guild.members.me.roles.highest.comparePositionTo(subscriberRole) <= 0) {
          return interaction.editReply("I can't assign SUBSCRIBER because my bot role is not above that role. Move the bot role higher in Server Settings → Roles.");
        }
        await member.roles.add(subscriberRole, `YouTube verification approved by ${interaction.user.tag}`);
        req.status = "APPROVED";
        req.reviewedBy = interaction.user.id;
        req.reviewedAt = new Date().toISOString();
        writeData(data);
        await interaction.message.edit({ embeds: [makeReviewEmbed(req)], components: [reviewButtons(req)] });
        const dmSent = await sendDM(await client.users.fetch(req.userId), `✅ Your YouTube verification request in **${guild.name}** was approved. You have received the **${subscriberRole.name}** role.`);
        return interaction.editReply(`Approved. SUBSCRIBER role assigned.${dmSent ? " DM sent." : " I couldn't DM the member (their DMs may be closed)."}`);
      }

      if (action === "reject") {
        req.status = "REJECTED";
        req.reviewedBy = interaction.user.id;
        req.reviewedAt = new Date().toISOString();
        writeData(data);
        await interaction.message.edit({ embeds: [makeReviewEmbed(req)], components: [reviewButtons(req)] });
        const dmSent = await sendDM(await client.users.fetch(req.userId), `❌ Your YouTube verification request in **${guild.name}** was rejected. Please check your screenshot and YouTube link, then submit again with \`/verify\` when ready.`);
        return interaction.editReply(`Rejected. The member can submit another request.${dmSent ? " DM sent." : " I couldn't DM the member (their DMs may be closed)."}`);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);
    if (interaction.isRepliable()) {
      const message = "Something went wrong while processing that action. Check the bot logs for details.";
      try {
        if (interaction.deferred) await interaction.editReply(message);
        else if (!interaction.replied) await interaction.reply({ content: message, ephemeral: true });
      } catch {}
    }
  }
});

async function findSubmitChannelId(guild) {
  if (!guild) return "the server's verification channel";
  const ch = guild.channels.cache.find(c => c.name === roleNames().submit);
  return ch ? ch.id : "the verification channel";
}

client.login(process.env.DISCORD_TOKEN);
