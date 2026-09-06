import 'dotenv/config';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient, Role} from '@prisma/client';
import {hash} from '@node-rs/argon2';

const adapter = new PrismaPg({connectionString: process.env.DATABASE_URL});
const prisma = new PrismaClient({adapter});

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';
  const passwordHash = await hash(password); // argon2id
  await prisma.user.upsert({
    where: {email},
    update: {},
    create: {email, passwordHash, role: Role.admin},
  });
  console.log(`Seeded admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
