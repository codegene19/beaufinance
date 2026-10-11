/**
 * Creates a SEPARATE demo business (flagged is_demo) for an existing user.
 *   npm run db:seed-demo -- owner@example.com
 * Stop `npm run dev` first when using the embedded database (single-process file lock).
 */
import './env';
import { getDb } from '../src/lib/db';
import { seedDemoBusiness } from '../src/lib/services/demo';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run db:seed-demo -- <user email>');
  process.exit(1);
}
const db = await getDb();
const [u] = await db.query<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [email]);
if (!u) {
  console.error(`No user ${email}. Sign up in the app first.`);
  process.exit(1);
}
const id = await seedDemoBusiness(u.id);
console.log(`Demo business ${id} created for ${email}. Switch to it from the sidebar.`);
await db.close();
