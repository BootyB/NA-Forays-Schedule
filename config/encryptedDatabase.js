// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const pool = require('./database');
const { encrypt, decrypt, encryptJSON, decryptJSON, hashGuildId, DEV_SERVER_ID } = require('../utils/encryption');
const { 
  ALL_RAID_TYPES, 
  getScheduleChannelKey, 
  getScheduleOverviewKey, 
  getEnabledHostsKey, 
  getScheduleMessageKey,
  getScheduleColorKey 
} = require('../utils/raidTypes');

function encryptField(value, isDevServer) {
  if (!value) return null;
  if (isDevServer) return `DEV:${value}`;
  return encrypt(value);
}

function encryptJSONField(value, isDevServer) {
  if (!value) return null;
  if (isDevServer) return `DEV:${JSON.stringify(value)}`;
  return encryptJSON(value);
}

function decryptField(value) {
  if (!value) return null;
  if (value.startsWith('DEV:')) return value.substring(4);
  return decrypt(value);
}

function decryptJSONField(value) {
  if (!value) return null;
  if (value.startsWith('DEV:')) return JSON.parse(value.substring(4));
  return decryptJSON(value);
}

function encryptConfigFields(guildId, config) {
  const isDevServer = guildId === DEV_SERVER_ID;
  
  const result = {
    guild_id: guildId, // Keep for backward compatibility during migration
    guild_id_encrypted: encryptField(guildId, isDevServer),
    guild_id_hash: hashGuildId(guildId),
    guild_name: config.guild_name ? encryptField(config.guild_name, isDevServer) : null,
    setup_complete: config.setup_complete,
    auto_update: config.auto_update
  };
  
  // Encrypt raid-type specific fields using loop instead of hardcoded fields
  for (const raidType of ALL_RAID_TYPES) {
    const channelKey = getScheduleChannelKey(raidType);
    const overviewKey = getScheduleOverviewKey(raidType);
    const hostsKey = getEnabledHostsKey(raidType);
    const messageKey = getScheduleMessageKey(raidType);
    const colorKey = getScheduleColorKey(raidType);
    
    // Regular encrypted fields
    result[channelKey] = config[channelKey] ? encryptField(config[channelKey], isDevServer) : null;
    result[overviewKey] = config[overviewKey] ? encryptField(config[overviewKey], isDevServer) : null;
    
    // JSON encrypted fields
    result[hostsKey] = config[hostsKey] ? encryptJSONField(config[hostsKey], isDevServer) : null;
    result[messageKey] = config[messageKey] ? encryptJSONField(config[messageKey], isDevServer) : null;
    
    // Non-encrypted color field
    result[colorKey] = config[colorKey];
  }
  
  return result;
}

function decryptConfigFields(encryptedConfig) {
  if (!encryptedConfig) return null;
  
  const result = {
    guild_id: encryptedConfig.guild_id_encrypted ? decryptField(encryptedConfig.guild_id_encrypted) : encryptedConfig.guild_id,
    guild_name: encryptedConfig.guild_name ? decryptField(encryptedConfig.guild_name) : null,
    setup_complete: encryptedConfig.setup_complete,
    auto_update: encryptedConfig.auto_update,
    created_at: encryptedConfig.created_at,
    updated_at: encryptedConfig.updated_at
  };
  
  // Decrypt raid-type specific fields using loop instead of hardcoded fields
  for (const raidType of ALL_RAID_TYPES) {
    const channelKey = getScheduleChannelKey(raidType);
    const overviewKey = getScheduleOverviewKey(raidType);
    const hostsKey = getEnabledHostsKey(raidType);
    const messageKey = getScheduleMessageKey(raidType);
    const colorKey = getScheduleColorKey(raidType);
    
    // Regular encrypted fields
    result[channelKey] = encryptedConfig[channelKey] ? decryptField(encryptedConfig[channelKey]) : null;
    result[overviewKey] = encryptedConfig[overviewKey] ? decryptField(encryptedConfig[overviewKey]) : null;
    
    // JSON encrypted fields (with fallback to empty array)
    result[hostsKey] = encryptedConfig[hostsKey] ? (decryptJSONField(encryptedConfig[hostsKey]) || []) : null;
    result[messageKey] = encryptedConfig[messageKey] ? (decryptJSONField(encryptedConfig[messageKey]) || []) : null;
    
    // Non-encrypted color field
    result[colorKey] = encryptedConfig[colorKey];
  }
  
  return result;
}

async function getServerConfig(guildId) {
  const guildIdHash = hashGuildId(guildId);
  const configs = await pool.query('SELECT * FROM na_bot_server_configs WHERE guild_id_hash = ?', [guildIdHash]);
  
  if (configs.length === 0) {
    return null;
  }
  
  return decryptConfigFields(configs[0]);
}

async function getActiveServerConfigs(whereClause = '', params = []) {
  const query = `SELECT * FROM na_bot_server_configs ${whereClause}`;
  const encryptedConfigs = await pool.query(query, params);
  
  return encryptedConfigs.map(config => decryptConfigFields(config));
}

async function upsertServerConfig(guildId, config) {
  const encrypted = encryptConfigFields(guildId, config);
  
  await pool.query(
    `INSERT INTO na_bot_server_configs 
     (guild_id, guild_id_encrypted, guild_id_hash, guild_name, setup_complete, auto_update,
      schedule_channel_ba, schedule_channel_ft, schedule_channel_drs,
      schedule_overview_ba, schedule_overview_ft, schedule_overview_drs,
      enabled_hosts_ba, enabled_hosts_ft, enabled_hosts_drs,
      schedule_message_ba, schedule_message_ft, schedule_message_drs,
      schedule_color_ba, schedule_color_ft, schedule_color_drs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE 
       guild_id_encrypted = VALUES(guild_id_encrypted),
       guild_name = VALUES(guild_name),
       setup_complete = VALUES(setup_complete),
       auto_update = VALUES(auto_update),
       schedule_channel_ba = VALUES(schedule_channel_ba),
       schedule_channel_ft = VALUES(schedule_channel_ft),
       schedule_channel_drs = VALUES(schedule_channel_drs),
       schedule_overview_ba = VALUES(schedule_overview_ba),
       schedule_overview_ft = VALUES(schedule_overview_ft),
       schedule_overview_drs = VALUES(schedule_overview_drs),
       enabled_hosts_ba = VALUES(enabled_hosts_ba),
       enabled_hosts_ft = VALUES(enabled_hosts_ft),
       enabled_hosts_drs = VALUES(enabled_hosts_drs),
       schedule_message_ba = VALUES(schedule_message_ba),
       schedule_message_ft = VALUES(schedule_message_ft),
       schedule_message_drs = VALUES(schedule_message_drs),
       schedule_color_ba = VALUES(schedule_color_ba),
       schedule_color_ft = VALUES(schedule_color_ft),
       schedule_color_drs = VALUES(schedule_color_drs)`,
    [
      encrypted.guild_id,
      encrypted.guild_id_encrypted,
      encrypted.guild_id_hash,
      encrypted.guild_name,
      encrypted.setup_complete,
      encrypted.auto_update,
      encrypted.schedule_channel_ba,
      encrypted.schedule_channel_ft,
      encrypted.schedule_channel_drs,
      encrypted.schedule_overview_ba,
      encrypted.schedule_overview_ft,
      encrypted.schedule_overview_drs,
      encrypted.enabled_hosts_ba,
      encrypted.enabled_hosts_ft,
      encrypted.enabled_hosts_drs,
      encrypted.schedule_message_ba,
      encrypted.schedule_message_ft,
      encrypted.schedule_message_drs,
      encrypted.schedule_color_ba,
      encrypted.schedule_color_ft,
      encrypted.schedule_color_drs
    ]
  );
}

async function updateServerConfig(guildId, updates) {
  const guildIdHash = hashGuildId(guildId);
  const exists = await pool.query('SELECT 1 FROM na_bot_server_configs WHERE guild_id_hash = ?', [guildIdHash]);
  
  if (exists.length === 0) {
    throw new Error(`Server config not found for guild: ${guildId}`);
  }
  
  const isDevServer = guildId === DEV_SERVER_ID;
  
  const encryptedUpdates = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) {
      encryptedUpdates[key] = null;
      continue;
    }
    
    if (key === 'guild_name') {
      encryptedUpdates[key] = encryptField(value, isDevServer);
    } else if (key.includes('channel') || key.includes('overview')) {
      encryptedUpdates[key] = encryptField(value, isDevServer);
    } else if (key.includes('enabled_hosts') || key.includes('schedule_message')) {
      encryptedUpdates[key] = encryptJSONField(value, isDevServer);
    } else {
      encryptedUpdates[key] = value;
    }
  }
  
  const setClauses = Object.keys(encryptedUpdates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(encryptedUpdates);
  
  await pool.query(
    `UPDATE na_bot_server_configs SET ${setClauses} WHERE guild_id_hash = ?`,
    [...values, guildIdHash]
  );
}

async function deleteServerConfig(guildId) {
  const guildIdHash = hashGuildId(guildId);
  await pool.query('DELETE FROM na_bot_server_configs WHERE guild_id_hash = ?', [guildIdHash]);
}

async function getWhitelistedGuild(guildId) {
  const guildIdHash = hashGuildId(guildId);
  const guilds = await pool.query(
    'SELECT * FROM na_bot_whitelisted_guilds WHERE guild_id_hash = ? AND is_active = 1',
    [guildIdHash]
  );
  
  if (guilds.length === 0) {
    return null;
  }
  
  const guild = guilds[0];
  return {
    guild_id: guild.guild_id_encrypted ? decryptField(guild.guild_id_encrypted) : guild.guild_id,
    guild_name: guild.guild_name ? decryptField(guild.guild_name) : null,
    added_by: guild.added_by ? decryptField(guild.added_by) : null,
    added_at: guild.added_at,
    is_active: guild.is_active,
    notes: guild.notes
  };
}

async function removeWhitelistedGuild(guildId) {
  const guildIdHash = hashGuildId(guildId);
  await pool.query(
    'UPDATE na_bot_whitelisted_guilds SET is_active = 0 WHERE guild_id_hash = ?',
    [guildIdHash]
  );
}

async function getAllWhitelistedGuilds() {
  const encryptedGuilds = await pool.query(
    'SELECT * FROM na_bot_whitelisted_guilds WHERE is_active = 1'
  );
  
  return encryptedGuilds.map(guild => ({
    guild_id: guild.guild_id_encrypted ? decryptField(guild.guild_id_encrypted) : guild.guild_id,
    guild_name: guild.guild_name ? decryptField(guild.guild_name) : null,
    added_by: guild.added_by ? decryptField(guild.added_by) : null,
    added_at: guild.added_at,
    is_active: guild.is_active,
    notes: guild.notes
  }));
}

async function addWhitelistedGuild(guildId, guildName, addedBy, notes = null) {
  const isDevServer = guildId === DEV_SERVER_ID;
  const guildIdHash = hashGuildId(guildId);
  await pool.query(
    'INSERT INTO na_bot_whitelisted_guilds (guild_id, guild_id_encrypted, guild_id_hash, guild_name, added_by, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, encryptField(guildId, isDevServer), guildIdHash, encryptField(guildName, isDevServer), encryptField(addedBy, isDevServer), notes]
  );
}

module.exports = {
  getServerConfig,
  getActiveServerConfigs,
  upsertServerConfig,
  updateServerConfig,
  deleteServerConfig,
  
  getWhitelistedGuild,
  addWhitelistedGuild,
  removeWhitelistedGuild,
  getAllWhitelistedGuilds,
  
  encryptConfigFields,
  decryptConfigFields
};
