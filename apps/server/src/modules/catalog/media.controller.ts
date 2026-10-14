import { Controller, Delete, Get, HttpStatus, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {} from 'multer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminRole, ErrorCode, MediaRow } from '@andishkadeh/shared';
import { config } from '../../config';
import { AdminAuth, AdminPrincipal, CurrentAdmin, Roles } from '../../common/auth';
import { AuditService, SettingsService } from '../../common/core.services';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { sniffImage } from '../../media/image-meta';
import { CatalogService, mediaUrl } from './catalog.service';

/** A05 — media library. Files are content addressed (sha256) so kiosks can verify downloads. */
@Controller('admin/media')
@AdminAuth()
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  private async usage(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const inc = (id: string | null) => id && counts.set(id, (counts.get(id) ?? 0) + 1);
    const [cats, subs, svcs, settings, content] = await Promise.all([
      this.prisma.category.findMany({ select: { mediaId: true } }),
      this.prisma.subcategory.findMany({ select: { mediaId: true } }),
      this.prisma.service.findMany({ where: { deletedAt: null }, select: { mediaId: true } }),
      this.settings.settings(),
      this.settings.content(),
    ]);
    [...cats, ...subs, ...svcs].forEach((r) => inc(r.mediaId));
    inc(settings.logoMediaId);
    inc(content.welcome.heroMediaId);
    return counts;
  }

  @Get()
  async list(): Promise<MediaRow[]> {
    const [rows, usage] = await Promise.all([this.prisma.media.findMany({ orderBy: { createdAt: 'desc' } }), this.usage()]);
    return rows.map((m) => ({
      id: m.id,
      url: mediaUrl(m),
      originalName: m.originalName,
      mime: m.mime,
      size: m.size,
      width: m.width,
      height: m.height,
      checksum: m.checksum,
      createdAt: m.createdAt.toISOString(),
      usage: usage.get(m.id) ?? 0,
    }));
  }

  @Post()
  @Roles(AdminRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Math.round(config().MEDIA_MAX_MB * 1024 * 1024), files: 1 } }))
  async upload(@CurrentAdmin() admin: AdminPrincipal, @UploadedFile() file?: Express.Multer.File): Promise<MediaRow> {
    if (!file?.buffer?.length) throw new ApiError(ErrorCode.VALIDATION_FAILED, 'فایلی ارسال نشده است');
    const meta = sniffImage(file.buffer);
    if (!meta) throw new ApiError(ErrorCode.VALIDATION_FAILED, 'فقط تصاویر JPEG، PNG یا WebP مجاز هستند', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    if (meta.width && meta.height && (meta.width > 8000 || meta.height > 8000)) {
      throw new ApiError(ErrorCode.VALIDATION_FAILED, 'ابعاد تصویر بیش از حد مجاز است');
    }
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.media.findUnique({ where: { checksum } });
    const storageKey = `${checksum}.${meta.ext}`;
    const dir = config().mediaDirAbs;
    mkdirSync(dir, { recursive: true });
    const target = join(dir, storageKey);
    if (!existsSync(target)) writeFileSync(target, file.buffer);

    const media =
      existing ??
      (await this.prisma.media.create({
        data: {
          storageKey,
          originalName: Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200),
          mime: meta.mime,
          size: file.size,
          checksum,
          width: meta.width,
          height: meta.height,
        },
      }));
    if (!existing) {
      await this.audit.log(this.prisma, admin, { action: 'media.uploaded', entityType: 'Media', entityId: media.id, after: { originalName: media.originalName, size: media.size } });
    }
    return {
      id: media.id,
      url: mediaUrl(media),
      originalName: media.originalName,
      mime: media.mime,
      size: media.size,
      width: media.width,
      height: media.height,
      checksum: media.checksum,
      createdAt: media.createdAt.toISOString(),
      usage: 0,
    };
  }

  @Delete(':id')
  @Roles(AdminRole.ADMIN)
  async remove(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw ApiError.notFound('تصویر');
    if ((await this.usage()).get(id)) {
      throw ApiError.conflict(ErrorCode.CONFLICT, 'این تصویر در حال استفاده است و قابل حذف نیست');
    }
    // The file itself is kept on disk: kiosks that have not synced yet may still reference it.
    await this.prisma.$transaction(async (tx) => {
      await tx.media.delete({ where: { id } });
      await this.audit.log(tx, admin, { action: 'media.deleted', entityType: 'Media', entityId: id, before: { originalName: media.originalName } });
      await this.catalog.bumpRevision(tx);
    });
    return { ok: true };
  }
}
