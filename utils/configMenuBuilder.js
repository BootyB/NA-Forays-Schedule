// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SeparatorBuilder, SectionBuilder } = require('discord.js');
const { getAllRaidTypes, getRaidTypeName, getRaidTypeEmoji } = require('./raidTypes');
const { FT_CHANNEL_MODES, normalizeEnabledFtVariants, normalizeFtChannelMode, normalizeFtVariantMap } = require('./ftVariants');

function isRaidConfigured(config, raidType) {
  const hostsKey = `enabled_hosts_${raidType.toLowerCase()}`;
  const hosts = config[hostsKey];
  if (!Array.isArray(hosts) || hosts.length === 0) return false;

  if (raidType !== 'FT') {
    return Boolean(config[`schedule_channel_${raidType.toLowerCase()}`]);
  }

  if (normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
    const variantChannels = normalizeFtVariantMap(config.ft_variant_channel_ids);
    return Boolean(variantChannels.Blood && variantChannels.Magic);
  }

  return Boolean(config.schedule_channel_ft);
}

function buildConfigMenu(config, guild) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Server Configuration')
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  let statusText = '';
  const configuredRaids = [];

  for (const raidType of getAllRaidTypes()) {
    const channelKey = `schedule_channel_${raidType.toLowerCase()}`;
    const hostsKey = `enabled_hosts_${raidType.toLowerCase()}`;

    if (isRaidConfigured(config, raidType)) {
      configuredRaids.push(raidType);
      const channel = guild.channels.cache.get(config[channelKey]);
      const hosts = config[hostsKey];

      statusText += `__**${getRaidTypeName(raidType)}**__\n`;
      if (raidType === 'FT' && normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate) {
        const variantChannels = normalizeFtVariantMap(config.ft_variant_channel_ids);
        const bloodChannel = guild.channels.cache.get(variantChannels.Blood);
        const magicChannel = guild.channels.cache.get(variantChannels.Magic);
        statusText += `Enabled FT Raids: ${normalizeEnabledFtVariants(config.enabled_ft_variants).join(', ')}\n`;
        statusText += 'Channel Layout: Separate\n';
        statusText += `Blood Channel: ${bloodChannel ? bloodChannel.toString() : 'Not found'}\n`;
        statusText += `Magic Channel: ${magicChannel ? magicChannel.toString() : 'Not found'}\n`;
      } else {
        if (raidType === 'FT') {
          statusText += `Enabled FT Raids: ${normalizeEnabledFtVariants(config.enabled_ft_variants).join(', ')}\n`;
        }
        statusText += `Channel: ${channel ? channel.toString() : 'Not found'}\n`;
      }
      statusText += `Servers:\n-# ${hosts.join(', ')}\n\n`;
    } else {
      statusText += `**${getRaidTypeName(raidType)}:** Not configured\n\n`;
    }
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(statusText)
  );

  const raidSelect = new StringSelectMenuBuilder()
    .setCustomId('config_select_raid')
    .setPlaceholder('Select raid type to configure')
    .addOptions(
      getAllRaidTypes().map(raidType => ({
        label: `${raidType}${configuredRaids.includes(raidType) ? ' *' : ''}`,
        description: configuredRaids.includes(raidType) ? 'Currently configured' : 'Not yet configured',
        value: raidType,
        emoji: getRaidTypeEmoji(raidType)
      }))
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(raidSelect)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const autoUpdateSection = new SectionBuilder()
    .addTextDisplayComponents(
      (textDisplay) =>
        textDisplay.setContent(`**Auto-Update:** ${config.auto_update ? 'Enabled' : 'Disabled'}`)
    )
    .setButtonAccessory((button) =>
      button
        .setCustomId('config_toggle_auto_update')
        .setLabel(config.auto_update ? 'Disable' : 'Enable')
        .setStyle(config.auto_update ? ButtonStyle.Danger : ButtonStyle.Success)
    );

  container.addSectionComponents(autoUpdateSection);

  const formatColor = (colorValue, options = {}) => {
    if (colorValue === null) return 'None';
    if (colorValue === undefined) return options.inheritLabel || 'Default (Red)';

    const numValue = typeof colorValue === 'string' ? parseInt(colorValue, 10) : colorValue;

    if (numValue === -2) return options.inheritLabel || 'Inherit FT';
    if (numValue === -1) return 'Default (Red)';

    if (typeof numValue === 'number' && !isNaN(numValue) && numValue >= 0) {
      return '#' + numValue.toString(16).padStart(6, '0').toUpperCase();
    }

    return 'Unknown';
  };

  const sharedFtColor = formatColor(config.schedule_color_ft);
  const ftColorText = normalizeFtChannelMode(config.ft_channel_mode) === FT_CHANNEL_MODES.Separate
    ? `FTB: ${formatColor(config.schedule_color_ft_blood, { inheritLabel: `Inherit FT (${sharedFtColor})` })} | FTM: ${formatColor(config.schedule_color_ft_magic, { inheritLabel: `Inherit FT (${sharedFtColor})` })}`
    : `FT: ${sharedFtColor}`;

  const colorSection = new SectionBuilder()
    .addTextDisplayComponents(
      (textDisplay) =>
        textDisplay.setContent(`**Colors:** BA: ${formatColor(config.schedule_color_ba)} | ${ftColorText} | DRS: ${formatColor(config.schedule_color_drs)}`)
    )
    .setButtonAccessory((button) =>
      button
        .setCustomId('config_color_settings')
        .setLabel('Edit')
        .setStyle(ButtonStyle.Secondary)
    );

  container.addSectionComponents(colorSection);
  container.addSeparatorComponents(new SeparatorBuilder());

  const refreshButton = new ButtonBuilder()
    .setCustomId('config_refresh_schedules')
    .setLabel('Refresh All')
    .setStyle(ButtonStyle.Primary);

  const resetButton = new ButtonBuilder()
    .setCustomId('config_reset_confirmation')
    .setLabel('Reset Config')
    .setStyle(ButtonStyle.Danger);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(refreshButton, resetButton)
  );

  return container;
}

module.exports = { buildConfigMenu, isRaidConfigured };
