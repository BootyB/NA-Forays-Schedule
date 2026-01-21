// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { getAllHostServers, getHostServersForRaidType, getServerEmoji } = require('../../config/hostServers');
const { areValidHostServers } = require('../../utils/validators');
const encryptedDb = require('../../config/encryptedDatabase');
const { showRaidConfig } = require('./menuHandlers');
const serviceLocator = require('../../services/serviceLocator');
const { getEnabledHostsKey } = require('../../utils/raidTypes');

async function showHostChangeMenu(interaction, raidType) {
  const guildId = interaction.guild.id;

  const config = await encryptedDb.getServerConfig(guildId);
  const hostsKey = getEnabledHostsKey(raidType);
  const currentHosts = config[hostsKey] || [];
  const allHosts = getHostServersForRaidType(raidType);

  const container = new ContainerBuilder();

  const headerText = 
    `## Change Host Servers for ${raidType}\n\n` +
    `Select which host servers to display.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerText)
  );

  const hostSelect = new StringSelectMenuBuilder()
    .setCustomId(`config_save_hosts_${raidType.toLowerCase()}`)
    .setPlaceholder('Select host servers')
    .setMinValues(1)
    .setMaxValues(allHosts.length)
    .addOptions(
      allHosts.map(server => {
        const option = {
          label: server,
          value: server,
          default: currentHosts.includes(server)
        };
        const emoji = getServerEmoji(server);
        if (emoji) {
          option.emoji = emoji;
        }
        return option;
      })
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(hostSelect)
  );

  const cancelButton = new ButtonBuilder()
    .setCustomId(`config_back_to_raid_${raidType.toLowerCase()}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(cancelButton)
  );

  await interaction.update({
    components: [container],
    flags: 64 | 32768
  });
}

async function saveHostChanges(interaction, raidType) {
  const selectedHosts = interaction.values;
  const updateManager = serviceLocator.get('updateManager');
  const guildId = interaction.guild.id;

  try {
    await interaction.deferUpdate();

    if (!areValidHostServers(selectedHosts)) {
      logger.warn('Invalid host servers selected', { guildId, raidType, selectedHosts });
      
      const errorContainer = new ContainerBuilder();
      errorContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('❌ One or more selected host servers are invalid. Please try again.')
      );
      
      await interaction.editReply({
        components: [errorContainer],
        flags: 64 | 32768
      });
      return;
    }

    const hostsKey = getEnabledHostsKey(raidType);
    
    await encryptedDb.updateServerConfig(guildId, {
      [hostsKey]: selectedHosts
    });

    logger.info('Host servers updated', {
      guildId,
      raidType,
      hosts: selectedHosts
    });

    await showRaidConfig(interaction, raidType, true);

    updateManager.forceUpdate(guildId).catch(err => {
      logger.error('Error in background schedule update', {
        error: err.message,
        guildId,
        raidType
      });
    });

  } catch (error) {
    logger.error('Error saving host changes', {
      error: error.message,
      guildId,
      raidType
    });

    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Error saving changes. Please try again.')
    );

    try {
      await interaction.editReply({
        components: [errorContainer],
        flags: 1 << 15
      });
    } catch (editError) {
      logger.error('Could not edit reply', { error: editError.message });
    }
  }
}

module.exports = {
  showHostChangeMenu,
  saveHostChanges
};
