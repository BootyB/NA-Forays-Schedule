// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const postgres = require('postgres');
const dns = require('dns');
require('dotenv').config();

dns.setDefaultResultOrder('ipv4first');

let sql;

if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  });
} else {
  sql = postgres({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? 'require' : false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10
  });
}

sql`SELECT 1`
  .then(() => {
    console.log('✅ Database connection established');
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    if (process.env.DATABASE_URL) {
      const urlWithoutPassword = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
      console.error('   Connection URL:', urlWithoutPassword);
    } else {
      console.error('   Host:', process.env.DB_HOST);
      console.error('   Port:', process.env.DB_PORT);
      console.error('   Database:', process.env.DB_NAME);
    }
    console.error('   Error code:', err.code);
    process.exit(1);
  });

module.exports = sql;
