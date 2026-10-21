import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ActivateDeviceRequest, ActivateDeviceResponse, ErrorCode } from '@andishkadeh/shared';
import { ClientIp } from '../../common/auth';
import { AuditService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { IpRateLimiter } from '../../common/rate-limit';
import { ZodPipe } from '../../common/zod.pipe';
import { DevicesService } from './devices.service';

/**
 * Kiosk setup with a one-time activation code from the panel, instead of typing the kiosk id and
 * key: the kiosk has no key yet, so this is the one kiosk endpoint without device authentication.
 * Wrong codes are limited per address (8 digits, valid for half an hour).
 */
@Controller()
export class DeviceActivationController {
  private readonly failures = new IpRateLimiter(20, 10 * 60_000);

  constructor(
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('kiosk/activate')
  @HttpCode(200)
  async activate(@Body(new ZodPipe(ActivateDeviceRequest)) body: ActivateDeviceRequest, @ClientIp() ip: string | null): Promise<ActivateDeviceResponse> {
    const from = ip ?? 'unknown';
    if (this.failures.exceeded(from)) {
      throw new ApiError(ErrorCode.RATE_LIMITED, 'تعداد تلاش‌های نادرست زیاد است؛ چند دقیقه بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }
    const result = await this.devices.activate(body.code);
    if (!result) {
      this.failures.record(from);
      throw new ApiError(ErrorCode.INVALID_CREDENTIALS, 'کد فعال‌سازی نادرست است، یا مهلتش گذشته یا قبلاً استفاده شده؛ از پنل کد تازه بگیرید', HttpStatus.BAD_REQUEST);
    }
    await this.audit.log(this.prisma, null, { action: 'device.activated', entityType: 'Device', entityId: result.deviceId, ip });
    return result;
  }
}
