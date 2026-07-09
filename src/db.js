import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const dbConfig = {
  host: process.env.DB_HOST || '10.0.3.20',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Niken@dk271',
};

const dbName = process.env.DB_NAME || 'telegram_drive';

let pool = null;

export async function initDb() {
  try {
    // 1. Connect to the host directly to create the database if it doesn't exist
    const connection = await mysql.createConnection(dbConfig);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await connection.end();

    // 2. Establish connection pool with the specific database selected
    pool = mysql.createPool({
      ...dbConfig,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: 'Z'
    });

    // 3. Execute schema statements
    const schemaPath = path.resolve('schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Create a temporary connection with multipleStatements enabled to run the migration script
    const migrationConn = await mysql.createConnection({
      ...dbConfig,
      database: dbName,
      multipleStatements: true
    });

    try {
      await migrationConn.query(schemaSql);
      console.log('Database tables verified/created successfully.');
    } finally {
      await migrationConn.end();
    }

    // 4. Create default admin user if none exists
    await bootstrapAdminUser();

  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

async function bootstrapAdminUser() {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', ['admin']);
  if (rows.length === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'adminpass123';
    const passwordHash = await bcrypt.hash(adminPass, 10);
    const userId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
      [userId, 'admin', passwordHash]
    );
    console.log(`[BOOTSTRAP] Admin user created automatically. Username: admin | Password: ${adminPass}`);
  }
}

export function getPool() {
  if (!pool) {
    throw new Error('Database pool has not been initialized. Call initDb() first.');
  }
  return pool;
}
