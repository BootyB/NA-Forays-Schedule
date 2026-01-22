// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { ContainerBuilder, TextDisplayBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { getAllHostServers, getHostServersForRaidType, getServerEmoji } = require('../config/hostServers');
const encryptedDb = require('../config/encryptedDatabase');
const serviceLocator = require('../services/serviceLocator');
const { DEFAULT_SCHEDULE_CHANNEL_NAMES } = require('../config/constants');
const { getScheduleChannelKey, getEnabledHostsKey } = require('../utils/raidTypes');
const { canCreateChannels, createScheduleChannel, canManageChannelPermissions, setChannelPermissions } = require('../utils/channelPermissions');
const setupState = new Map();

async function handleSetupInteraction(interaction) {
  const customId = interaction.customId;

  if (customId === 'setup_select_raids') {
    await handleRaidTypeSelection(interaction);
  } else if (customId.startsWith('setup_retry_channel_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    const state = setupState.get(interaction.user.id) || {};
    const allRaidTypes = state.selectedRaidTypes || [raidType];
    await showChannelSelection(interaction, raidType, allRaidTypes);
  } else if (customId.startsWith('setup_retry_perms_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    const state = setupState.get(interaction.user.id);
    const channelId = state?.channels?.[raidType];
    
    if (!channelId) {
      await interaction.update({
        content: '❌ No channel selected. Please select a channel.',
        components: [],
        flags: 1 << 15
      });
      return;
    }
    
    // Create a fake values array to reuse handleChannelSelection
    interaction.values = [channelId];
    await handleChannelSelection(interaction, raidType);
  } else if (customId.startsWith('setup_create_channel_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    await handleChannelCreation(interaction, raidType);
  } else if (customId.startsWith('setup_select_channel_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    await handleChannelSelection(interaction, raidType);
  } else if (customId.startsWith('setup_auto_perms_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    await handleAutoPermissionSetup(interaction, raidType);
  } else if (customId.startsWith('setup_manual_perms_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    await showManualPermissionInstructions(interaction, raidType);
  } else if (customId.startsWith('setup_select_hosts_')) {
    const raidType = customId.split('_').pop().toUpperCase();
    await handleHostSelection(interaction, raidType);
  } else if (customId === 'setup_confirm') {
    await handleSetupConfirmation(interaction);
  } else if (customId === 'setup_cancel') {
    setupState.delete(interaction.user.id);
    
    const cancelContainer = new ContainerBuilder();
    
    cancelContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Setup cancelled.')
    );
    
    await interaction.update({
      components: [cancelContainer],
      flags: 64 | 32768
    });
  }
}

async function handleRaidTypeSelection(interaction) {
  const selectedTypes = interaction.values;
  
  const state = setupState.get(interaction.user.id) || {};
  state.selectedRaidTypes = selectedTypes;
  state.channels = {};
  state.hosts = {};
  setupState.set(interaction.user.id, state);

  await showChannelSelection(interaction, selectedTypes[0], selectedTypes);
}

async function showChannelSelection(interaction, currentRaidType, allRaidTypes) {
  const container = new ContainerBuilder();
  const botMember = await interaction.guild.members.fetchMe();
  const createCheck = await canCreateChannels(interaction.guild, botMember);
  const canCreate = createCheck.canCreate;
  
  if (canCreate) {
    const raidTypeKey = currentRaidType.toUpperCase();
    const defaultChannelName = DEFAULT_SCHEDULE_CHANNEL_NAMES[raidTypeKey] || `na-forays-${currentRaidType.toLowerCase()}`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Channel Setup for ${currentRaidType}`)
    );

    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          (textDisplay) => textDisplay.setContent(
            `**🆕 Create New (Recommended):**\n` +
            `• \`#${defaultChannelName}\` will be created with proper permissions\n` +
            `• Sets channel to read-only for members, while the bot can still post schedules`
          )
        )
        .setButtonAccessory((button) => button
          .setCustomId(`setup_create_channel_${currentRaidType.toLowerCase()}`)
          .setLabel(`🆕 Create #${defaultChannelName}`)
          .setStyle(ButtonStyle.Success)
        )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    const manualInstructions =
      `## Manual Channel Selection Instructions\n\n` +
      `**📁 Use Existing Channel:**\n` +
      `• Choose from your server's channels below\n` +
      `• I'll help set permissions if needed\n\n` +
      `**⚠️ Required Permissions for Schedule Channels:**\n` +
      `• View Channel\n` +
      `• Send Messages\n` +
      `• Embed Links\n` +
      `• Attach Files\n` +
      `• Read Message History\n\n` +
      `After selection, the screen will display any missing permissions and afford you the oppourtunity to retry.`;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(manualInstructions)
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Channel Setup for ${currentRaidType}`)
    );

    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    let headerText = `Setup the channel where ${currentRaidType} schedules will be posted.\n\n`;
    
    if (createCheck.reason) {
      headerText += `**ℹ️ Automatic Channel Creation Disabled:**\n${createCheck.reason}`;
    }
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(headerText)
    );

    if (createCheck.reason && (createCheck.reason.includes('role hierarchy') || createCheck.reason.includes('position'))) {
      container.addSeparatorComponents(
        new SeparatorBuilder()
      );

      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            (textDisplay) => textDisplay.setContent(`**To enable auto channel creation:**\nMove it higher in Server Settings → Roles; see the visual guide below. Use the retry button after the change`)
          )
          .setButtonAccessory((button) => button
            .setCustomId(`setup_retry_channel_${currentRaidType.toLowerCase()}`)
            .setLabel('🔄 Retry')
            .setStyle(ButtonStyle.Primary)
          )
      );

      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL('https://i.gyazo.com/5ed7e34312eaeb61a3b6fbb88c363707.gif')
            .setDescription('Drag the bot\'s role higher in Server Settings → Roles')
        )
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    const beforeSelectingText =
      `## Manual Channel Selection Instructions\n\n` +
      `**⚠️ Before Selecting:**\n` +
      `Make sure the bot has these permissions in your chosen channel(s):\n` +
      `• View Channel\n` +
      `• Send Messages\n` +
      `• Embed Links\n` +
      `• Attach Files\n` +
      `• Read Message History\n\n` +
      `After selection, the screen will display any missing permissions and afford you the oppourtunity to retry.\n\n` +
      `**Quick Setup:** Right-click your channel → Edit Channel → Permissions → Add the **NA Forays Schedule** role → Enable the permissions above.`;
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(beforeSelectingText)
    );
  }

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`setup_select_channel_${currentRaidType.toLowerCase()}`)
    .setPlaceholder(canCreate ? 'Or select an existing channel' : `Select channel for ${currentRaidType} schedules`)
    .addChannelTypes(ChannelType.GuildText);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(channelSelect)
  );

  await interaction.update({
    components: [container],
    flags: 64 | 32768
  });
}

async function handleChannelSelection(interaction, raidType) {
  const channelId = interaction.values[0];
  const channel = interaction.guild.channels.cache.get(channelId);
  
  if (!channel) {
    await interaction.update({
      content: '❌ Channel not found. Please try again.',
      components: [],
      flags: 1 << 15
    });
    return;
  }
  
  const botMember = await interaction.guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  
  const requiredPermissions = [
    { name: 'View Channel', flag: 'ViewChannel' },
    { name: 'Send Messages', flag: 'SendMessages' },
    { name: 'Embed Links', flag: 'EmbedLinks' },
    { name: 'Attach Files', flag: 'AttachFiles' },
    { name: 'Read Message History', flag: 'ReadMessageHistory' }
  ];
  
  const missingPermissions = [];
  const grantedPermissions = [];
  
  for (const perm of requiredPermissions) {
    if (permissions.has(perm.flag)) {
      grantedPermissions.push(perm.name);
    } else {
      missingPermissions.push(perm.name);
    }
  }
  
  if (missingPermissions.length > 0) {
    const state = setupState.get(interaction.user.id) || {};
    if (!state.channels) state.channels = {};
    state.channels[raidType] = channelId;
    setupState.set(interaction.user.id, state);

    const canAutoSet = canManageChannelPermissions(channel, botMember);
    
    // Also check if bot's role is high enough in hierarchy
    const roleHighEnough = botMember.roles.highest.position > 1;
    
    if (canAutoSet && roleHighEnough) {
      await interaction.deferUpdate();
      
      const result = await setChannelPermissions(channel, botMember);

      if (result.success) {
        const successContainer = new ContainerBuilder();
        successContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `✅ **Permissions Set Successfully**\n\n` +
            `${channel.toString()} is now configured for ${raidType} schedules.\n\n` +
            `Continuing to host selection...`
          )
        );

        await interaction.editReply({ components: [successContainer] });

        setTimeout(() => showHostSelection(interaction, raidType), 2000);
        return;
      } else {
        const errorContainer = new ContainerBuilder();
        errorContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `⚠️ **Could Not Automatically Set Permissions**\n\n` +
            `${result.error}\n\n` +
            `**Please set permissions manually:**\n\n` +
            `**Option 1: Channel-Specific (Recommended)**\n` +
            `1. Right-click ${channel.toString()} → **Edit Channel**\n` +
            `2. Go to **Permissions** tab\n` +
            `3. Click **+** to add a role/member\n` +
            `4. Select **NA Forays Schedule** (the bot's role)\n` +
            `5. Enable: ${missingPermissions.join(', ')}\n` +
            `6. Click **Save Changes**\n\n` +
            `**Option 2: Server-Wide (Easier, Less Secure)**\n` +
            `1. Go to **Server Settings** → **Roles**\n` +
            `2. Find **NA Forays Schedule** role\n` +
            `3. Enable: ${missingPermissions.join(', ')}\n` +
            `4. Click **Save Changes**`
          )
        );

        const retryButton = new ButtonBuilder()
          .setCustomId(`setup_retry_perms_${raidType.toLowerCase()}`)
          .setLabel('Try Again')
          .setStyle(ButtonStyle.Primary);

        errorContainer.addActionRowComponents(
          new ActionRowBuilder().addComponents(retryButton)
        );

        await interaction.editReply({ components: [errorContainer] });
        return;
      }
    } else {
      const errorContainer = new ContainerBuilder();
      
      let errorText = `❌ **Missing Permissions in ${channel.toString()}**\n\n`;
      
      errorText += `The bot needs these permissions to post schedules:\n`;
      errorText += `${missingPermissions.map(p => `• \`${p}\``).join('\n')}\n\n`;
      errorText += 
        `**How to Fix:**\n\n` +
        `**Option 1: Channel-Specific (Recommended)**\n` +
        `1. Right-click ${channel.toString()} → **Edit Channel**\n` +
        `2. Go to **Permissions** tab\n` +
        `3. Click **+** to add a role/member\n` +
        `4. Select **NA Forays Schedule** (the bot's role)\n` +
        `5. Enable: ${missingPermissions.join(', ')}\n` +
        `6. Click **Save Changes**\n\n` +
        `**Option 2: Server-Wide (Easier, Less Secure)**\n` +
        `1. Go to **Server Settings** → **Roles**\n` +
        `2. Find **NA Forays Schedule** role\n` +
        `3. Enable: ${missingPermissions.join(', ')}\n` +
        `4. Click **Save Changes**`;
      
      errorContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(errorText)
      );
      
      const retryButton = new ButtonBuilder()
        .setCustomId(`setup_retry_perms_${raidType.toLowerCase()}`)
        .setLabel('Try Again')
        .setStyle(ButtonStyle.Primary);
      
      errorContainer.addActionRowComponents(
        new ActionRowBuilder().addComponents(retryButton)
      );
      
      await interaction.update({
        components: [errorContainer],
        flags: 1 << 15
      });
      return;
    }
  }
  
  const state = setupState.get(interaction.user.id) || {};
  
  if (!state.channels) state.channels = {};
  state.channels[raidType] = channelId;
  setupState.set(interaction.user.id, state);

  await showHostSelection(interaction, raidType);
}

async function handleChannelCreation(interaction, raidType) {
  await interaction.deferUpdate();
  
  const botMember = await interaction.guild.members.fetchMe();
  const result = await createScheduleChannel(interaction.guild, raidType, botMember, {
    readOnly: true
  });

  if (result.success) {
    const state = setupState.get(interaction.user.id) || {};
    if (!state.channels) state.channels = {};
    state.channels[raidType] = result.channel.id;
    setupState.set(interaction.user.id, state);

    const successContainer = new ContainerBuilder();
    
    let message = `✅ **Channel Created Successfully**\n\n` +
      `Created ${result.channel.toString()} for ${raidType} schedules.\n\n`;
    
    if (result.permissionsSet) {
      message += `**Permissions configured:**\n` +
        `• Channel is read-only for members\n` +
        `• Bot can post schedule updates\n\n` +
        `**Next Step:** Select host servers`;
    } else {
      message += `**Next Steps:**\n` +
        `1. **(Optional)** Make channel read-only:\n` +
        `   • Right-click ${result.channel.toString()} → Edit Channel → Permissions\n` +
        `   • @everyone: Send Messages = ❌\n` +
        `2. Select host servers below`;
    }
    
    successContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message)
    );

    await interaction.editReply({ components: [successContainer] });

    setTimeout(async () => {
      const state = setupState.get(interaction.user.id) || {};
      const allRaidTypes = state.selectedRaidTypes || [raidType];
      await showHostSelectionDelayed(interaction, raidType, allRaidTypes);
    }, 2000);

  } else {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `❌ **Failed to Create Channel**\n\n` +
        `${result.error}\n\n` +
        `**Alternatives:**\n` +
        `• Select an existing channel instead\n` +
        `• Ask a server admin to enable "Manage Channels" for the bot\n` +
        `• Re-invite the bot with updated permissions`
      )
    );

    const selectExistingButton = new ButtonBuilder()
      .setCustomId(`setup_retry_channel_${raidType.toLowerCase()}`)
      .setLabel('📁 Select Existing Channel')
      .setStyle(ButtonStyle.Primary);

    errorContainer.addActionRowComponents(
      new ActionRowBuilder().addComponents(selectExistingButton)
    );

    await interaction.editReply({ components: [errorContainer] });
  }
}

async function handleAutoPermissionSetup(interaction, raidType) {
  const state = setupState.get(interaction.user.id);
  const channelId = state?.channels?.[raidType];
  const channel = interaction.guild.channels.cache.get(channelId);

  if (!channel) {
    await interaction.update({
      content: '❌ Channel not found. Please try again.',
      components: [],
      flags: 1 << 15
    });
    return;
  }

  const botMember = await interaction.guild.members.fetchMe();
  const result = await setChannelPermissions(channel, botMember);

  if (result.success) {
    const successContainer = new ContainerBuilder();
    successContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `✅ **Permissions Set Successfully**\n\n` +
        `${channel.toString()} is now configured for ${raidType} schedules.\n\n` +
        `Continuing to host selection...`
      )
    );

    await interaction.update({ components: [successContainer], flags: 64 | 32768 });

    setTimeout(() => showHostSelection(interaction, raidType), 2000);

  } else {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `❌ **Failed to Set Permissions**\n\n` +
        `${result.error}\n\n` +
        `Please set permissions manually and try again.`
      )
    );

    const retryButton = new ButtonBuilder()
      .setCustomId(`setup_retry_channel_${raidType.toLowerCase()}`)
      .setLabel('Try Again')
      .setStyle(ButtonStyle.Primary);

    errorContainer.addActionRowComponents(
      new ActionRowBuilder().addComponents(retryButton)
    );

    await interaction.update({ components: [errorContainer], flags: 64 | 32768 });
  }
}

async function showManualPermissionInstructions(interaction, raidType) {
  const state = setupState.get(interaction.user.id);
  const channelId = state?.channels?.[raidType];
  const channel = interaction.guild.channels.cache.get(channelId);

  if (!channel) {
    await interaction.update({
      content: '❌ Channel not found. Please try again.',
      components: [],
      flags: 1 << 15
    });
    return;
  }

  const errorContainer = new ContainerBuilder();
  const errorText =
    `📝 **Manual Permission Setup for ${channel.toString()}**\n\n` +
    `**How to Set Permissions:**\n\n` +
    `**Option 1: Channel-Specific (Recommended)**\n` +
    `1. Right-click ${channel.toString()} → **Edit Channel**\n` +
    `2. Go to **Permissions** tab\n` +
    `3. Click **+** to add a role/member\n` +
    `4. Select **NA Forays Schedule** (the bot's role)\n` +
    `5. Enable these permissions:\n` +
    `   • View Channel\n` +
    `   • Send Messages\n` +
    `   • Embed Links\n` +
    `   • Attach Files\n` +
    `   • Read Message History\n` +
    `6. Click **Save Changes**\n\n` +
    `**Option 2: Server-Wide (Easier, Less Secure)**\n` +
    `1. Go to **Server Settings** → **Roles**\n` +
    `2. Find **NA Forays Schedule** role\n` +
    `3. Enable the permissions listed above\n` +
    `4. Click **Save Changes**\n\n` +
    `Click "Continue" after setting permissions.`;

  errorContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(errorText)
  );

  const continueButton = new ButtonBuilder()
    .setCustomId(`setup_retry_channel_${raidType.toLowerCase()}`)
    .setLabel('Continue')
    .setStyle(ButtonStyle.Primary);

  errorContainer.addActionRowComponents(
    new ActionRowBuilder().addComponents(continueButton)
  );

  await interaction.update({ components: [errorContainer], flags: 64 | 32768 });
}

async function showHostSelection(interaction, raidType) {
  const hostServers = getHostServersForRaidType(raidType);
  
  const container = new ContainerBuilder();

  const headerText = 
    `## Setup: Select Host Servers for ${raidType}\n\n` +
    `Choose which host servers' schedules to display.\n` +
    `You can select multiple servers.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerText)
  );

  const hostSelect = new StringSelectMenuBuilder()
    .setCustomId(`setup_select_hosts_${raidType.toLowerCase()}`)
    .setPlaceholder('Select host servers')
    .setMinValues(1)
    .setMaxValues(hostServers.length)
    .addOptions(
      hostServers.map(server => {
        const option = {
          label: server,
          value: server,
          default: false
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

  await interaction.update({
    components: [container],
    flags: 64 | 32768
  });
}

async function showHostSelectionDelayed(interaction, raidType, state) {
  const hostServers = getHostServersForRaidType(raidType);
  
  const container = new ContainerBuilder();

  const headerText = 
    `## Setup: Select Host Servers for ${raidType}\n\n` +
    `Choose which host servers' schedules to display.\n` +
    `You can select multiple servers.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerText)
  );

  const hostSelect = new StringSelectMenuBuilder()
    .setCustomId(`setup_select_hosts_${raidType.toLowerCase()}`)
    .setPlaceholder('Select host servers')
    .setMinValues(1)
    .setMaxValues(hostServers.length)
    .addOptions(
      hostServers.map(server => {
        const option = {
          label: server,
          value: server,
          default: false
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

  await interaction.editReply({
    components: [container]
  });
}

async function handleHostSelection(interaction, raidType) {
  const selectedHosts = interaction.values;
  const state = setupState.get(interaction.user.id) || {};
  
  if (!state.selectedRaidTypes || !Array.isArray(state.selectedRaidTypes)) {
    const errorContainer = new ContainerBuilder();
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Setup session expired or invalid. Please run `/na-schedule` again to restart setup.')
    );
    await interaction.update({
      components: [errorContainer],
      flags: 1 << 15
    });
    setupState.delete(interaction.user.id);
    return;
  }
  
  if (!state.hosts) state.hosts = {};
  state.hosts[raidType] = selectedHosts;
  setupState.set(interaction.user.id, state);

  const currentIndex = state.selectedRaidTypes.indexOf(raidType);
  const nextRaidType = state.selectedRaidTypes[currentIndex + 1];

  if (nextRaidType) {
    await showChannelSelection(interaction, nextRaidType, state.selectedRaidTypes);
  } else {
    await showSetupConfirmation(interaction);
  }
}

async function showSetupConfirmation(interaction) {
  const state = setupState.get(interaction.user.id) || {};
  
  const container = new ContainerBuilder();

  let confirmText = `## ✅ Setup Complete!\n\n**Configuration Summary:**\n\n`;
  
  for (const raidType of state.selectedRaidTypes) {
    const channel = interaction.guild.channels.cache.get(state.channels[raidType]);
    const hosts = state.hosts[raidType] || [];
    
    confirmText += `**${raidType}:**\n`;
    confirmText += `Channel: ${channel ? channel.toString() : 'Unknown'}\n`;
    confirmText += `Host Servers: ${hosts.join(', ')}\n\n`;
  }

  confirmText += `Schedules will automatically update every 60 seconds.`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(confirmText)
  );

  const confirmButton = new ButtonBuilder()
    .setCustomId('setup_confirm')
    .setLabel('Save Configuration')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId('setup_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(confirmButton, cancelButton)
  );

  await interaction.update({
    content: '',
    components: [container],
    flags: 64 | 32768
  });
}

async function handleSetupConfirmation(interaction) {
  const state = setupState.get(interaction.user.id);
  if (!state) {
    const container = new ContainerBuilder();
    
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ Setup session expired. Please run `/setup` again.')
    );
    
    await interaction.update({
      components: [container],
      flags: 64 | 32768
    });
    return;
  }

  try {    
    await interaction.deferUpdate();
    
    const guildId = interaction.guild.id;
    const updateManager = serviceLocator.get('updateManager');

    let configData;
    
    if (state.returnToConfig) {
      const existingConfig = await encryptedDb.getServerConfig(guildId);
      
      configData = {
        guild_name: interaction.guild.name,
        setup_complete: 1,
        auto_update: existingConfig?.auto_update ?? 1,
        schedule_color_ba: existingConfig?.schedule_color_ba ?? -1,
        schedule_color_ft: existingConfig?.schedule_color_ft ?? -1,
        schedule_color_drs: existingConfig?.schedule_color_drs ?? -1,
        schedule_channel_ba: existingConfig?.schedule_channel_ba,
        schedule_channel_ft: existingConfig?.schedule_channel_ft,
        schedule_channel_drs: existingConfig?.schedule_channel_drs,
        enabled_hosts_ba: existingConfig?.enabled_hosts_ba,
        enabled_hosts_ft: existingConfig?.enabled_hosts_ft,
        enabled_hosts_drs: existingConfig?.enabled_hosts_drs,
        schedule_overview_ba: existingConfig?.schedule_overview_ba,
        schedule_overview_ft: existingConfig?.schedule_overview_ft,
        schedule_overview_drs: existingConfig?.schedule_overview_drs,
        schedule_message_ba: existingConfig?.schedule_message_ba,
        schedule_message_ft: existingConfig?.schedule_message_ft,
        schedule_message_drs: existingConfig?.schedule_message_drs
      };
      
      for (const raidType of state.selectedRaidTypes) {
        const channelKey = getScheduleChannelKey(raidType);
        const hostsKey = getEnabledHostsKey(raidType);
        
        configData[channelKey] = state.channels[raidType];
        configData[hostsKey] = state.hosts[raidType];
      }
    } else {
      configData = {
        guild_name: interaction.guild.name,
        setup_complete: 1,
        auto_update: 1,
        schedule_color_ba: -1,
        schedule_color_ft: -1,
        schedule_color_drs: -1
      };

      for (const raidType of state.selectedRaidTypes) {
        const channelKey = getScheduleChannelKey(raidType);
        const hostsKey = getEnabledHostsKey(raidType);
        
        configData[channelKey] = state.channels[raidType];
        configData[hostsKey] = state.hosts[raidType];
      }
    }

    await encryptedDb.upsertServerConfig(guildId, configData);

    await updateManager.forceUpdate(guildId);

    const returnToConfig = state.returnToConfig;
    setupState.delete(interaction.user.id);

    if (returnToConfig) {
      const { buildConfigMenu } = require('../utils/configMenuBuilder');
      const config = await encryptedDb.getServerConfig(guildId);
      const container = buildConfigMenu(config, interaction.guild);
      
      await interaction.editReply({
        components: [container],
        flags: 1 << 15
      });
      
      logger.info('Setup completed, returned to config menu', {
        guildId,
        raidTypes: state.selectedRaidTypes
      });
    } else {
      const successContainer = new ContainerBuilder();
      
      successContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('✅ **Setup complete!** Schedules are now being displayed and will update automatically every 60 seconds.')
      );
      
      await interaction.editReply({
        components: [successContainer]
      });

      logger.info('Setup completed', {
        guildId,
        raidTypes: state.selectedRaidTypes
      });
    }

  } catch (error) {
    logger.error('Error saving setup', {
      error: error.message,
      guildId: interaction.guild.id
    });

    const errorContainer = new ContainerBuilder();
    
    errorContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('❌ An error occurred saving your configuration. Please try again.')
    );
    
    await interaction.editReply({
      components: [errorContainer]
    }).catch(() => {
      interaction.followUp({
        content: '❌ An error occurred saving your configuration. Please try again.',
        flags: 64 | 32768
      }).catch(() => {});
    });
  }
}

module.exports = { 
  handleSetupInteraction,
  showChannelSelection,
  showHostSelection,
  setupState
};
