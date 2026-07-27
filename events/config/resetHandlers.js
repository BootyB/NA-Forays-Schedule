// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const encryptedDb = require('../../config/encryptedDatabase');
const serviceLocator = require('../../services/serviceLocator');
const { ALL_RAID_TYPES, getScheduleChannelKey, getScheduleOverviewKey, getScheduleMessageKey } = require('../../utils/raidTypes');
const { normalizeFtVariantMap } = require('../../utils/ftVariants');

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

function parseMessageIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function deleteUntrackedBotContainerMessages(channel, trackedIds, raidType, guildId) {
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const botId = channel.client.user.id;

    for (const message of messages.values()) {
      if (message.author.id !== botId) continue;
      if (trackedIds.has(message.id)) continue;
      if (!message.components || message.components.length === 0) continue;

      await message.delete();
      logger.debug('Deleted untracked bot container message', { guildId, raidType, messageId: message.id });
    }
  } catch (err) {
    logger.debug('Could not scan for untracked bot container messages', { guildId, raidType, channelId: channel.id, error: err.message });
  }
}

async function deleteFtVariantScheduleMessages(guild, config) {
  const channelMap = normalizeFtVariantMap(config.ft_variant_channel_ids);
  const overviewMap = normalizeFtVariantMap(config.ft_variant_overview_ids);
  const messageMap = normalizeFtVariantMap(config.ft_variant_message_ids);

  for (const variant of ['Blood', 'Magic']) {
    const channelId = channelMap[variant];
    if (!channelId) continue;

    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel) continue;

      const trackedIds = new Set();

      if (overviewMap[variant]) {
        trackedIds.add(overviewMap[variant]);
        await deleteMessage(channel, overviewMap[variant], 'overview', `FT ${variant}`, guild.id);
      }

      for (const messageId of parseMessageIds(messageMap[variant])) {
        trackedIds.add(messageId);
        await deleteMessage(channel, messageId, 'schedule', `FT ${variant}`, guild.id);
      }

      await deleteUntrackedBotContainerMessages(channel, trackedIds, `FT ${variant}`, guild.id);
    } catch (err) {
      logger.debug('Could not access FT variant channel during reset', { guildId: guild.id, variant, channelId, error: err.message });
    }
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
        const parsedIds = parseMessageIds(messageIds);
        for (const msgId of parsedIds) {
          await deleteMessage(channel, msgId, 'schedule', raidType, guild.id);
        }
      }
    } catch (err) {
      logger.debug('Could not access channel', { channelId });
    }
  }

  await deleteFtVariantScheduleMessages(guild, config);
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
