import { Controller, Get, Global, Module } from '@nestjs/common';
import { AuditService, CounterService, SettingsService } from './common/core.services';
import { AdminGuard, DeviceGuard } from './common/auth';
import { PrismaService } from './common/prisma.service';
import { AdminOpsController } from './modules/admin/admin-ops.controller';
import { ReportsController } from './modules/admin/reports.controller';
import { AuthModule } from './modules/auth.module';
import { AdminCatalogController } from './modules/catalog/admin-catalog.controller';
import { CatalogService } from './modules/catalog/catalog.service';
import { MediaController } from './modules/catalog/media.controller';
import { DevicesService } from './modules/sales/devices.service';
import { DeviceActivationController } from './modules/sales/device-activation.controller';
import { KioskController } from './modules/sales/kiosk.controller';
import { OrdersService } from './modules/sales/orders.service';
import { PaymentsService } from './modules/sales/payments.service';
import { SubscriptionsService } from './modules/sales/subscriptions.service';
import { SyncService } from './modules/sales/sync.service';
import { APP_VERSION } from './version';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, time: new Date().toISOString(), version: APP_VERSION };
  }
}

@Global()
@Module({
  providers: [PrismaService, CounterService, AuditService, SettingsService, AdminGuard, DeviceGuard],
  exports: [PrismaService, CounterService, AuditService, SettingsService, AdminGuard, DeviceGuard],
})
class CoreModule {}

@Module({
  imports: [CoreModule, AuthModule],
  controllers: [HealthController, KioskController, DeviceActivationController, AdminCatalogController, MediaController, AdminOpsController, ReportsController],
  providers: [CatalogService, OrdersService, PaymentsService, SubscriptionsService, SyncService, DevicesService],
})
export class AppModule {}
