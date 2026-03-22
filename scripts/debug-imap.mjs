import dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';

dotenv.config();

const client = new ImapFlow({
  host: '127.0.0.1',
  port: 1143,
  secure: false,
  auth: {
    user: process.env.PROTON_BRIDGE_USERNAME,
    pass: process.env.PROTON_BRIDGE_PASSWORD,
  },
  tls: { rejectUnauthorized: false },
  logger: {
    debug: (msg) => console.log('[DEBUG]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
    info: (msg) => console.log('[INFO]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
    warn: (msg) => console.log('[WARN]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
    error: (msg) => console.log('[ERROR]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  },
});

async function main() {
  console.log('--- Step 1: Connect ---');
  await client.connect();
  console.log('Connected! usable:', client.usable);

  console.log('\n--- Step 2: LIST (folders) ---');
  const folders = await client.list();
  console.log('Folders:', folders.length);

  console.log('\n--- Step 3: SELECT INBOX ---');
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    console.log('Mailbox locked. exists:', client.mailbox?.exists);
  } catch (err) {
    console.error('LOCK FAILED:', err.message);
    console.error('Full error:', err);
    await client.logout();
    return;
  }

  try {
    console.log('\n--- Step 4: SEARCH all ---');
    const uids = await client.search({ all: true }, { uid: true });
    console.log('UIDs found:', Array.isArray(uids) ? uids.length : uids);

    if (Array.isArray(uids) && uids.length > 0) {
      const last5 = uids.sort((a, b) => b - a).slice(0, 5);
      console.log('Last 5 UIDs:', last5);

      console.log('\n--- Step 5: FETCH envelopes (UID FETCH) ---');
      const range = last5.join(',');
      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true })) {
        console.log(`  UID ${msg.uid}: ${msg.envelope?.subject}`);
      }
    }
  } catch (err) {
    console.error('OPERATION FAILED:', err.message);
    console.error('Full error:', err);
  } finally {
    lock.release();
  }

  console.log('\n--- Step 6: Logout ---');
  await client.logout();
  console.log('Done!');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err);
});
