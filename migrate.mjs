import { createDatabase } from './database.mjs';

if (!process.env.DIRECT_DATABASE_URL) throw new Error('Set DIRECT_DATABASE_URL to the designated migration database.');
process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const db = await createDatabase({ migrate: true });
await db.close();
console.log('Additive schema applied.');
