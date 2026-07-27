// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const encryptedDb = require('../../config/encryptedDatabase');
const logger = require('../../utils/logger');
const serviceLocator = require('../../services/serviceLocator');
const { showRaidConfig } = require('./menuHandlers');
const { showChannelSelection, setupState } = require('../setupInteractions');
const { FT_CHANNEL_MODES, getFtVariantOptions, normalizeEnabledFtVariants, normalizeFtChannelMode, normalizeFtVariantMap, validateEnabledFtVariants } = require('../../utils/ftVariants');
const { canManageChannelPermissions, setChannelPermissions } = require('../../utils/channelPermissions');

const ftChannelConfigState = new Map();

async function showFtVariantChangeMenu(interaction) {
  const guildId = interaction.guild.id;
  const config = await encryptedDb.getServerConfig(guildId);
  const currentVariants = normalizeEnabledFtVariants(config?.enabled_ft_variants);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '## Change Forked Tower Raids\n\n' +
      'Select which Forked Tower schedules to display. At least one must remain enabled.'
    )
  );

  const variantSelect = new StringSelectMenuBuilder()
    .setCustomId('config_save_ft_variants')
    .setPlaceholder('Select Forked Tower raids')
    .setMinValues(1)
    .setMaxValues(2)
    .addOptions(getFtVariantOptions(currentVariants));

  const saveCurrentButton = new ButtonBuilder()
    .setCustomId('config_save_current_ft_variants')
    .setLabel('Save Current')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId('config_back_to_raid_ft')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(variantSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(saveCurrentButton, cancelButton));

  await interaction.update({ components: [container], flags: 64 | 32768 });
}

async function saveCurrentFtVariantChanges(interaction) {
  const config = await encryptedDb.getServerConfig(interaction.guild.id);
  interaction.values = normalizeEnabledFtVariants(config?.enabled_ft_variants);
  await saveFtVariantChanges(interaction);
}

async function saveFtVariantChanges(interaction) {
  const guildId = interaction.guild.id;
  const updateManager = serviceLocator.get('updateManager');
  const selectedVariants = normalizeEnabledFtVariants(interaction.values);

  try {
    await interaction.deferUpdate();

    const currentConfig = await encryptedDb.getServerConfig(guildId);
    const previousVariants = normalizeEnabledFtVariants(currentConfig?.enabled_ft_variants);

    if (!validateEnabledFtVariants(interaction.values)) {
      const errorContainer = new ContainerBuilder();
      errorContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('? Invalid Forked Tower raid selection. Please choose Blood, Magic, or both.')
      );
      await interaction.editReply({ components: [errorContainer], flags: 64 | 32768 });
      return;
    }

    await encryptedDb.updateServerConfig(guildId, { enabled_ft_variants: selectedVariants });

    const newlyEnabledVariants = selectedVariants.filter((variant) => !previousVariants.includes(variant));
    if (newlyEnabledVariants.length > 0 && typeof updateManager.invalidateFtVariantState === 'function') {
      await updateManager.invalidateFtVariantState(guildId, newlyEnabledVariants);
    }

    logger.info('FT variants updated', { guildId, variants: selectedVariants });
    await showRaidConfig(interaction, 'FT', true);

    updateManager.forceUpdate(guildId).catch(err => {
      logger.error('Error in background schedule update after FT variant change', { error: err.message, guildId });
    });
  } catch (error) {
    logger.error('Error saving FT variant changes', { error: error.message, guildId });
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('? Error saving Forked Tower raid settings. Please try again.')
    );
    await interaction.editReply({ components: [errorContainer], flags: 1 << 15 }).catch(() => {});
  }
}

async function showFtChannelModeMenu(interaction) {
  const config = await encryptedDb.getServerConfig(interaction.guild.id);
  const currentMode = normalizeFtChannelMode(config?.ft_channel_mode);
  const modeLabel = currentMode === FT_CHANNEL_MODES.Separate ? 'Separate Channels' : 'Shared Channel';

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## Change FT Channel Layout\n\nCurrent layout: **' + modeLabel + '**')
  );

  const sharedButton = new ButtonBuilder()
    .setCustomId('config_set_ft_channel_mode_shared')
    .setLabel('Shared Channel')
    .setStyle(currentMode === FT_CHANNEL_MODES.Shared ? ButtonStyle.Success : ButtonStyle.Secondary);

  const separateButton = new ButtonBuilder()
    .setCustomId('config_set_ft_channel_mode_separate')
    .setLabel('Separate Channels')
    .setStyle(currentMode === FT_CHANNEL_MODES.Separate ? ButtonStyle.Success : ButtonStyle.Primary);

  const cancelButton = new ButtonBuilder()
    .setCustomId('config_back_to_raid_ft')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(sharedButton, separateButton));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(cancelButton));
  await interaction.update({ components: [container], flags: 64 | 32768 });
}

async function saveFtChannelMode(interaction, mode) {
  const guildId = interaction.guild.id;
  const nextMode = normalizeFtChannelMode(mode);
  const config = await encryptedDb.getServerConfig(guildId);

  if (nextMode === FT_CHANNEL_MODES.Separate) {
    await showFtVariantChannelChangeMenu(interaction, true);
    return;
  }

  if (!config?.schedule_channel_ft) {
    setupState.set(interaction.user.id, {
      selectedRaidTypes: ['FT'],
      channels: {},
      hosts: { FT: config?.enabled_hosts_ft || [] },
      returnToConfig: true,
      ftVariants: normalizeEnabledFtVariants(config?.enabled_ft_variants),
      ftChannelMode: FT_CHANNEL_MODES.Shared,
      ftVariantChannels: normalizeFtVariantMap(config?.ft_variant_channel_ids),
      skipHostSelectionFor: ['FT']
    });
    await showChannelSelection(interaction, 'FT', ['FT']);
    return;
  }

  await interaction.deferUpdate();
  await encryptedDb.updateServerConfig(guildId, { ft_channel_mode: FT_CHANNEL_MODES.Shared });
  serviceLocator.get('updateManager').forceUpdate(guildId).catch(err => logger.error('Error refreshing after FT layout change', { guildId, error: err.message }));
  await showRaidConfig(interaction, 'FT', true);
}

async function showFtVariantChannelChangeMenu(interaction, settingSeparateMode = false) {
  const guildId = interaction.guild.id;
  const config = await encryptedDb.getServerConfig(guildId);
  const existingState = ftChannelConfigState.get(interaction.user.id);
  const currentChannels = normalizeFtVariantMap(existingState?.channels || config?.ft_variant_channel_ids);
  ftChannelConfigState.set(interaction.user.id, { guildId, settingSeparateMode, channels: currentChannels });

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '## Change FT Variant Channels\n\n' +
      'Select both Blood and Magic channels, then save. Separate mode requires both channels.\n\n' +
      'Blood: ' + (currentChannels.Blood ? '<#' + currentChannels.Blood + '>' : 'Not set') + '\n' +
      'Magic: ' + (currentChannels.Magic ? '<#' + currentChannels.Magic + '>' : 'Not set')
    )
  );

  const bloodSelect = new ChannelSelectMenuBuilder()
    .setCustomId('config_select_ft_variant_channel_blood')
    .setPlaceholder('Select Blood channel')
    .addChannelTypes(ChannelType.GuildText);

  const magicSelect = new ChannelSelectMenuBuilder()
    .setCustomId('config_select_ft_variant_channel_magic')
    .setPlaceholder('Select Magic channel')
    .addChannelTypes(ChannelType.GuildText);

  const saveButton = new ButtonBuilder()
    .setCustomId('config_save_ft_variant_channels')
    .setLabel('Save FT Channels')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId('config_back_to_raid_ft')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(bloodSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(magicSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(saveButton, cancelButton));
  await interaction.update({ components: [container], flags: 64 | 32768 });
}

async function handleFtVariantChannelSelection(interaction, variantValue) {
  const variant = variantValue.toLowerCase() === 'magic' ? 'Magic' : 'Blood';
  const state = ftChannelConfigState.get(interaction.user.id) || { guildId: interaction.guild.id, settingSeparateMode: false, channels: normalizeFtVariantMap(null) };
  state.channels = normalizeFtVariantMap(state.channels);
  state.channels[variant] = interaction.values[0];
  ftChannelConfigState.set(interaction.user.id, state);
  await showFtVariantChannelChangeMenu(interaction, state.settingSeparateMode);
}

function getRequiredSchedulePermissions() {
  return [
    { name: 'View Channel', flag: 'ViewChannel' },
    { name: 'Send Messages', flag: 'SendMessages' },
    { name: 'Embed Links', flag: 'EmbedLinks' },
    { name: 'Attach Files', flag: 'AttachFiles' },
    { name: 'Read Message History', flag: 'ReadMessageHistory' }
  ];
}

function getMissingSchedulePermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  return getRequiredSchedulePermissions()
    .filter((perm) => !permissions || !permissions.has(perm.flag))
    .map((perm) => perm.name);
}

function getFtVariantLabel(variant) {
  return variant === 'Magic' ? 'Forked Tower: Magic (Extreme)' : 'Forked Tower: Blood';
}

async function showFtChannelPermissionInstructions(interaction, variant, channel, missingPermissions) {
  const container = new ContainerBuilder();
  const content =
    `? **Missing Permissions in ${channel.toString()}**\n\n` +
    `I need these permissions before I can post the ${getFtVariantLabel(variant)} schedule:\n` +
    `${missingPermissions.map((permission) => `- \`${permission}\``).join('\n')}\n\n` +
    `**How to Fix:**\n\n` +
    `1. Right-click ${channel.toString()} ? **Edit Channel**\n` +
    `2. Go to **Permissions**\n` +
    `3. Add the **NA Forays Schedule** role or bot member\n` +
    `4. Enable: ${missingPermissions.join(', ')}\n` +
    `5. Save, then click **Save FT Channels** again`; 

  const saveButton = new ButtonBuilder()
    .setCustomId('config_save_ft_variant_channels')
    .setLabel('Save FT Channels')
    .setStyle(ButtonStyle.Success);

  const chooseButton = new ButtonBuilder()
    .setCustomId('config_change_ft_channels')
    .setLabel('Choose Different Channels')
    .setStyle(ButtonStyle.Secondary);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(saveButton, chooseButton));
  await interaction.update({ components: [container], flags: 64 | 32768 });
}

async function ensureFtVariantChannelPermissions(interaction, channels) {
  const botMember = await interaction.guild.members.fetchMe();
  for (const variant of ['Blood', 'Magic']) {
    const channel = interaction.guild.channels.cache.get(channels[variant]);
    if (!channel) {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${getFtVariantLabel(variant)} channel was not found. Please choose a different channel.`));
      await interaction.update({ components: [container], flags: 64 | 32768 });
      return false;
    }

    const missingPermissions = getMissingSchedulePermissions(channel, botMember);
    if (missingPermissions.length === 0) continue;

    const canAutoSet = canManageChannelPermissions(channel, botMember);
    const roleHighEnough = botMember.roles.highest.position > 1;
    if (canAutoSet && roleHighEnough) {
      const result = await setChannelPermissions(channel, botMember);
      if (result.success) continue;
    }

    await showFtChannelPermissionInstructions(interaction, variant, channel, missingPermissions);
    return false;
  }

  return true;
}

async function saveFtVariantChannelChanges(interaction) {
  const guildId = interaction.guild.id;
  const state = ftChannelConfigState.get(interaction.user.id);
  const channels = normalizeFtVariantMap(state?.channels);

  if (!channels.Blood || !channels.Magic) {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('? Separate FT channels require both Blood and Magic channels.')
    );
    await interaction.update({ components: [errorContainer], flags: 64 | 32768 });
    return;
  }

  const hasPermissions = await ensureFtVariantChannelPermissions(interaction, channels);
  if (!hasPermissions) return;

  await interaction.deferUpdate();
  await encryptedDb.updateServerConfig(guildId, { ft_channel_mode: FT_CHANNEL_MODES.Separate, ft_variant_channel_ids: channels });
  ftChannelConfigState.delete(interaction.user.id);
  serviceLocator.get('updateManager').forceUpdate(guildId).catch(err => logger.error('Error refreshing after FT channel change', { guildId, error: err.message }));
  await showRaidConfig(interaction, 'FT', true);
}

module.exports = {
  showFtVariantChangeMenu,
  saveFtVariantChanges,
  saveCurrentFtVariantChanges,
  showFtChannelModeMenu,
  saveFtChannelMode,
  showFtVariantChannelChangeMenu,
  handleFtVariantChannelSelection,
  saveFtVariantChannelChanges
};
