import { PrismaClient } from '@prisma/client';
import { seedReference } from './reference';

async function main() {
  const url = process.env['DATABASE_URL_SYSTEM'];
  if (!url) throw new Error('DATABASE_URL_SYSTEM is required to seed');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await seedReference(prisma);
    console.log('Reference data seeded.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
