import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { AdminUser } from '@prisma/client';
import {
  AdminRole,
  AdminUserDto,
  ChangePasswordRequest,
  CreateUserRequest,
  ErrorCode,
  LoginRequest,
  LoginResponse,
  UpdateUserRequest,
} from '@andishkadeh/shared';
import { config } from '../config';
import { AdminAuth, AdminPrincipal, ClientIp, CurrentAdmin, signAdminToken } from '../common/auth';
import { AuditService } from '../common/core.services';
import { ApiError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

export function toUserDto(u: AdminUser): AdminUserDto {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Per-IP sliding window in addition to the per-account lock (blocks username spraying). */
class IpRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  hit(ip: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(ip, list);
    return list.length <= this.max;
  }
}

@Injectable()
export class AuthService {
  private readonly ipLimiter = new IpRateLimiter(30, 10 * 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginRequest, ip: string | null): Promise<LoginResponse> {
    if (ip && !this.ipLimiter.hit(ip)) {
      throw new ApiError(ErrorCode.RATE_LIMITED, 'تعداد تلاش‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }
    const { LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } = config();
    const user = await this.prisma.adminUser.findUnique({ where: { username: input.username.toLowerCase() } });
    const now = new Date();

    if (user?.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
      throw new ApiError(ErrorCode.ACCOUNT_LOCKED, `حساب به‌طور موقت قفل است؛ ${minutes} دقیقه دیگر تلاش کنید`, HttpStatus.LOCKED, {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.active) {
      if (user) {
        // Atomic increment: parallel wrong guesses must each count towards the lock.
        const counted = await this.prisma.adminUser.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (counted.failedLoginCount >= LOGIN_MAX_ATTEMPTS) {
          const locked = await this.prisma.adminUser.updateMany({
            where: { id: user.id, failedLoginCount: { gte: LOGIN_MAX_ATTEMPTS } },
            data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60000) },
          });
          if (locked.count > 0) {
            await this.audit.log(this.prisma, null, { action: 'auth.locked', entityType: 'AdminUser', entityId: user.id, ip });
          }
        }
      }
      throw new ApiError(ErrorCode.INVALID_CREDENTIALS, 'نام کاربری یا رمز عبور نادرست است', HttpStatus.UNAUTHORIZED);
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const client = input.client ?? 'panel';
    const { token, expiresAt } = signAdminToken(updated, client === 'kiosk' ? config().KIOSK_ADMIN_SESSION_MINUTES * 60 : undefined);
    await this.audit.log(this.prisma, { ...updated, tokenVersion: updated.tokenVersion }, {
      action: 'auth.login',
      entityType: 'AdminUser',
      entityId: user.id,
      ip,
      after: { client },
    });
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(updated) };
  }

  async changePassword(admin: AdminPrincipal, input: ChangePasswordRequest) {
    const user = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new ApiError(ErrorCode.INVALID_CREDENTIALS, 'رمز عبور فعلی نادرست است', HttpStatus.BAD_REQUEST);
    }
    const updated = await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(input.newPassword, 10), tokenVersion: { increment: 1 } },
    });
    await this.audit.log(this.prisma, admin, { action: 'auth.password_changed', entityType: 'AdminUser', entityId: user.id });
    return signAdminToken(updated);
  }
}

@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginRequest)) body: LoginRequest, @ClientIp() ip: string | null) {
    return this.auth.login(body, ip);
  }

  @Get('me')
  @AdminAuth()
  async me(@CurrentAdmin() admin: AdminPrincipal) {
    return toUserDto(await this.prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } }));
  }

  @Post('change-password')
  @HttpCode(200)
  @AdminAuth()
  async changePassword(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(ChangePasswordRequest)) body: ChangePasswordRequest) {
    const { token, expiresAt } = await this.auth.changePassword(admin, body);
    return { token, expiresAt: expiresAt.toISOString() };
  }
}

@Controller('admin/users')
@AdminAuth(AdminRole.ADMIN)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.adminUser.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] });
    return users.map(toUserDto);
  }

  @Post()
  async create(@CurrentAdmin() admin: AdminPrincipal, @Body(new ZodPipe(CreateUserRequest)) body: CreateUserRequest) {
    const exists = await this.prisma.adminUser.findUnique({ where: { username: body.username } });
    if (exists) throw ApiError.conflict(ErrorCode.CONFLICT, 'این نام کاربری قبلاً ثبت شده است');
    const user = await this.prisma.adminUser.create({
      data: {
        username: body.username,
        displayName: body.displayName,
        role: body.role,
        passwordHash: await bcrypt.hash(body.password, 10),
      },
    });
    await this.audit.log(this.prisma, admin, { action: 'user.created', entityType: 'AdminUser', entityId: user.id, after: toUserDto(user) });
    return toUserDto(user);
  }

  @Patch(':id')
  async update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateUserRequest)) body: UpdateUserRequest,
  ) {
    const before = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('کاربر');
    if (id === admin.id && (body.active === false || (body.role && body.role !== AdminRole.ADMIN))) {
      throw ApiError.conflict(ErrorCode.CONFLICT, 'امکان غیرفعال‌سازی یا تغییر نقش حساب خودتان وجود ندارد');
    }
    const demotingAdmin = before.role === AdminRole.ADMIN && (body.active === false || (body.role && body.role !== AdminRole.ADMIN));
    if (demotingAdmin) {
      const admins = await this.prisma.adminUser.count({ where: { role: AdminRole.ADMIN, active: true } });
      if (admins <= 1) throw ApiError.conflict(ErrorCode.CONFLICT, 'حداقل یک مدیر اصلی فعال باید باقی بماند');
    }
    const invalidate = body.password !== undefined || body.active === false || (body.role && body.role !== before.role);
    const user = await this.prisma.adminUser.update({
      where: { id },
      data: {
        displayName: body.displayName,
        role: body.role,
        active: body.active,
        passwordHash: body.password ? await bcrypt.hash(body.password, 10) : undefined,
        tokenVersion: invalidate ? { increment: 1 } : undefined,
        ...(body.unlock ? { lockedUntil: null, failedLoginCount: 0 } : {}),
      },
    });
    await this.audit.log(this.prisma, admin, {
      action: body.password ? 'user.password_reset' : 'user.updated',
      entityType: 'AdminUser',
      entityId: id,
      before: toUserDto(before),
      after: toUserDto(user),
    });
    return toUserDto(user);
  }
}

@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService],
})
export class AuthModule {}
