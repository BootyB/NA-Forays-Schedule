// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const encryptedDb = require('../../config/encryptedDatabase');
const { buildConfigMenu } = require('../../utils/configMenuBuilder');
const serviceLocator = require('../../services/serviceLocator');
const { mapRaidTypes } = require('../../utils/raidTypes');
const { canCreateChannels } = require('../../utils/channelPermissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('na-schedule')
    .setDescription('Manage NA datacenter raid schedule configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  
  async execute(interaction) {
    const whitelistManager = serviceLocator.get('whitelistManager');
    const guildId = interaction.guild.id;

    const isWhitelisted = await whitelistManager.isGuildWhitelisted(guildId);
    
    if (!isWhitelisted) {
      await interaction.reply({
        content: 
          '❌ **This server is not whitelisted.**\n\n' +
          'This bot is currently in private beta. Please contact the bot owner to request access.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const existingConfig = await encryptedDb.getServerConfig(guildId);

    if (!existingConfig || !existingConfig.setup_complete) {
      await showSetupWizard(interaction);
    } else {
      await showConfigurationMenu(interaction, existingConfig);
    }
  }
};

async function showSetupWizard(interaction) {
  const container = new ContainerBuilder();

  const headerText = 
    `## 🎉 Welcome to NA Forays Schedule Bot Setup!\n\n` +
    `This wizard will help you configure schedule displays for your Discord server.\n\n` +
    `**First Step: Select Raid Types**\n` +
    `Choose which raid schedules you want to display:\n` +
    `● **BA** - Baldesion Arsenal\n` +
    `● **FT** - Forked Tower\n` +
    `● **DRS** - Delubrum Reginae Savage\n\n` +
    `You can select one or more raid types.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerText)
  );

  // Check for ManageChannels permission
  const botMember = await interaction.guild.members.fetchMe();
  const createCheck = await canCreateChannels(interaction.guild, botMember);
  const lacksManageChannels = !createCheck.canCreate && createCheck.reason && createCheck.reason.includes('Manage Channels');

  if (lacksManageChannels) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    const permissionNote = 
      `**ℹ️ Note: Automatic Channel Creation Not Available**\n\n` +
      `The bot was not granted "Manage Channels" permission during installation. ` +
      `This permission is optional, but required for automatic channel creation.\n\n` +
      `You can still use the bot by selecting existing channels during setup. ` +
      `You will need to manually add the bot's role to these channels and setup the required permissions.\n\n`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(permissionNote)
    );
  }

  const raidSelect = new StringSelectMenuBuilder()
    .setCustomId('setup_select_raids')
    .setPlaceholder('Select raid types to display')
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      mapRaidTypes((raidType, info) => ({
        label: `${info.name} (${raidType})`,
        description: `Display ${raidType} schedules`,
        value: raidType,
        emoji: info.emoji
      }))
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(raidSelect)
  );

  await interaction.reply({
    components: [container],
    flags: 64 | 32768
  });

  logger.info('Setup wizard started', {
    guildId: interaction.guild.id,
    user: interaction.user.tag
  });
}

async function showConfigurationMenu(interaction, config) {
  const container = buildConfigMenu(config, interaction.guild);

  await interaction.reply({
    components: [container],
    flags: 64 | 32768
  });

  logger.info('Configuration menu opened', {
    guildId: interaction.guild.id,
    user: interaction.user.tag
  });
}
