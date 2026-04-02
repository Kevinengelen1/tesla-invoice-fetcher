import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
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

  const credentialsDir = path.resolve(process.cwd(), 'data');
  const credentialsPath = path.join(credentialsDir, 'bootstrap-admin-credentials.txt');
  const credentialsContent = [
    'FIRST RUN - Admin credentials created',
    'Username: admin',
    `Password: ${password}`,
    'Change the password after logging in via the Users page.',
    '',
  ].join('\n');

  await mkdir(credentialsDir, { recursive: true });
  await writeFile(credentialsPath, credentialsContent, { encoding: 'utf-8', mode: 0o600 });

  logStream.info('='.repeat(60));
  logStream.info('  FIRST RUN - Admin credentials created');
  logStream.info(`  Username: admin`);
  logStream.info(`  Credentials file: ${credentialsPath}`);
  logStream.info('  Change the password after logging in via the Users page.');
  logStream.info('='.repeat(60));
}
