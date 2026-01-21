// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { PermissionFlagsBits } = require('discord.js');

function canConfigureBot(member) {
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function isBotOwner(userId) {
  const ownerIds = process.env.BOT_OWNER_ID?.split(',') || [];
  return ownerIds.includes(userId);
}

function botHasPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  if (!permissions) return false;
  
  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(PermissionFlagsBits.SendMessages) &&
    permissions.has(PermissionFlagsBits.EmbedLinks)
  );
}

function getMissingPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  if (!permissions) return ['Access to channel'];
  
  const missing = [];
  const required = [
    { flag: PermissionFlagsBits.ViewChannel, name: 'View Channel' },
    { flag: PermissionFlagsBits.SendMessages, name: 'Send Messages' },
    { flag: PermissionFlagsBits.EmbedLinks, name: 'Embed Links' }
  ];
  
  for (const perm of required) {
    if (!permissions.has(perm.flag)) {
      missing.push(perm.name);
    }
  }
  
  return missing;
}

module.exports = {
  canConfigureBot,
  isBotOwner,
  botHasPermissions,
  getMissingPermissions
};
