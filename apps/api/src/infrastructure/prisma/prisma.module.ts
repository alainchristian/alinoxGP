import { Global, Module } from '@nestjs/common';
import { PrismaService, SystemPrismaService, TenantPrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, SystemPrismaService, TenantPrismaService],
  exports: [PrismaService, SystemPrismaService, TenantPrismaService],
})
export class PrismaModule {}
