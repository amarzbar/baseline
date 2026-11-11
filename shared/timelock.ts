// Time-lock encryption with tlock over drand's quicknet beacon (one round
// every 3 seconds, run by the League of Entropy). A ciphertext made for round
// N can't be opened by anyone, us included, until drand publishes round N.
import { Buffer, mainnetClient, roundAt, timelockDecrypt, timelockEncrypt } from 'tlock-js';

const client = mainnetClient();

export async function timeLock(secret: string, unlockAt: Date): Promise<{ round: number; ciphertext: string }> {
  const info = await client.chain().info();
  // roundAt gives the round in progress at that moment; take the next one so
  // the unlock never comes early.
  const round = roundAt(unlockAt.getTime(), info) + 1;
  const ciphertext = await timelockEncrypt(round, Buffer.from(secret, 'utf8'), client);
  return { round, ciphertext };
}

// The secret, or null while drand hasn't reached the round yet.
export async function timeUnlock(ciphertext: string): Promise<string | null> {
  try {
    return (await timelockDecrypt(ciphertext, client)).toString('utf8');
  } catch (err) {
    if (err instanceof Error && /too early/i.test(err.message)) return null;
    throw err;
  }
}
