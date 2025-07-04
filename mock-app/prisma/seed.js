const { PrismaClient } = require('@prisma/client');
const { faker } = require('@faker-js/faker');
const prisma = new PrismaClient();

async function main() {
  for (let i = 0; i < 1000; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    await prisma.requester.create({
      data: {
      name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      gender: faker.helpers.arrayElement(['Male', 'Female']),
      // Use phone_num for landline, mobile for mobile number
      phone_num: faker.phone.number('###-###-####'), // Landline format
      mobile: faker.phone.number('09#########'),      // Mobile format (PH example)
      email_id: faker.internet.email().toLowerCase(),
      employee_id: `EMP-${faker.number.int({ min: 1000, max: 9999 })}`,
      job_title: faker.person.jobTitle(),
      description: faker.lorem.sentence(),
      },
    });
  }
  console.log('✅ 1000 fake requesters inserted!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
