// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const encryptedDb = require('../../config/encryptedDatabase');
const serviceLocator = require('../../services/serviceLocator');
const { ALL_RAID_TYPES, getScheduleChannelKey, getScheduleOverviewKey, getScheduleMessageKey } = require('../../utils/raidTypes');

async function showResetConfirmation(interaction) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '## ⚠️ Reset Configuration?\n\n' +
      'This will **permanently delete** all bot configuration for this server:\n' +
      '● All raid type settings\n' +
      '● Channel assignments\n' +
      '● Host server selections\n' +
      '● Custom accent colors\n' +
      '● All active schedule containers (overview and schedule messages)\n\n' +
      '**This action cannot be undone!**'
    )
  );

  const confirmButton = new ButtonBuilder()
    .setCustomId('config_reset_confirmed')
    .setLabel('Yes, Reset Everything')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId('config_back')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(confirmButton, cancelButton)
  );

  await interaction.update({
    components: [container],
    flags: 64 | 32768
  });
}

async function resetConfiguration(interaction) {
  const guildId = interaction.guild.id;

  try {
    await interaction.deferUpdate();
    
    const config = await encryptedDb.getServerConfig(guildId);

    if (config) {
      await deleteAllScheduleMessages(interaction.guild, config);
    }

    const updateManager = serviceLocator.get('updateManager');
    if (updateManager && updateManager.stateManager) {
      await updateManager.stateManager.clearStateForGuild(guildId);
    }

    await encryptedDb.deleteServerConfig(guildId);

    const successContainer = new ContainerBuilder();
    successContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '✅ **Configuration Reset Complete**\n\n' +
        'All settings have been cleared. Run `/na-schedule` to set up the bot again.'
      )
    );

    await interaction.editReply({
      components: [successContainer],
      flags: 64 | 32768
    });

    logger.info('Configuration reset', {
      guildId,
      user: interaction.user.tag
    });

  } catch (error) {
    logger.error('Error resetting configuration', {
      error: error.message,
      guildId
    });

    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Error resetting configuration. Please try again.')
    );
    await interaction.editReply({
      components: [errorContainer],
      flags: 64 | 32768
    });
  }
}

async function deleteAllScheduleMessages(guild, config) {
  for (const raidType of ALL_RAID_TYPES) {
    const channelKey = getScheduleChannelKey(raidType);
    const channelId = config[channelKey];
    
    if (!channelId) continue;

    try {
      const channel = await guild.channels.fetch(channelId);
      
      const overviewKey = getScheduleOverviewKey(raidType);
      const overviewId = config[overviewKey];
      if (overviewId) {
        await deleteMessage(channel, overviewId, 'overview', raidType, guild.id);
      }
      
      const messageKey = getScheduleMessageKey(raidType);
      const messageIds = config[messageKey];
      if (messageIds) {
        const parsedIds = Array.isArray(messageIds) ? messageIds : JSON.parse(messageIds);
        for (const msgId of parsedIds) {
          await deleteMessage(channel, msgId, 'schedule', raidType, guild.id);
        }
      }
    } catch (err) {
      logger.debug('Could not access channel', { channelId });
    }
  }
}

async function deleteMessage(channel, messageId, messageType, raidType, guildId) {
  try {
    const message = await channel.messages.fetch(messageId);
    await message.delete();
    logger.debug(`Deleted ${messageType} message`, { guildId, raidType, messageId });
  } catch (err) {
    logger.debug(`Could not delete ${messageType} message`, { messageId });
  }
}

module.exports = {
  showResetConfirmation,
  resetConfiguration
};
