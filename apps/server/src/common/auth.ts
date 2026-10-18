import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { AdminRole, SessionUser } from '@andishkadeh/shared';
import { config } from '../config';
import { ApiError } from './errors';
import { PrismaService } from './prisma.service';

export interface AdminPrincipal extends SessionUser {
  tokenVersion: number;
}

export interface DevicePrincipal {
  id: string;
  name: string;
}

export type AuthedRequest = Request & {
  requestId?: string;
  admin?: AdminPrincipal;
  device?: DevicePrincipal;
};

interface TokenClaims {
  sub: string;
  ver: number;
  role: AdminRole;
}

/** Signs a panel session; `seconds` defaults to ADMIN_SESSION_HOURS (kiosk logins are shorter). */
export function signAdminToken(user: { id: string; tokenVersion: number; role: AdminRole }, seconds = config().ADMIN_SESSION_HOURS * 3600) {
  const expiresAt = new Date(Date.now() + Math.round(seconds) * 1000);
  const token = jwt.sign({ sub: user.id, ver: user.tokenVersion, role: user.role } satisfies TokenClaims, config().JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: Math.round(seconds),
    issuer: 'andishkadeh',
    audience: 'admin',
  });
  return { token, expiresAt };
}

const ROLES_KEY = 'roles';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthenticated();

    let claims: TokenClaims;
    try {
      claims = jwt.verify(token, config().JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'andishkadeh',
        audience: 'admin',
      }) as unknown as TokenClaims;
    } catch {
      throw ApiError.unauthenticated('نشست منقضی شده است؛ دوباره وارد شوید');
    }

    // Role and status are always re-read from the database: RBAC is enforced server-side,
    // and deactivated users / changed passwords invalidate tokens immediately.
    const user = await this.prisma.adminUser.findUnique({ where: { id: claims.sub } });
    if (!user || !user.active || user.tokenVersion !== claims.ver) {
      throw ApiError.unauthenticated('نشست معتبر نیست؛ دوباره وارد شوید');
    }

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && roles.length > 0 && !roles.includes(user.role)) {
      throw ApiError.forbidden();
    }

    req.admin = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    return true;
  }
}

/** Any authenticated panel user; pass roles to restrict (e.g. AdminAuth('ADMIN')). */
export function AdminAuth(...roles: AdminRole[]) {
  return applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(AdminGuard));
}

/** Method-level role override on top of a class-level AdminAuth(). */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    let id = req.header('x-device-id');
    let key = req.header('x-device-key');
    const auth = req.header('authorization');
    if ((!id || !key) && auth?.startsWith('Device ')) {
      const raw = auth.slice(7);
      const idx = raw.indexOf(':');
      if (idx > 0) {
        id = raw.slice(0, idx);
        key = raw.slice(idx + 1);
      }
    }
    if (!id || !key) throw ApiError.unauthenticated('احراز هویت دستگاه لازم است');

    const device = await this.prisma.device.findUnique({ where: { id } });
    const expected = device ? Buffer.from(device.apiKeyHash, 'hex') : Buffer.alloc(32);
    const actual = Buffer.from(hashDeviceKey(key), 'hex');
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!device || !ok || !device.active) throw ApiError.unauthenticated('دستگاه معتبر نیست');

    req.device = { id: device.id, name: device.name };
    return true;
  }
}

export const DeviceAuth = () => UseGuards(DeviceGuard);

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminPrincipal => {
  const admin = ctx.switchToHttp().getRequest<AuthedRequest>().admin;
  if (!admin) throw ApiError.unauthenticated();
  return admin;
});

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext): DevicePrincipal => {
  const device = ctx.switchToHttp().getRequest<AuthedRequest>().device;
  if (!device) throw ApiError.unauthenticated();
  return device;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip ?? null;
});
