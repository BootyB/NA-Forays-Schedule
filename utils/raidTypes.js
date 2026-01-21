// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { RAID_TYPES, GOOGLE_CALENDAR_IDS, BANNER_IMAGES } = require('../config/constants');

const RaidTypeKey = Object.freeze(
  Object.keys(RAID_TYPES).reduce((acc, key) => {
    acc[key] = key;
    return acc;
  }, {})
);

const ALL_RAID_TYPES = Object.freeze(Object.keys(RAID_TYPES));

function isValidRaidType(type) {
  return ALL_RAID_TYPES.includes(type);
}

function getAllRaidTypes() {
  return [...ALL_RAID_TYPES];
}

function getRaidTypeInfo(raidType) {
  return RAID_TYPES[raidType] || null;
}

function getRaidTypeName(raidType) {
  return RAID_TYPES[raidType]?.name || raidType;
}

function getRaidTypeColor(raidType) {
  return RAID_TYPES[raidType]?.color || 0xED4245;
}

function getRaidTypeEmoji(raidType) {
  return RAID_TYPES[raidType]?.emoji || null;
}

function getRunTypePriority(raidType) {
  return RAID_TYPES[raidType]?.runTypes || [];
}

function getBannerImage(raidType) {
  return BANNER_IMAGES[raidType] || null;
}

function getCalendarId(raidType) {
  return GOOGLE_CALENDAR_IDS[raidType] || null;
}

function getConfigKey(prefix, raidType) {
  return `${prefix}_${raidType.toLowerCase()}`;
}

function getAllConfigKeys(prefix) {
  const keys = {};
  for (const raidType of ALL_RAID_TYPES) {
    keys[raidType] = getConfigKey(prefix, raidType);
  }
  return keys;
}

const ConfigKeys = Object.freeze({
  SCHEDULE_CHANNEL: getAllConfigKeys('schedule_channel'),
  SCHEDULE_OVERVIEW: getAllConfigKeys('schedule_overview'),
  ENABLED_HOSTS: getAllConfigKeys('enabled_hosts'),
  SCHEDULE_MESSAGE: getAllConfigKeys('schedule_message'),
  SCHEDULE_COLOR: getAllConfigKeys('schedule_color')
});

function getScheduleChannelKey(raidType) {
  return ConfigKeys.SCHEDULE_CHANNEL[raidType];
}

function getScheduleOverviewKey(raidType) {
  return ConfigKeys.SCHEDULE_OVERVIEW[raidType];
}

function getEnabledHostsKey(raidType) {
  return ConfigKeys.ENABLED_HOSTS[raidType];
}

function getScheduleMessageKey(raidType) {
  return ConfigKeys.SCHEDULE_MESSAGE[raidType];
}

function getScheduleColorKey(raidType) {
  return ConfigKeys.SCHEDULE_COLOR[raidType];
}

function forEachRaidType(callback) {
  for (const raidType of ALL_RAID_TYPES) {
    callback(raidType, RAID_TYPES[raidType]);
  }
}

function mapRaidTypes(callback) {
  return ALL_RAID_TYPES.map(raidType => callback(raidType, RAID_TYPES[raidType]));
}

function buildRaidTypeObject(valueGenerator) {
  const result = {};
  for (const raidType of ALL_RAID_TYPES) {
    result[raidType] = valueGenerator(raidType);
  }
  return result;
}

const ENCRYPTED_FIELD_MAP = Object.freeze([
  { prefix: 'schedule_channel', type: 'field' },
  { prefix: 'schedule_overview', type: 'field' },
  { prefix: 'enabled_hosts', type: 'json' },
  { prefix: 'schedule_message', type: 'json' }
]);

function getEncryptedFieldConfigs() {
  const configs = [];
  for (const { prefix, type } of ENCRYPTED_FIELD_MAP) {
    for (const raidType of ALL_RAID_TYPES) {
      configs.push({
        configKey: getConfigKey(prefix, raidType),
        raidType,
        encryptType: type
      });
    }
  }
  return configs;
}

function getColorFieldConfigs() {
  return ALL_RAID_TYPES.map(raidType => ({
    key: raidType.toLowerCase(),
    configKey: getScheduleColorKey(raidType),
    raidType
  }));
}

function getRaidTypeQueryFilter(raidType) {
  return RAID_TYPES[raidType]?.dbQueryFilter || '1=1';
}

module.exports = {
  // Enum-like keys
  RaidTypeKey,
  ALL_RAID_TYPES,
  
  // Validation
  isValidRaidType,
  
  // Getters
  getAllRaidTypes,
  getRaidTypeInfo,
  getRaidTypeName,
  getRaidTypeColor,
  getRaidTypeEmoji,
  getRunTypePriority,
  getBannerImage,
  getCalendarId,
  
  // Config key helpers
  getConfigKey,
  getAllConfigKeys,
  ConfigKeys,
  getScheduleChannelKey,
  getScheduleOverviewKey,
  getEnabledHostsKey,
  getScheduleMessageKey,
  getScheduleColorKey,
  
  // Iteration helpers
  forEachRaidType,
  mapRaidTypes,
  buildRaidTypeObject,
  
  // Database field mapping
  ENCRYPTED_FIELD_MAP,
  getEncryptedFieldConfigs,
  getColorFieldConfigs,
  
  // Database query helpers
  getRaidTypeQueryFilter
};
