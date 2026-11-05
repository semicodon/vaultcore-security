import { Role } from '@prisma/client';
import { prisma } from '../db/prisma.js';

async function main() {
  const email = process.argv[2]?.toLowerCase();
  const targetRole = (process.argv[3]?.toUpperCase()) as string;

  // Validate email and role. If invalid, print usage with the correct format
  if (!email){
    console.error('Usage: npx tsx src/scripts/promote-admin.ts <email> [SECURITY_ADMIN|CREDIT_ANALYST|CUSTOMER]');
    process.exit(1);
  }
  // Validate role to only allow CUSTOMER, CREDIT_ANALYST, or SECURITY_ADMIN
  if (!['CUSTOMER', 'CREDIT_ANALYST', 'SECURITY_ADMIN'].includes(targetRole)) {
    console.error(`Invalid role: ${targetRole}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email } });
  if (!user) {
    console.error(`❌ User not found with email: ${email}`);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { role: (Role.SECURITY_ADMIN || Role.CREDIT_ANALYST) },
    select: {
      id: true,
      email: true,
      role: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId: updated.id,
      action: 'ROLE_PRIVILEGE_UPDATED_CLI',
      resourceId: updated.id,
      ipAddress: '127.0.0.1 (INTERNAL_CLI)',
      userAgent: 'vaultcore-cli/promote-admin',
      metadata: { previousRole: user.role, newRole: updated.role },
    },
  });

  console.log(`✅ Successfully updated ${updated.email} to role: ${updated.role}`);
  process.exit(0);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});