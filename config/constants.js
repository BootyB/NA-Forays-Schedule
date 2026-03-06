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
    runTypes: ['Fresh/AnyProg', 'Dead Stars', 'Bridges', 'Marble Dragon', 'Magitaur', 'Clear', 'Reclear'],
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
  'FT': '00cbef49f62776b3905e37b154616b5a1025e944b9346c294c7c621df1e26e63%40group.calendar.google.com',
  'DRS': '0df4417fcd1e22b355fdbee9873df5216e3e708d953777f08861cfd3688be39c%40group.calendar.google.com'
};

function getCalendarLinks(calendarId) {
  return {
    gcal: `https://calendar.google.com/calendar/u/2?cid=${calendarId.replace('@', '%40')}`,
    ical: `https://calendar.google.com/calendar/ical/${calendarId}/public/basic.ics`,
    utc: `https://calendar.google.com/calendar/embed?src=${calendarId}`,
    eastern: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=America%2FNew_York`,
    pacific: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=America%2FLos_Angeles`,
    australia: `https://calendar.google.com/calendar/embed?src=${calendarId}&ctz=Antarctica%2FMacquarie`
  };
}

const TIMEZONE_OPTIONS = [
  { label: '🌍 UTC', value: 'UTC', description: 'Coordinated Universal Time' },
  { label: '🇺🇸 US Eastern', value: 'America/New_York', description: 'Eastern Time (US & Canada)' },
  { label: '🇺🇸 US Central', value: 'America/Chicago', description: 'Central Time (US & Canada)' },
  { label: '🇺🇸 US Mountain', value: 'America/Denver', description: 'Mountain Time (US & Canada)' },
  { label: '🇺🇸 US Pacific', value: 'America/Los_Angeles', description: 'Pacific Time (US & Canada)' },
  { label: '🇺🇸 US Alaska', value: 'America/Anchorage', description: 'Alaska Time' },
  { label: '🇺🇸 US Hawaii', value: 'Pacific/Honolulu', description: 'Hawaii Time' },
  { label: '🇬🇧 UK/Ireland', value: 'Europe/London', description: 'London, Dublin' },
  { label: '🇪🇺 Central Europe', value: 'Europe/Paris', description: 'Paris, Berlin, Rome' },
  { label: '🇯🇵 Japan', value: 'Asia/Tokyo', description: 'Japan Standard Time' },
  { label: '🇦🇺 Australia Eastern', value: 'Australia/Sydney', description: 'Sydney, Melbourne' },
  { label: '🇦🇺 Australia Central', value: 'Australia/Adelaide', description: 'Adelaide' },
  { label: '🇦🇺 Australia Western', value: 'Australia/Perth', description: 'Perth' },
  { label: '🇳🇿 New Zealand', value: 'Pacific/Auckland', description: 'Auckland' },
  { label: '🇨🇦 Eastern Canada', value: 'America/Toronto', description: 'Toronto, Montreal' },
  { label: '🇨🇦 Western Canada', value: 'America/Vancouver', description: 'Vancouver' },
  { label: '🇧🇷 Brazil', value: 'America/Sao_Paulo', description: 'São Paulo, Rio de Janeiro' },
  { label: '🇲🇽 Mexico City', value: 'America/Mexico_City', description: 'Mexico City' },
  { label: '🇸🇬 Singapore', value: 'Asia/Singapore', description: 'Singapore, Malaysia' },
  { label: '🇰🇷 South Korea', value: 'Asia/Seoul', description: 'Korea Standard Time' },
  { label: '🇨🇳 China', value: 'Asia/Shanghai', description: 'China Standard Time' },
  { label: '🇮🇳 India', value: 'Asia/Kolkata', description: 'India Standard Time' },
  { label: '🇿🇦 South Africa', value: 'Africa/Johannesburg', description: 'South Africa Standard Time' },
  { label: '🇦🇪 UAE', value: 'Asia/Dubai', description: 'Dubai, Abu Dhabi' },
  { label: '🇷🇺 Moscow', value: 'Europe/Moscow', description: 'Moscow Standard Time' }
];

const MAX_TEXT_LENGTH = 4000;

const BANNER_IMAGES = {
  BA: 'attachment://ba_opening.avif',
  DRS: 'attachment://drs_opening.avif',
  FT: 'attachment://ft_opening.avif'
};

const DEFAULT_SCHEDULE_CHANNEL_NAMES = {
  BA: 'na-arsenal-schedule',
  FT: 'na-forked-schedule',
  DRS: 'na-drs-schedule'
};

const SPACER_IMAGE_URL = 'https://i.imgur.com/ZfizSs7.png';

const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT) || 3;

// Rate limiter configuration
const RATE_LIMITER = {
  COMMAND_COOLDOWN: 3000,       // 3 seconds between commands
  INTERACTION_COOLDOWN: 1000,   // 1 second between interactions
  REQUEST_WINDOW: 60000,        // 1 minute window
  MAX_REQUESTS_PER_WINDOW: 30,  // Max 30 requests per minute
  CLEANUP_INTERVAL: 300000      // Cleanup every 5 minutes
};

const DEFAULT_HEALTH_PORT = 3000;

// Dev/Prod environment separation
// Dev bot only handles the dev server, prod bot excludes it
// Set DEV_SERVER_ID in env to specify which guild is the dev server
const DEV_SERVER_GUILD_ID = process.env.DEV_SERVER_ID || null;
const IS_DEV_BOT = process.env.IS_DEV_BOT === 'true';

// Whitelist toggle - set WHITELIST_ENABLED=false to allow all servers
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
