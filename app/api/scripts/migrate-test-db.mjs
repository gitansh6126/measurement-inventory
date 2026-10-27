import { execSync } from 'child_process';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const testDbMatch = env.match(/TEST_DATABASE_URL="?([^\r\n"]+)"?/);
if (testDbMatch) {
  const url = testDbMatch[1];
  console.log('Migrating test db:', url);
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit'
  });
} else {
  console.log('No TEST_DATABASE_URL found in .env');
}
