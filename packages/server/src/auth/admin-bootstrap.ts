import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { UserRepo } from '../db/repositories/user.repo.js';
import { logStream } from '../services/log-stream.service.js';

export async function bootstrapAdmin(userRepo: UserRepo) {
  const userCount = await userRepo.count();
  if (userCount > 0) return;

  const password = randomBytes(12).toString('base64url');
  const hash = await bcrypt.hash(password, 12);

  await userRepo.create({
    username: 'admin',
    password_hash: hash,
    display_name: 'Administrator',
    role: 'admin',
  });

  logStream.info('='.repeat(60));
  logStream.info('  FIRST RUN - Admin credentials created');
  logStream.info(`  Username: admin`);
  logStream.info(`  Password: ${password}`);
  logStream.info('  Change the password after logging in via the Users page.');
  logStream.info('='.repeat(60));

  // Also print directly to stdout for visibility
  console.log('\n' + '='.repeat(60));
  console.log('  [SETUP] Admin credentials:');
  console.log(`  Username: admin`);
  console.log(`  Password: ${password}`);
  console.log('='.repeat(60) + '\n');
}
