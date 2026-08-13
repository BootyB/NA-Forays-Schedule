// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const RAID_TYPES = {
  BA: {
    name: 'Baldesion Arsenal',
    emoji: { id: '1460936708538499202', name: 'ozma' },
    color: 0xED4245,
    runTypes: ['Fresh', 'Learning', 'Standard', 'Normal', 'Reclear', 'Non-Standard', 'Frag', 'Meme'],
    dbQueryFilter: '"DRS" = 0 AND "FT" = 0'
  },
  FT: {
    name: 'Forked Tower',
    emoji: { id: '1460937119559192647', name: 'demoncube' },
    color: 0xED4245,
    runTypes: ['Fresh/AnyProg', 'Dead Stars', 'Bridges', 'Marble Dragon', 'Magitaur', 'Clear', 'Reclear', 'Static'],
    dbQueryFilter: '"FT" = 1'
  },
  DRS: {
    name: 'Delubrum Reginae Savage',
    emoji: { id: '1460943074724155599', name: 'queen' },
    color: 0xED4245,
    runTypes: ['Fresh/AnyProg', 'Queen\'s Guard', 'Trinity Avowed', 'The Queen', 'Reclear'],
    dbQueryFilter: '"DRS" = 1'
  }
};

const UPDATE_INTERVAL = 60000;

const SCHEDULE_DAYS_AHEAD = 90;

const GOOGLE_CALENDAR_IDS = {
  'BA': 'da548ac3301f1a3652f668b98b53255e1cde7aa39001c71bcb2ad063bbb4958a%40group.calendar.google.com',
  'FT_BLOOD': '00cbef49f62776b3905e37b154616b5a1025e944b9346c294c7c621df1e26e63%40group.calendar.google.com',
  'FT_MAGIC': '699970e5e0dd798a720d2e9bc974dc916307be851ee8d5df47349277662cfc64@group.calendar.google.com',
  'DRS': '0df4417fcd1e22b355fdbee9873df5216e3e708d953777f08861cfd3688be39c%40group.calendar.google.com'
};

function getCalendarLinks(calendarId) {
  if (!calendarId) return null;

  return {
    gcal: `https://calendar.google.com/calendar/u/2?cid=${calendarId.replace('@', '%40')}`,
    ical: `https://calendar.google.com/calendar/ical/${calendarId}/public/basic.ics`,
    utc: `https://calendar.google.com/calendar/embed?src=${calendarId}`,
    eastern: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=America%2FNew_York`,
    pacific: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=America%2FLos_Angeles`,
    australia: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=Antarctica%2FMacquarie`
  };
}

// Timezone options for the schedule timezone selector
const TIMEZONE_OPTIONS = [
  { label: 'UTC-11 - Pago Pago / Niue', value: 'Etc/GMT+11', description: 'American Samoa and Niue' },
  { label: 'UTC-10 - Honolulu / Tahiti', value: 'Etc/GMT+10', description: 'Hawaii and French Polynesia' },
  { label: 'UTC-09 - Anchorage / Juneau', value: 'Etc/GMT+9', description: 'Alaska standard time' },
  { label: 'UTC-08 - Los Angeles / Vancouver', value: 'Etc/GMT+8', description: 'Pacific standard time' },
  { label: 'UTC-07 - Denver / Phoenix', value: 'Etc/GMT+7', description: 'Mountain standard time' },
  { label: 'UTC-06 - Chicago / Mexico City', value: 'Etc/GMT+6', description: 'Central standard time' },
  { label: 'UTC-05 - New York / Toronto', value: 'Etc/GMT+5', description: 'Eastern standard time, Lima, Bogota' },
  { label: 'UTC-04 - Halifax / Caracas', value: 'Etc/GMT+4', description: 'Atlantic standard time, La Paz' },
  { label: 'UTC-03 - Buenos Aires / Sao Paulo', value: 'Etc/GMT+3', description: 'Argentina, eastern Brazil, Montevideo' },
  { label: 'UTC-02 - South Georgia', value: 'Etc/GMT+2', description: 'Mid-Atlantic islands' },
  { label: 'UTC-01 - Azores / Cape Verde', value: 'Etc/GMT+1', description: 'Azores standard time and Cape Verde' },
  { label: 'UTC+00 - London / Lisbon', value: 'Etc/GMT', description: 'Greenwich mean time, Accra, Reykjavik' },
  { label: 'UTC+01 - Paris / Berlin', value: 'Etc/GMT-1', description: 'Central Europe, Lagos, Algiers' },
  { label: 'UTC+02 - Cairo / Johannesburg', value: 'Etc/GMT-2', description: 'Eastern Europe and South Africa' },
  { label: 'UTC+03 - Moscow / Istanbul', value: 'Etc/GMT-3', description: 'East Africa, Arabia, western Russia' },
  { label: 'UTC+04 - Dubai / Baku', value: 'Etc/GMT-4', description: 'Gulf, Caucasus, Mauritius' },
  { label: 'UTC+05 - Karachi / Tashkent', value: 'Etc/GMT-5', description: 'Pakistan and Uzbekistan' },
  { label: 'UTC+06 - Dhaka / Almaty', value: 'Etc/GMT-6', description: 'Bangladesh and Kazakhstan' },
  { label: 'UTC+07 - Bangkok / Jakarta', value: 'Etc/GMT-7', description: 'Indochina and western Indonesia' },
  { label: 'UTC+08 - Singapore / Perth', value: 'Etc/GMT-8', description: 'China, Malaysia, Philippines, western Australia' },
  { label: 'UTC+09 - Tokyo / Seoul', value: 'Etc/GMT-9', description: 'Japan, Korea, eastern Indonesia' },
  { label: 'UTC+10 - Sydney / Brisbane', value: 'Etc/GMT-10', description: 'Eastern Australia and Papua New Guinea' },
  { label: 'UTC+11 - Noumea / Honiara', value: 'Etc/GMT-11', description: 'New Caledonia, Solomon Islands' },
  { label: 'UTC+12 - Auckland / Fiji', value: 'Etc/GMT-12', description: 'New Zealand standard time and Fiji' }
];
const MAX_TEXT_LENGTH = 4000;

const BANNER_IMAGES = {
  BA: 'attachment://ba_opening.avif',
  DRS: 'attachment://drs_opening.avif',
  FTB: 'attachment://ftb_opening.avif',
  FTM: 'attachment://ftm_opening.avif'
};

const DEFAULT_SCHEDULE_CHANNEL_NAMES = {
  BA: 'na-arsenal-schedule',
  FT: 'na-forked-schedule',
  DRS: 'na-drs-schedule'
};

const SPACER_IMAGE_URL = 'https://i.imgur.com/ZfizSs7.png';

const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT) || 3;

const RATE_LIMITER = {
  COMMAND_COOLDOWN: 3000,       // 3 seconds between commands
  INTERACTION_COOLDOWN: 1000,   // 1 second between interactions
  REQUEST_WINDOW: 60000,        // 1 minute window
  MAX_REQUESTS_PER_WINDOW: 30,  // Max 30 requests per minute
  CLEANUP_INTERVAL: 300000      // Cleanup every 5 minutes
};

// Default health check port (can be overridden via HEALTH_PORT env var)
const DEFAULT_HEALTH_PORT = 3000;

// Dev/Prod environment separation
// Dev bot only handles the dev server, prod bot excludes it
// Set DEV_SERVER_ID in env to specify which guild is the dev server
const DEV_SERVER_GUILD_ID = process.env.DEV_SERVER_ID || null;
const IS_DEV_BOT = process.env.IS_DEV_BOT === 'true';

const WHITELIST_ENABLED = process.env.WHITELIST_ENABLED === 'true';

module.exports = {
  RAID_TYPES,
  UPDATE_INTERVAL,
  SCHEDULE_DAYS_AHEAD,
  GOOGLE_CALENDAR_IDS,
  getCalendarLinks,
  TIMEZONE_OPTIONS,
  MAX_TEXT_LENGTH,
  BANNER_IMAGES,
  DEFAULT_SCHEDULE_CHANNEL_NAMES,
  SPACER_IMAGE_URL,
  CONCURRENCY_LIMIT,
  RATE_LIMITER,
  DEFAULT_HEALTH_PORT,
  DEV_SERVER_GUILD_ID,
  IS_DEV_BOT,
  WHITELIST_ENABLED
};
