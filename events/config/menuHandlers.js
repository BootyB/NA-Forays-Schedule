// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { getServerEmoji } = require('../../config/hostServers');
const encryptedDb = require('../../config/encryptedDatabase');
const { buildConfigMenu, isRaidConfigured } = require('../../utils/configMenuBuilder');
const { showChannelSelection, showFtVariantSelection, setupState } = require('../setupInteractions');
const serviceLocator = require('../../services/serviceLocator');
const { getScheduleChannelKey, getEnabledHostsKey } = require('../../utils/raidTypes');
const { getPollsForRaidConfig, getEnabledPollIdsForRaid } = require('../../services/pollConfig');
const { FT_CHANNEL_MODES, normalizeEnabledFtVariants, normalizeFtChannelMode, normalizeFtVariantMap } = require('../../utils/ftVariants');

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
  
  if (!isRaidConfigured(config, raidType)) {
    const state = {
      selectedRaidTypes: [raidType],
      channels: {},
      hosts: {},
      returnToConfig: true
    };

    if (raidType === 'FT') {
      state.ftVariants = normalizeEnabledFtVariants(config.enabled_ft_variants);
      state.ftChannelMode = normalizeFtChannelMode(config.ft_channel_mode);
      state.ftVariantChannels = normalizeFtVariantMap(config.ft_variant_channel_ids);
    }

    setupState.set(interaction.user.id, state);
    
    if (raidType === 'FT') {
      await showFtVariantSelection(interaction);
    } else {
      await showChannelSelection(interaction, raidType, [raidType]);
    }
    return;
  }

  const container = buildRaidConfigContainer(raidType, config[hostsKey] || [], null, config);

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

function buildRaidConfigContainer(raidType, enabledHosts, statusMessage = null, config = {}) {
  const container = new ContainerBuilder();

  let configText = 
    `## ${raidType} Configuration\n\n` +
    `**Currently Enabled Servers:**\n` +
    (enabledHosts.length > 0 ? enabledHosts.map(h => {
      const emoji = getServerEmoji(h);
      const emojiString = emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '●';
      return `${emojiString} ${h}`;
    }).join('\n') : 'None');

  if (raidType === 'FT') {
    const ftMode = normalizeFtChannelMode(config.ft_channel_mode);
    configText += `\n\n**Enabled FT Raids:**\n${normalizeEnabledFtVariants(config.enabled_ft_variants).join(', ')}`;
    configText += `\n\n**FT Channel Layout:**\n${ftMode === FT_CHANNEL_MODES.Separate ? 'Separate Channels' : 'Shared Channel'}`;
    if (ftMode === FT_CHANNEL_MODES.Separate) {
      const variantChannels = normalizeFtVariantMap(config.ft_variant_channel_ids);
      configText += `\nBlood: ${variantChannels.Blood ? `<#${variantChannels.Blood}>` : 'Not set'}`;
      configText += `\nMagic: ${variantChannels.Magic ? `<#${variantChannels.Magic}>` : 'Not set'}`;
    }
  }

  configText += `\n\nUse the buttons below to modify settings.`;

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

  const changeVariantsButton = raidType === 'FT'
    ? new ButtonBuilder()
      .setCustomId('config_change_ft_variants')
      .setLabel('Change FT Raids')
      .setStyle(ButtonStyle.Primary)
    : null;

  const changeLayoutButton = raidType === 'FT'
    ? new ButtonBuilder()
      .setCustomId('config_change_ft_channel_mode')
      .setLabel('Change FT Layout')
      .setStyle(ButtonStyle.Primary)
    : null;

  const changeFtChannelsButton = raidType === 'FT' && normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate
    ? new ButtonBuilder()
      .setCustomId('config_change_ft_channels')
      .setLabel('Change FT Channels')
      .setStyle(ButtonStyle.Primary)
    : null;

  const changePollsButton = new ButtonBuilder()
    .setCustomId(`config_change_polls_${raidType.toLowerCase()}`)
    .setLabel('Change Polls')
    .setStyle(ButtonStyle.Primary);

  const regenerateButton = new ButtonBuilder()
    .setCustomId(`config_regenerate_raid_${raidType.toLowerCase()}`)
    .setLabel('Regenerate Schedule')
    .setStyle(ButtonStyle.Success);

  const backButton = new ButtonBuilder()
    .setCustomId('config_back')
    .setLabel('Back to Menu')
    .setStyle(ButtonStyle.Secondary);

  const primaryButtons = raidType === 'FT'
    ? [changeHostsButton, changeVariantsButton, changeLayoutButton, regenerateButton]
    : [changeHostsButton, regenerateButton];
  if (changeFtChannelsButton) {
    primaryButtons.splice(3, 0, changeFtChannelsButton);
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(...primaryButtons)
  );
  
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(changePollsButton, backButton)
  );

  return container;
}

module.exports = {
  showMainConfigMenu,
  showRaidConfig,
  buildRaidConfigContainer
};
