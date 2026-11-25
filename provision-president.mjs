import { closeDatabase, provisionPresident } from './server.mjs';

try {
  const subject = process.argv[2];
  if (!subject || !/^[a-zA-Z0-9_-]{1,255}$/.test(subject)) {
    throw new Error('Pass the verified Google subject of the existing member.');
  }
  await provisionPresident(subject);
  console.log('President provisioned.');
} catch (error) {
  console.error(error.status ? error.message : 'President provisioning failed. Verify the destination and member subject.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
