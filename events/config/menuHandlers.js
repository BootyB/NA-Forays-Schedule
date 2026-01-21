// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { getServerEmoji } = require('../../config/hostServers');
const encryptedDb = require('../../config/encryptedDatabase');
const { buildConfigMenu } = require('../../utils/configMenuBuilder');
const { showChannelSelection, setupState } = require('../setupInteractions');
const serviceLocator = require('../../services/serviceLocator');
const { getScheduleChannelKey, getEnabledHostsKey } = require('../../utils/raidTypes');

async function showMainConfigMenu(interaction) {
  const guildId = interaction.guild.id;

  const config = await encryptedDb.getServerConfig(guildId);

  if (!config) {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Server not configured. Please run `/na-schedule` to set up.')
    );
    await interaction.update({
      components: [errorContainer],
      flags: 1 << 15
    });
    return;
  }

  const container = buildConfigMenu(config, interaction.guild);

  await interaction.update({
    components: [container],
    flags: 1 << 15
  });
}

async function showRaidConfig(interaction, raidType, useEditReply = false) {
  const guildId = interaction.guild.id;

  const config = await encryptedDb.getServerConfig(guildId);

  if (!config) {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Server not configured. Please run `/setup` first.')
    );
    const payload = {
      components: [errorContainer],
      flags: 1 << 15
    };
    if (useEditReply) {
      await interaction.editReply(payload);
    } else {
      await interaction.update(payload);
    }
    return;
  }

  const channelKey = getScheduleChannelKey(raidType);
  const hostsKey = getEnabledHostsKey(raidType);
  
  if (!config[channelKey] || !config[hostsKey]) {
    const state = {
      selectedRaidTypes: [raidType],
      channels: {},
      hosts: {},
      returnToConfig: true
    };
    setupState.set(interaction.user.id, state);
    
    await showChannelSelection(interaction, raidType, [raidType]);
    return;
  }

  const container = buildRaidConfigContainer(raidType, config[hostsKey] || []);

  const payload = {
    components: [container],
    flags: 1 << 15
  };
  
  if (useEditReply) {
    await interaction.editReply(payload);
  } else {
    await interaction.update(payload);
  }
}

function buildRaidConfigContainer(raidType, enabledHosts, statusMessage = null) {
  const container = new ContainerBuilder();

  let configText = 
    `## ${raidType} Configuration\n\n` +
    `**Currently Enabled Servers:**\n` +
    (enabledHosts.length > 0 ? enabledHosts.map(h => {
      const emoji = getServerEmoji(h);
      const emojiString = emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '●';
      return `${emojiString} ${h}`;
    }).join('\n') : 'None') +
    `\n\nUse the buttons below to modify settings.`;

  if (statusMessage) {
    configText += `\n\n${statusMessage}`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(configText)
  );

  const changeHostsButton = new ButtonBuilder()
    .setCustomId(`config_change_hosts_${raidType.toLowerCase()}`)
    .setLabel('Change Host Servers')
    .setStyle(ButtonStyle.Primary);

  const regenerateButton = new ButtonBuilder()
    .setCustomId(`config_regenerate_raid_${raidType.toLowerCase()}`)
    .setLabel('Regenerate Schedule')
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId('config_back')
    .setLabel('Back to Menu')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(changeHostsButton, regenerateButton)
  );
  
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(backButton)
  );

  return container;
}

module.exports = {
  showMainConfigMenu,
  showRaidConfig,
  buildRaidConfigContainer
};
