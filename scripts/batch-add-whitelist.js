// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CLI Tool: Batch Add Whitelisted Guilds
 * 
 * This script allows adding multiple guilds to the whitelist at once.
 * 
 * Usage:
 *   node scripts/batch-add-whitelist.js
 * 
 * Then enter guild data when prompted, one per line in format:
 *   guild_id guild_name added_by
 * 
 * Press Ctrl+D (or Ctrl+Z on Windows) when done.
 * 
 * Or pipe from a file:
 *   node scripts/batch-add-whitelist.js < guilds.txt
 * 
 * File format (space-separated):
 *   1234567890 "Server Name" AdminName
 *   9876543210 "Another Server" AdminName
 */

require('dotenv').config();
const encryptedDb = require('../config/encryptedDatabase');
const pool = require('../config/database');
const readline = require('readline');

function parseGuildLine(line) {
  
  const quotedMatch = line.match(/^(\S+)\s+"([^"]+)"\s+(\S+)$/);
  const unquotedMatch = line.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
  
  const match = quotedMatch || unquotedMatch;
  
  if (!match) {
    throw new Error(`Invalid format: ${line}`);
  }
  
  const parsed = {
    guildId: match[1].trim(),
    guildName: match[2].trim(),
    addedBy: match[3].trim()
  };
  
  if (!parsed.guildId || !parsed.guildName || !parsed.addedBy) {
    throw new Error(`Missing required fields: ${line}`);
  }
  
  return parsed;
}

async function batchAddGuilds(guilds) {
  console.log(`\n🔐 Adding ${guilds.length} guilds to whitelist...\n`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const guild of guilds) {
    try {
      if (!guild.guildId || !guild.guildName || !guild.addedBy) {
        throw new Error(`Missing required fields: ${JSON.stringify(guild)}`);
      }
      
      const guildId = String(guild.guildId);
      const guildName = String(guild.guildName);
      const addedBy = String(guild.addedBy);
      
      await encryptedDb.addWhitelistedGuild(guildId, guildName, addedBy);
      console.log(`✅ ${guildName} (${guildId})`);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed: ${guild.guildName} (${guild.guildId}) - ${error.message}`);
      failCount++;
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Successfully added: ${successCount}`);
  if (failCount > 0) {
    console.log(`❌ Failed: ${failCount}`);
  }
  console.log('─'.repeat(60));
}

async function main() {
  console.log('🔐 Batch Whitelist Manager (Encrypted)\n');
  console.log('Enter guilds in format: guild_id "guild_name" added_by');
  console.log('Press Ctrl+D (Unix) or Ctrl+Z (Windows) when done.\n');
  console.log('Example:');
  console.log('  1234567890 "My Server" AdminName');
  console.log('  9876543210 "Another Server" AdminName\n');
  console.log('─'.repeat(60));
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  const guilds = [];
  let lineNumber = 0;
  
  rl.on('line', (line) => {
    lineNumber++;
    line = line.trim();
    
    if (!line || line.startsWith('#')) {
      return;
    }
    
    try {
      const guild = parseGuildLine(line);
      guilds.push(guild);
      console.log(`📝 Parsed line ${lineNumber}: ${guild.guildName} (ID: ${guild.guildId})`);
    } catch (error) {
      console.error(`⚠️  Line ${lineNumber}: ${error.message}`);
    }
  });
  
  rl.on('close', async () => {
    if (guilds.length === 0) {
      console.log('\n⚠️  No valid guilds found.');
      await pool.end();
      process.exit(0);
    }
    
    try {
      await batchAddGuilds(guilds);
    } catch (error) {
      console.error('\n💥 Batch operation failed:', error.message);
      process.exit(1);
    } finally {
      await pool.end();
    }
  });
}

main();
