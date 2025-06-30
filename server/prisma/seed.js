const { PrismaClient } = require('@prisma/client');
const { faker } = require('@faker-js/faker');
const prisma = new PrismaClient();

async function main() {
  for (let i = 0; i < 10; i++) {
    await prisma.requester.create({
      data: {
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
        phone_num: faker.phone.number(),
        email_id: faker.internet.email(),
      },
    });
  }
  console.log('✅ 10 fake requesters inserted!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });