// Cree (ou reutilise) un compte ADMIN et un compte BANQUE pour le developpement local.
// Ces deux roles n'ont pas d'endpoint d'inscription publique (cf. cahier des taches) :
// ils doivent etre provisionnes hors API, par exemple via ce script.
//
// Usage : npx ts-node -r tsconfig-paths/register prisma/seed-dev.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Password123!";

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@nanapay.test" },
    update: {},
    create: { email: "admin@nanapay.test", passwordHash, role: "ADMIN", isActive: true, accountStatus: "APPROVED" },
  });

  const bank = await prisma.user.upsert({
    where: { email: "banque@nanapay.test" },
    update: {},
    create: { email: "banque@nanapay.test", passwordHash, role: "BANQUE", isActive: true, accountStatus: "APPROVED" },
  });

  console.log(`Admin: admin@nanapay.test / ${DEV_PASSWORD} (id: ${admin.id})`);
  console.log(`Banque: banque@nanapay.test / ${DEV_PASSWORD} (id: ${bank.id})`);
}

main().finally(() => prisma.$disconnect());
