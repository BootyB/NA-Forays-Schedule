// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CLI Tool: Manage Whitelisted Guilds
 * 
 * This script allows manual management of whitelisted guilds with encryption.
 * 
 * Usage:
 *   node scripts/manage-whitelist.js add <guild_id> <guild_name> <added_by>
 *   node scripts/manage-whitelist.js remove <guild_id>
 *   node scripts/manage-whitelist.js list
 */

require('dotenv').config();
const encryptedDb = require('../config/encryptedDatabase');
const pool = require('../config/database');

async function addGuild(guildId, guildName, addedBy) {
  try {
    await encryptedDb.addWhitelistedGuild(guildId, guildName, addedBy);
    console.log('✅ Guild added to whitelist:');
    console.log(`   Guild ID: ${guildId}`);
    console.log(`   Guild Name: ${guildName}`);
    console.log(`   Added By: ${addedBy}`);
  } catch (error) {
    console.error('❌ Error adding guild:', error.message);
    throw error;
  }
}

async function removeGuild(guildId) {
  try {
    await encryptedDb.removeWhitelistedGuild(guildId);
    console.log('✅ Guild removed from whitelist:');
    console.log(`   Guild ID: ${guildId}`);
  } catch (error) {
    console.error('❌ Error removing guild:', error.message);
    throw error;
  }
}

async function listGuilds() {
  try {
    const guilds = await encryptedDb.getAllWhitelistedGuilds();
    
    if (guilds.length === 0) {
      console.log('No whitelisted guilds found.');
      return;
    }
    
    console.log(`\n📋 Whitelisted Guilds (${guilds.length}):\n`);
    console.log('─'.repeat(80));
    
    for (const guild of guilds) {
      console.log(`Guild: ${guild.guild_name || 'Unknown'}`);
      console.log(`  ID: ${guild.guild_id}`);
      console.log(`  Added By: ${guild.added_by || 'Unknown'}`);
      console.log(`  Added At: ${guild.added_at}`);
      if (guild.notes) {
        console.log(`  Notes: ${guild.notes}`);
      }
      console.log('─'.repeat(80));
    }
  } catch (error) {
    console.error('❌ Error listing guilds:', error.message);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('🔐 Whitelist Manager (Encrypted)\n');
  
  try {
    switch (command) {
      case 'add':
        if (args.length < 4) {
          console.error('Usage: node scripts/manage-whitelist.js add <guild_id> <guild_name> <added_by>');
          process.exit(1);
        }
        await addGuild(args[1], args[2], args[3]);
        break;
        
      case 'remove':
        if (args.length < 2) {
          console.error('Usage: node scripts/manage-whitelist.js remove <guild_id>');
          process.exit(1);
        }
        await removeGuild(args[1]);
        break;
        
      case 'list':
        await listGuilds();
        break;
        
      default:
        console.log('Available commands:');
        console.log('  add <guild_id> <guild_name> <added_by>  - Add a guild to whitelist');
        console.log('  remove <guild_id>                        - Remove a guild from whitelist');
        console.log('  list                                     - List all whitelisted guilds');
        console.log('\nExamples:');
        console.log('  node scripts/manage-whitelist.js add 123456789 "My Server" "Admin Name"');
        console.log('  node scripts/manage-whitelist.js remove 123456789');
        console.log('  node scripts/manage-whitelist.js list');
        process.exit(0);
    }
    
  } catch (error) {
    console.error('\n💥 Operation failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
