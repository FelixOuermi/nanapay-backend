// Seed NanoPay.
//  - Toujours : referentiel villes / communes (necessaire a l'inscription et aux boutiques).
//  - Avec --demo : comptes de demonstration (Admin, Banque, Commercant valide + boutique et
//    produits, Client) pour que le frontend puisse etre branche immediatement.
//
// Usage :
//   npm run seed            # referentiel seul (a lancer aussi en staging / production)
//   npm run seed:demo       # referentiel + donnees de demonstration
//
// Les roles ADMIN et BANK n'ont pas d'inscription publique : ils sont provisionnes ici.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

const REFERENCE: Record<string, string[]> = {
  Ouagadougou: ["Baskuy", "Bogodogo", "Boulmiougou", "Nongr-Massom", "Sig-Noghin"],
  "Bobo-Dioulasso": ["Dafra", "Do", "Konsa"],
  Koudougou: ["Koudougou Centre"],
};

async function seedReference() {
  for (const [cityName, communes] of Object.entries(REFERENCE)) {
    const city = await prisma.city.upsert({ where: { name: cityName }, update: {}, create: { name: cityName } });
    for (const name of communes) {
      await prisma.commune.upsert({ where: { cityId_name: { cityId: city.id, name } }, update: {}, create: { cityId: city.id, name } });
    }
  }
  console.log(`Referentiel : ${Object.keys(REFERENCE).length} villes`);
}

async function seedDemo() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const city = await prisma.city.findUniqueOrThrow({ where: { name: "Ouagadougou" } });
  const commune = await prisma.commune.findFirstOrThrow({ where: { cityId: city.id, name: "Baskuy" } });

  await prisma.user.upsert({
    where: { email: "admin@nanopay.test" },
    update: {},
    create: { email: "admin@nanopay.test", passwordHash, role: "ADMIN" },
  });

  await prisma.user.upsert({
    where: { email: "banque@nanopay.test" },
    update: {},
    create: { email: "banque@nanopay.test", passwordHash, role: "BANK", bank: { create: { name: "Banque Partenaire Demo" } } },
  });

  const merchantUser = await prisma.user.upsert({
    where: { email: "commercant@nanopay.test" },
    update: {},
    create: {
      email: "commercant@nanopay.test",
      passwordHash,
      role: "MERCHANT",
      merchant: {
        create: {
          firstName: "Issa",
          lastName: "Ouedraogo",
          cnibRectoUrl: "demo-recto.jpg",
          cnibVersoUrl: "demo-verso.jpg",
          ifuRccmNumber: "IFU-DEMO-0001",
          orangeMoneyNumber: "70000001",
          corisMoneyNumber: "70000002",
          defaultPayoutChannel: "ORANGE_MONEY",
          status: "VALIDE",
        },
      },
    },
    include: { merchant: true },
  });

  const merchant = merchantUser.merchant!;
  const store = await prisma.store.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: { merchantId: merchant.id, name: "Boutique Demo", cityId: city.id, communeId: commune.id, addressDescription: "Avenue Kwame N'Krumah" },
  });

  const products = [
    { title: "Smartphone Android", price: 45_000, stock: 10 },
    { title: "Mixeur de cuisine", price: 75_000, stock: 5 },
    { title: "Television 43 pouces", price: 220_000, stock: 3 },
  ];
  for (const product of products) {
    const exists = await prisma.product.findFirst({ where: { storeId: store.id, title: product.title } });
    if (!exists) await prisma.product.create({ data: { storeId: store.id, ...product } });
  }

  await prisma.user.upsert({
    where: { email: "client@nanopay.test" },
    update: {},
    create: {
      email: "client@nanopay.test",
      passwordHash,
      role: "CLIENT",
      client: {
        create: {
          firstName: "Awa",
          lastName: "Traore",
          phoneNumber: "70000003",
          cnibRectoUrl: "demo-recto.jpg",
          cnibVersoUrl: "demo-verso.jpg",
          cityId: city.id,
          communeId: commune.id,
        },
      },
    },
  });

  console.log(`Demo (mot de passe commun : ${DEMO_PASSWORD}) :`);
  for (const email of ["admin", "banque", "commercant", "client"]) console.log(`  ${email}@nanopay.test`);
}

async function main() {
  await seedReference();
  if (process.argv.includes("--demo")) {
    await seedDemo();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
