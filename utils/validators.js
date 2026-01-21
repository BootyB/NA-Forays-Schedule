// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { getAllHostServers } = require('../config/hostServers');
const { isValidRaidType: isValidRaidTypeUtil, getAllRaidTypes } = require('./raidTypes');

function isValidGuildId(guildId) {
  return /^\d{17,19}$/.test(guildId);
}

function isValidChannelId(channelId) {
  return /^\d{17,19}$/.test(channelId);
}

function isValidRaidType(raidType) {
  return isValidRaidTypeUtil(raidType);
}

function isValidHostServer(serverName) {
  const whitelistedServers = getAllHostServers();
  return whitelistedServers.includes(serverName);
}

function areValidHostServers(serverNames) {
  if (!Array.isArray(serverNames)) return false;
  if (serverNames.length === 0) return false;
  return serverNames.every(name => isValidHostServer(name));
}

function sanitizeGuildId(input) {
  if (!input) return null;
  const sanitized = input.toString().replace(/\D/g, '');
  return isValidGuildId(sanitized) ? sanitized : null;
}

function validateServerConfig(config) {
  const errors = [];
  
  if (!config.guild_id || !isValidGuildId(config.guild_id)) {
    errors.push('Invalid guild_id');
  }
  
  for (const raidType of getAllRaidTypes()) {
    const channelKey = `schedule_channel_${raidType.toLowerCase()}`;
    if (config[channelKey] && !isValidChannelId(config[channelKey])) {
      errors.push(`Invalid ${channelKey}`);
    }
  }
  
  for (const raidType of getAllRaidTypes()) {
    const hostsKey = `enabled_hosts_${raidType.toLowerCase()}`;
    if (config[hostsKey]) {
      try {
        const hosts = JSON.parse(config[hostsKey]);
        if (!areValidHostServers(hosts)) {
          errors.push(`Invalid ${hostsKey}`);
        }
      } catch (e) {
        errors.push(`Invalid JSON in ${hostsKey}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  isValidGuildId,
  isValidChannelId,
  isValidRaidType,
  isValidHostServer,
  areValidHostServers,
  sanitizeGuildId,
  validateServerConfig
};
