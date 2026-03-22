import { prisma } from "@/lib/prisma";
import { seedSampleData } from "@/lib/seed";

async function main() {
  await seedSampleData(prisma, "manual-seed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
