// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const sql = require('./database');
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
    guild_id: guildId,
    guild_id_encrypted: encryptField(guildId, isDevServer),
    guild_id_hash: hashGuildId(guildId),
    guild_name: config.guild_name ? encryptField(config.guild_name, isDevServer) : null,
    setup_complete: config.setup_complete,
    auto_update: config.auto_update
  };
  
  for (const raidType of ALL_RAID_TYPES) {
    const channelKey = getScheduleChannelKey(raidType);
    const overviewKey = getScheduleOverviewKey(raidType);
    const hostsKey = getEnabledHostsKey(raidType);
    const messageKey = getScheduleMessageKey(raidType);
    const colorKey = getScheduleColorKey(raidType);
    
    result[channelKey] = config[channelKey] ? encryptField(config[channelKey], isDevServer) : null;
    result[overviewKey] = config[overviewKey] ? encryptField(config[overviewKey], isDevServer) : null;
    
    result[hostsKey] = config[hostsKey] ? encryptJSONField(config[hostsKey], isDevServer) : null;
    result[messageKey] = config[messageKey] ? encryptJSONField(config[messageKey], isDevServer) : null;
    
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
  
  for (const raidType of ALL_RAID_TYPES) {
    const channelKey = getScheduleChannelKey(raidType);
    const overviewKey = getScheduleOverviewKey(raidType);
    const hostsKey = getEnabledHostsKey(raidType);
    const messageKey = getScheduleMessageKey(raidType);
    const colorKey = getScheduleColorKey(raidType);
    
    result[channelKey] = encryptedConfig[channelKey] ? decryptField(encryptedConfig[channelKey]) : null;
    result[overviewKey] = encryptedConfig[overviewKey] ? decryptField(encryptedConfig[overviewKey]) : null;
    
    result[hostsKey] = encryptedConfig[hostsKey] ? (decryptJSONField(encryptedConfig[hostsKey]) || []) : null;
    result[messageKey] = encryptedConfig[messageKey] ? (decryptJSONField(encryptedConfig[messageKey]) || []) : null;
    
    result[colorKey] = encryptedConfig[colorKey];
  }
  
  return result;
}

async function getServerConfig(guildId) {
  const guildIdHash = hashGuildId(guildId);
  const configs = await sql`SELECT * FROM na_bot_server_configs WHERE guild_id_hash = ${guildIdHash}`;
  
  if (configs.length === 0) {
    return null;
  }
  
  return decryptConfigFields(configs[0]);
}

async function getActiveServerConfigs(whereClause = '', params = []) {
  let configs;
  if (whereClause && params.length > 0) {
    const query = `SELECT * FROM na_bot_server_configs ${whereClause}`;
    configs = await sql.unsafe(query, params);
  } else if (whereClause) {
    configs = await sql.unsafe(`SELECT * FROM na_bot_server_configs ${whereClause}`);
  } else {
    configs = await sql`SELECT * FROM na_bot_server_configs`;
  }
  
  return configs.map(config => decryptConfigFields(config));
}

async function upsertServerConfig(guildId, config) {
  const encrypted = encryptConfigFields(guildId, config);
  
  await sql`
    INSERT INTO na_bot_server_configs 
     (guild_id, guild_id_encrypted, guild_id_hash, guild_name, setup_complete, auto_update,
      schedule_channel_ba, schedule_channel_ft, schedule_channel_drs,
      schedule_overview_ba, schedule_overview_ft, schedule_overview_drs,
      enabled_hosts_ba, enabled_hosts_ft, enabled_hosts_drs,
      schedule_message_ba, schedule_message_ft, schedule_message_drs,
      schedule_color_ba, schedule_color_ft, schedule_color_drs)
     VALUES (${encrypted.guild_id}, ${encrypted.guild_id_encrypted}, ${encrypted.guild_id_hash}, 
             ${encrypted.guild_name}, ${encrypted.setup_complete}, ${encrypted.auto_update},
             ${encrypted.schedule_channel_ba}, ${encrypted.schedule_channel_ft}, ${encrypted.schedule_channel_drs},
             ${encrypted.schedule_overview_ba}, ${encrypted.schedule_overview_ft}, ${encrypted.schedule_overview_drs},
             ${encrypted.enabled_hosts_ba}, ${encrypted.enabled_hosts_ft}, ${encrypted.enabled_hosts_drs},
             ${encrypted.schedule_message_ba}, ${encrypted.schedule_message_ft}, ${encrypted.schedule_message_drs},
             ${encrypted.schedule_color_ba}, ${encrypted.schedule_color_ft}, ${encrypted.schedule_color_drs})
     ON CONFLICT (guild_id) DO UPDATE SET
       guild_id_encrypted = EXCLUDED.guild_id_encrypted,
       guild_name = EXCLUDED.guild_name,
       setup_complete = EXCLUDED.setup_complete,
       auto_update = EXCLUDED.auto_update,
       schedule_channel_ba = EXCLUDED.schedule_channel_ba,
       schedule_channel_ft = EXCLUDED.schedule_channel_ft,
       schedule_channel_drs = EXCLUDED.schedule_channel_drs,
       schedule_overview_ba = EXCLUDED.schedule_overview_ba,
       schedule_overview_ft = EXCLUDED.schedule_overview_ft,
       schedule_overview_drs = EXCLUDED.schedule_overview_drs,
       enabled_hosts_ba = EXCLUDED.enabled_hosts_ba,
       enabled_hosts_ft = EXCLUDED.enabled_hosts_ft,
       enabled_hosts_drs = EXCLUDED.enabled_hosts_drs,
       schedule_message_ba = EXCLUDED.schedule_message_ba,
       schedule_message_ft = EXCLUDED.schedule_message_ft,
       schedule_message_drs = EXCLUDED.schedule_message_drs,
       schedule_color_ba = EXCLUDED.schedule_color_ba,
       schedule_color_ft = EXCLUDED.schedule_color_ft,
       schedule_color_drs = EXCLUDED.schedule_color_drs
  `;
}

async function updateServerConfig(guildId, updates) {
  const guildIdHash = hashGuildId(guildId);
  const exists = await sql`SELECT 1 FROM na_bot_server_configs WHERE guild_id_hash = ${guildIdHash}`;
  
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
  
  const keys = Object.keys(encryptedUpdates);
  const values = Object.values(encryptedUpdates);
  
  const setClause = keys.map((key, idx) => `${key} = $${idx + 1}`).join(', ');
  const query = `UPDATE na_bot_server_configs SET ${setClause} WHERE guild_id_hash = $${keys.length + 1}`;
  
  await sql.unsafe(query, [...values, guildIdHash]);
}

async function deleteServerConfig(guildId) {
  const guildIdHash = hashGuildId(guildId);
  await sql`DELETE FROM na_bot_server_configs WHERE guild_id_hash = ${guildIdHash}`;
}

async function getWhitelistedGuild(guildId) {
  const guildIdHash = hashGuildId(guildId);
  const guilds = await sql`
    SELECT * FROM na_bot_whitelisted_guilds 
    WHERE guild_id_hash = ${guildIdHash} AND is_active = true
  `;
  
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
  await sql`
    UPDATE na_bot_whitelisted_guilds SET is_active = false 
    WHERE guild_id_hash = ${guildIdHash}
  `;
}

async function getAllWhitelistedGuilds() {
  const encryptedGuilds = await sql`
    SELECT * FROM na_bot_whitelisted_guilds WHERE is_active = true
  `;
  
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
  await sql`
    INSERT INTO na_bot_whitelisted_guilds 
    (guild_id, guild_id_encrypted, guild_id_hash, guild_name, added_by, notes) 
    VALUES (${guildId}, ${encryptField(guildId, isDevServer)}, ${guildIdHash}, 
            ${encryptField(guildName, isDevServer)}, ${encryptField(addedBy, isDevServer)}, ${notes})
  `;
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
