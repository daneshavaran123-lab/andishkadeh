import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateOrderRequest,
  ErrorCode,
  HeartbeatRequest,
  InitiatePaymentRequest,
  PaymentResultRequest,
  PaymentResultResponse,
  SyncEvent,
  SyncPullQuery,
  SyncPushResponse,
  ValidateAccessRequest,
} from '@andishkadeh/shared';
import { z } from 'zod';
import { CurrentDevice, DeviceAuth, DevicePrincipal, PublicWebApp } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { CatalogService } from '../catalog/catalog.service';
import { DevicesService } from './devices.service';
import { toOrderDto } from './mappers';
import { OrdersService } from './orders.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from './subscriptions.service';
import { SyncService } from './sync.service';

const LoosePush = z.object({ events: z.array(z.unknown()).min(1).max(200) });
const CommandResult = z.object({ success: z.boolean(), result: z.unknown().optional() });
const ActivateRequest = z.object({ orderId: z.string() });

/**
 * Endpoints used by kiosks (PRD §14). All require device authentication; the public web app at /
 * (no key) reaches only those marked PublicWebApp().
 */
@Controller()
@DeviceAuth()
export class KioskController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly sync: SyncService,
    private readonly devices: DevicesService,
  ) {}

  @Get('kiosk/bootstrap')
  @PublicWebApp()
  bootstrap() {
    return this.catalog.bootstrap();
  }

  @Post('orders')
  @HttpCode(200)
  createOrder(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(CreateOrderRequest)) body: CreateOrderRequest) {
    return this.orders.create(device.id, body);
  }

  /** Re-read a locked order (the lock already happened on creation; kept for the PRD contract). */
  @Post('orders/:id/checkout')
  @HttpCode(200)
  async checkout(@CurrentDevice() device: DevicePrincipal, @Param('id') id: string) {
    return toOrderDto(await this.orders.findForDevice(device.id, id));
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentDevice() device: DevicePrincipal, @Param('id') id: string) {
    return this.orders.cancel(device.id, id);
  }

  @Post('payments/initiate')
  @HttpCode(200)
  initiate(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(InitiatePaymentRequest)) body: InitiatePaymentRequest) {
    return this.payments.initiate(device.id, body);
  }

  @Get('payments/:id/status')
  status(@CurrentDevice() device: DevicePrincipal, @Param('id') id: string) {
    return this.payments.status(id, device.id);
  }

  @Post('payments/:id/result')
  @HttpCode(200)
  async result(
    @CurrentDevice() device: DevicePrincipal,
    @Param('id') id: string,
    @Body(new ZodPipe(PaymentResultRequest)) body: PaymentResultRequest,
  ): Promise<PaymentResultResponse> {
    const out = await this.payments.reportResult(device.id, id, { ...body, occurredAt: new Date(body.occurredAt) });
    return { paymentAttemptId: out.attempt.id, paymentStatus: out.attempt.status as PaymentResultResponse['paymentStatus'], order: out.order, conflict: out.conflict };
  }

  /** Activation happens automatically on PAID; this returns the (idempotent) result. */
  @Post('subscriptions/activate')
  @HttpCode(200)
  async activate(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(ActivateRequest)) body: { orderId: string }) {
    const order = await this.orders.findForDevice(device.id, body.orderId);
    return toOrderDto(order).subscription ?? null;
  }

  @Post('access/validate')
  @HttpCode(200)
  validate(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(ValidateAccessRequest)) body: ValidateAccessRequest) {
    return this.subscriptions.validate(device.id, body.token, { eventId: body.eventId });
  }

  @Post('sync/push')
  @HttpCode(200)
  async push(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(LoosePush)) body: { events: unknown[] }): Promise<SyncPushResponse> {
    // Validate events one by one so a single malformed event can not block the device queue.
    const valid: SyncEvent[] = [];
    const rejected: SyncPushResponse['rejectedEvents'] = [];
    for (const raw of body.events) {
      const parsed = SyncEvent.safeParse(raw);
      if (parsed.success) valid.push(parsed.data);
      else {
        const eventId = (raw as { eventId?: unknown })?.eventId;
        rejected.push({
          eventId: typeof eventId === 'string' ? eventId : 'unknown',
          code: ErrorCode.VALIDATION_FAILED,
          message: parsed.error.issues[0]?.message ?? 'invalid event',
          retryable: false,
        });
      }
    }
    const out = valid.length ? await this.sync.push(device.id, valid) : { acceptedEventIds: [], rejectedEvents: [], results: {} };
    return { ...out, rejectedEvents: [...rejected, ...out.rejectedEvents] };
  }

  @Get('sync/pull')
  @PublicWebApp()
  pull(@CurrentDevice() device: DevicePrincipal, @Query(new ZodPipe(SyncPullQuery)) q: { since: number; subSince: number }) {
    return device.publicWebApp ? this.sync.pullCatalog(q.since, q.subSince) : this.sync.pull(device.id, q.since, q.subSince);
  }

  @Post('devices/heartbeat')
  @HttpCode(200)
  @PublicWebApp()
  heartbeat(@CurrentDevice() device: DevicePrincipal, @Body(new ZodPipe(HeartbeatRequest)) body: HeartbeatRequest) {
    return device.publicWebApp ? this.devices.publicHeartbeat(device.id, body) : this.devices.heartbeat(device.id, body);
  }

  @Post('devices/commands/:id/result')
  @HttpCode(200)
  async commandResult(
    @CurrentDevice() device: DevicePrincipal,
    @Param('id') id: string,
    @Body(new ZodPipe(CommandResult)) body: { success: boolean; result?: unknown },
  ) {
    await this.devices.complete(device.id, id, body.success, body.result);
    return { ok: true };
  }
}
