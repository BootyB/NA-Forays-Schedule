// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * CLI Tool: Manage Blacklisted Guilds
 * 
 * This script allows manual management of blacklisted guilds with encryption.
 * Use this after beta phase when switching from whitelist to blacklist model.
 * 
 * Usage:
 *   node scripts/manage-blacklist.js add <guild_id> <guild_name> <added_by> [reason]
 *   node scripts/manage-blacklist.js remove <guild_id>
 *   node scripts/manage-blacklist.js list
 */

require('dotenv').config();
const { encrypt, decrypt } = require('../utils/encryption');
const pool = require('../config/database');

async function addGuild(guildId, guildName, addedBy, reason = null) {
  try {
    await pool.query(
      `INSERT INTO na_bot_blacklisted_guilds (guild_id, guild_name, added_by, reason) 
       VALUES (?, ?, ?, ?)`,
      [encrypt(guildId), encrypt(guildName), encrypt(addedBy), reason]
    );
    
    console.log('✅ Guild added to blacklist:');
    console.log(`   Guild ID: ${guildId}`);
    console.log(`   Guild Name: ${guildName}`);
    console.log(`   Added By: ${addedBy}`);
    if (reason) {
      console.log(`   Reason: ${reason}`);
    }
  } catch (error) {
    console.error('❌ Error adding guild:', error.message);
    throw error;
  }
}

async function removeGuild(guildId) {
  try {
    const encryptedGuilds = await pool.query(
      'SELECT id, guild_id FROM na_bot_blacklisted_guilds WHERE is_active = 1'
    );
    
    const matchingGuild = encryptedGuilds.find(guild => {
      try {
        return decrypt(guild.guild_id) === guildId;
      } catch {
        return false;
      }
    });
    
    if (!matchingGuild) {
      console.log('⚠️ Guild not found in blacklist or already removed.');
      return;
    }
    
    await pool.query(
      'UPDATE na_bot_blacklisted_guilds SET is_active = 0 WHERE id = ?',
      [matchingGuild.id]
    );
    
    console.log('✅ Guild removed from blacklist:');
    console.log(`   Guild ID: ${guildId}`);
  } catch (error) {
    console.error('❌ Error removing guild:', error.message);
    throw error;
  }
}

async function listGuilds() {
  try {
    const encryptedGuilds = await pool.query(
      'SELECT * FROM na_bot_blacklisted_guilds WHERE is_active = 1'
    );
    
    if (encryptedGuilds.length === 0) {
      console.log('No blacklisted guilds found.');
      return;
    }
    
    const guilds = encryptedGuilds.map(guild => ({
      guild_id: decrypt(guild.guild_id),
      guild_name: guild.guild_name ? decrypt(guild.guild_name) : null,
      added_by: guild.added_by ? decrypt(guild.added_by) : null,
      reason: guild.reason,
      added_at: guild.added_at,
      is_active: guild.is_active
    }));
    
    console.log(`\n🚫 Blacklisted Guilds (${guilds.length}):\n`);
    console.log('─'.repeat(80));
    
    for (const guild of guilds) {
      console.log(`Guild: ${guild.guild_name || 'Unknown'}`);
      console.log(`  ID: ${guild.guild_id}`);
      console.log(`  Added By: ${guild.added_by || 'Unknown'}`);
      console.log(`  Added At: ${guild.added_at}`);
      if (guild.reason) {
        console.log(`  Reason: ${guild.reason}`);
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
  
  console.log('🔐 Blacklist Manager (Encrypted)\n');
  
  try {
    switch (command) {
      case 'add':
        if (args.length < 4) {
          console.error('Usage: node scripts/manage-blacklist.js add <guild_id> <guild_name> <added_by> [reason]');
          process.exit(1);
        }
        await addGuild(args[1], args[2], args[3], args[4]);
        break;
        
      case 'remove':
        if (args.length < 2) {
          console.error('Usage: node scripts/manage-blacklist.js remove <guild_id>');
          process.exit(1);
        }
        await removeGuild(args[1]);
        break;
        
      case 'list':
        await listGuilds();
        break;
        
      default:
        console.log('Available commands:');
        console.log('  add <guild_id> <guild_name> <added_by> [reason]  - Add a guild to blacklist');
        console.log('  remove <guild_id>                                 - Remove a guild from blacklist');
        console.log('  list                                              - List all blacklisted guilds');
        console.log('\nExamples:');
        console.log('  node scripts/manage-blacklist.js add 123456789 "Bad Server" "Admin" "ToS violation"');
        console.log('  node scripts/manage-blacklist.js remove 123456789');
        console.log('  node scripts/manage-blacklist.js list');
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
