// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
const { IS_DEV_BOT } = require('./constants');

const HOST_SERVERS = {
  'ABBA+': {
    guildId: '544997776992501761',
    acronym: 'ABBA+',
    icon: 'https://i.imgur.com/FkB1xxL.gif',
    inviteLink: 'https://discord.gg/abbaffxiv',
    emoji: { name: 'abba', prodId: '1461225954239053956', devId: '1462742499561836634' },
    channels: {
      'BA': '994728673133473812',
      'FT': '1377521610495361054',
      'DRS': '994802544662564904'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/544997776992501761/994728673133473812',
      'FT': 'https://discord.com/channels/544997776992501761/1377521610495361054',
      'DRS': 'https://discord.com/channels/544997776992501761/994802544662564904'
    }
  },
  'CAFE': {
    guildId: '750103971187654736',
    acronym: 'CAFE',
    icon: 'https://i.gyazo.com/0857836cdbc89e27272fee33eaa77b43.webp',
    inviteLink: 'https://discord.gg/c-a-f-e',
    description: 'Join or host a Forays raid in Eureka, Bozja/Zadnor, or The Occult Crescent from FFXIV!',
    emoji: { name: 'cafe', prodId: '1461221312608469177', devId: '1462742522571919432' },
    channels: {
      'BA': '956367612659511406',
      'FT': '1377808695102279862',
      'DRS': '1167469922830536704'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/750103971187654736/956367612659511406',
      'FT': 'https://discord.com/channels/750103971187654736/1377808695102279862',
      'DRS': 'https://discord.com/channels/750103971187654736/1167469922830536704'
    }
  },
  'CEM': {
    guildId: '550702475112480769',
    acronym: 'CEM',
    icon: 'https://i.gyazo.com/351a842939675d6045232a2f8e96edf8.gif',
    inviteLink: 'https://discord.gg/cem',
    emoji: { name: 'cem', prodId: '1461221409484181555', devId: '1462742567299977320', animated: true },
    channels: {
      'FT': '1371469177860395039',
      'DRS': '803636640941342730'
    },
    channelLinks: {
      'FT': 'https://discord.com/channels/550702475112480769/1371469177860395039',
      'DRS': 'https://discord.com/channels/550702475112480769/803636640941342730'
    }
  },
  'Content Achievers': {
    guildId: '642628091205779466',
    acronym: 'CA',
    icon: 'https://i.imgur.com/vQGujLG.png',
    inviteLink: 'https://discord.gg/FJFxr2U',
    emoji: { name: 'contentachivers', prodId: '1461221434876756020', devId: '1462742585323028586' },
    channels: {
      'BA': '940148143310385182',
      'DRS': '1002244518743117924'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/642628091205779466/940148143310385182',
      'DRS': 'https://discord.com/channels/642628091205779466/1002244518743117924'
    }
  },
  'Dynamis Field Operations': {
    guildId: '1208039470486519818',
    acronym: 'DFO',
    icon: 'https://i.imgur.com/DLG3thV.png',
    inviteLink: 'https://discord.gg/vjwYEeubeN',
    emoji: { name: 'DFO', prodId: '1461221488123314438', devId: '1462742627358085281' },
    channels: {
      'BA': '1351065536041324637',
      'FT': '1208220062326984755',
      'DRS': '1208220062326984755'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/1208039470486519818/1208220062326984755',
      'FT': 'https://discord.com/channels/1208039470486519818/1208220062326984755',
      'DRS': 'https://discord.com/channels/1208039470486519818/1208220062326984755'
    }
  },
  'Field Op Enjoyers': {
    guildId: '1028110201968132116',
    acronym: 'FOE',
    icon: 'https://i.imgur.com/bDHWroZ.png',
    inviteLink: 'https://discord.gg/foexiv',
    emoji: { name: 'foe', prodId: '1461221556146409586', devId: '1462742710074212445' },
    channels: {
      'BA': '1029102392601497682',
      'FT': '1350184451979743362',
      'DRS': '1029102476156215307'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/1028110201968132116/1029102392601497682',
      'FT': 'https://discord.com/channels/1028110201968132116/1350184451979743362',
      'DRS': 'https://discord.com/channels/1028110201968132116/1029102476156215307'
    }
  },
  'Lego Steppers': {
    guildId: '818478021563908116',
    acronym: 'LS',
    icon: 'https://i.imgur.com/i2TAf3t.png',
    inviteLink: 'https://discord.gg/YKP76AsMw8',
    emoji: { name: 'lego', prodId: '1461226465709391975', devId: '1462742815296454656' },
    channels: {
      'DRS': '819233418579017738'
    },
    channelLinks: {
      'DRS': 'https://discord.com/channels/818478021563908116/819233418579017738'
    }
  },
    'Lost Freelancers\' Guild': {
    guildId: '1344508249642111047',
    acronym: 'LFG',
    icon: '',
    inviteLink: 'https://discord.gg/WjBhPSpKKq',
    emoji: { name: 'lfg', prodId: '1462752093332049973', devId: '1462742368733237309' },
    channels: {
      'FT': '1344512530411946064',
    },
    channelLinks: {
      'FT': 'https://discord.com/channels/1344508249642111047/1344512530411946064'
    }
  },
  'The Help Lines': {
    guildId: '578708223092326430',
    acronym: 'THL',
    icon: 'https://i.imgur.com/FLO7Kyw.png',
    inviteLink: 'https://discord.gg/thehelplines',
    emoji: { name: 'helplines', prodId: '1461221510390878309', devId: '1462742752537088151' },
    channels: {
      'BA': '958829775445721168',
      'FT': '1378164424254292030',
      'DRS': '1029196207278538842'
    },
    channelLinks: {
      'BA': 'https://discord.com/channels/578708223092326430/958829775445721168',
      'FT': 'https://discord.com/channels/578708223092326430/1378164424254292030',
      'DRS': 'https://discord.com/channels/578708223092326430/1029196207278538842'
    }
  },
};

async function getServerIcon(serverName, client = null) {
  if (client) {
    const guildId = HOST_SERVERS[serverName]?.guildId;
    const inviteLink = HOST_SERVERS[serverName]?.inviteLink;
    
    try {
      let guild = client.guilds.cache.get(guildId);
      if (!guild && guildId) {
        try {
          guild = await client.guilds.fetch(guildId);
        } catch (fetchError) {
        }
      }
      
      if (guild?.icon) {
        return guild.iconURL({ size: 256, extension: 'png' });
      }
      
      if (inviteLink) {
        const inviteCode = inviteLink.split('/').pop();
        const invite = await client.fetchInvite(inviteCode);
        if (invite.guild?.icon) {
          return invite.guild.iconURL({ size: 256, extension: 'png' });
        }
      }
    } catch (error) {
      logger.error('getServerIcon: Error fetching icon from Discord', {
        serverName,
        error: error.message
      });
    }
  }
  
  return HOST_SERVERS[serverName]?.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getInviteLink(serverName) {
  return HOST_SERVERS[serverName]?.inviteLink || '#';
}

function getChannelLink(serverName, raidType) {
  const link = HOST_SERVERS[serverName]?.channelLinks?.[raidType];
  return link ? `[${serverName}](${link})` : `**${serverName}**`;
}

function getAllHostServers() {
  return Object.keys(HOST_SERVERS);
}

function getHostServersForRaidType(raidType) {
  return Object.keys(HOST_SERVERS).filter(serverName => {
    const server = HOST_SERVERS[serverName];
    return server.channels && server.channels[raidType];
  });
}

function getServerEmoji(serverName) {
  const emojiConfig = HOST_SERVERS[serverName]?.emoji;
  if (!emojiConfig) return null;
  
  return {
    name: emojiConfig.name,
    id: IS_DEV_BOT ? emojiConfig.devId : emojiConfig.prodId,
    animated: emojiConfig.animated || false
  };
}

function getGuildId(serverName) {
  return HOST_SERVERS[serverName]?.guildId || null;
}

async function getGuildStats(serverName, client) {
  const guildId = getGuildId(serverName);
  
  if (!guildId || !client) {
    return null;
  }
  
  const inviteLink = HOST_SERVERS[serverName]?.inviteLink;
  if (!inviteLink) {
    return null;
  }
  
  try {
    let guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
      try {
        guild = await client.guilds.fetch(guildId);
      } catch (fetchError) {
      }
    }
    
    if (guild) {
      return {
        name: guild.name || null,
        createdAt: guild.createdAt || null,
        description: guild.description || HOST_SERVERS[serverName]?.description || null,
        memberCount: guild.memberCount,
        icon: guild.icon ? guild.iconURL({ size: 256, extension: 'png' }) : null,
        fromInvite: false
      };
    }
    
    const inviteCode = inviteLink.split('/').pop();
    const invite = await client.fetchInvite(inviteCode, { withCounts: true, withExpiration: true });
    
    if (!invite.guild) {
      logger.warn('getGuildStats: Invite has no guild data', { serverName, inviteCode });
      return null;
    }
    
    logger.debug('getGuildStats: Fetched from invite', {
      serverName,
      memberCount: invite.memberCount,
      onlineCount: invite.presenceCount,
      hasDescription: !!invite.guild.description,
      hasIcon: !!invite.guild.icon
    });
    
    return {
      name: invite.guild.name || null,
      createdAt: invite.guild.createdAt || null,
      description: invite.guild.description || HOST_SERVERS[serverName]?.description || null,
      memberCount: invite.memberCount || null,
      onlineCount: invite.presenceCount || null,
      icon: invite.guild.icon ? invite.guild.iconURL({ size: 256, extension: 'png' }) : null,
      fromInvite: true
    };
    
  } catch (error) {
    logger.error('getGuildStats: Error fetching stats', { 
      serverName, 
      guildId, 
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

function isWhitelistedHost(serverName) {
  return HOST_SERVERS.hasOwnProperty(serverName);
}

module.exports = {
  HOST_SERVERS,
  getServerIcon,
  getInviteLink,
  getChannelLink,
  getAllHostServers,
  getHostServersForRaidType,
  getServerEmoji,
  isWhitelistedHost,
  getGuildId,
  getGuildStats
};
