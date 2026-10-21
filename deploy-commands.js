require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in environment.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup-verification")
    .setDescription("Create the YouTube verification roles and channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Submit your YouTube channel and screenshot for verification.")
    .addStringOption(o => o.setName("youtube_link").setDescription("Link to your YouTube channel or profile").setRequired(true))
    .addAttachmentOption(o => o.setName("screenshot").setDescription("Screenshot showing your YouTube subscription").setRequired(true)),
  new SlashCommandBuilder()
    .setName("verification-help")
    .setDescription("Show instructions for YouTube verification.")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
    process.exit(1);
  }
})();
