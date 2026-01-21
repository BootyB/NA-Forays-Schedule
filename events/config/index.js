// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { isValidRaidType } = require('../../utils/validators');
const serviceLocator = require('../../services/serviceLocator');

const { showMainConfigMenu, showRaidConfig } = require('./menuHandlers');
const { showHostChangeMenu, saveHostChanges } = require('./hostHandlers');
const { toggleAutoUpdate, refreshSchedules, regenerateRaidSchedule } = require('./scheduleHandlers');
const { showResetConfirmation, resetConfiguration } = require('./resetHandlers');
const { showColorSettingsModal, saveColorSettings } = require('./colorHandlers');

async function handleConfigInteraction(interaction) {
  const customId = interaction.customId;

  if (customId === 'config_select_raid') {
    const raidType = interaction.values[0];
    if (!isValidRaidType(raidType)) {
      await interaction.reply({ content: '❌ Invalid raid type.', flags: 64 });
      return;
    }
    await showRaidConfig(interaction, raidType);
    return;
  }

  if (customId.startsWith('config_back_to_raid_')) {
    const raidType = extractRaidType(customId);
    if (!isValidRaidType(raidType)) {
      await interaction.reply({ content: '❌ Invalid raid type.', flags: 64 });
      return;
    }
    await showRaidConfig(interaction, raidType);
    return;
  }

  if (customId.startsWith('config_change_hosts_')) {
    const raidType = extractRaidType(customId);
    if (!isValidRaidType(raidType)) {
      await interaction.reply({ content: '❌ Invalid raid type.', flags: 64 });
      return;
    }
    await showHostChangeMenu(interaction, raidType);
    return;
  }

  if (customId.startsWith('config_save_hosts_')) {
    const raidType = extractRaidType(customId);
    if (!isValidRaidType(raidType)) {
      await interaction.reply({ content: '❌ Invalid raid type.', flags: 64 });
      return;
    }
    await saveHostChanges(interaction, raidType);
    return;
  }

  if (customId.startsWith('config_regenerate_raid_')) {
    const raidType = extractRaidType(customId);
    if (!isValidRaidType(raidType)) {
      await interaction.reply({ content: '❌ Invalid raid type.', flags: 64 });
      return;
    }
    await regenerateRaidSchedule(interaction, raidType);
    return;
  }

  switch (customId) {
    case 'config_toggle_auto_update':
      await toggleAutoUpdate(interaction);
      break;
    case 'config_refresh_schedules':
      await refreshSchedules(interaction);
      break;
    case 'config_reset_confirmation':
      await showResetConfirmation(interaction);
      break;
    case 'config_reset_confirmed':
      await resetConfiguration(interaction);
      break;
    case 'config_back':
      await showMainConfigMenu(interaction);
      break;
    case 'config_color_settings':
      await showColorSettingsModal(interaction);
      break;
    case 'config_color_modal':
      await saveColorSettings(interaction);
      break;
  }
}

function extractRaidType(customId) {
  return customId.split('_').pop().toUpperCase();
}

module.exports = {
  handleConfigInteraction,
  showMainConfigMenu,
  showRaidConfig,
  showHostChangeMenu,
  saveHostChanges,
  toggleAutoUpdate,
  refreshSchedules,
  regenerateRaidSchedule,
  showResetConfirmation,
  resetConfiguration,
  showColorSettingsModal,
  saveColorSettings
};
