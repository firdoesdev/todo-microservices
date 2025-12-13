
import { defineConfig } from 'prisma/config';
import type { PrismaConfig } from 'prisma';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
}) satisfies PrismaConfig;
