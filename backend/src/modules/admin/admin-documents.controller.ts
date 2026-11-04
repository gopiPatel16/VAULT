import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminDocumentsService, StagedUpload, UploadMetadata } from './admin-documents.service';
import { UpdateDocumentDto } from './dto/admin.dto';
import {
  AdminRoute,
  Ctx,
  RequiresStepUp,
} from '../../common/decorators/route.decorators';
import { AppError } from '../../common/errors/app-error';
import type { VaultRequestContext } from '../../common/request-context';

/**
 * Document ingestion is administrator-only in the MVP.
 *
 * §25 asks what to do "if clients are allowed to upload" — they are not. Untrusted
 * file upload is the single largest attack surface in an application like this,
 * and removing it costs nothing against the stated MVP. The validation pipeline
 * below is built as though the input were hostile anyway, so opening it to
 * clients later is a routing change rather than a rewrite.
 */
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly documents: AdminDocumentsService) {}

  @Get()
  @AdminRoute()
  list(@Query('q') q?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.documents.list({
      q,
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Post('upload')
  @AdminRoute()
  @HttpCode(201)
  async upload(@Req() req: FastifyRequest, @Ctx() ctx: VaultRequestContext) {
    if (!req.isMultipart()) {
      throw AppError.unsupportedMediaType('upload must be multipart/form-data');
    }

    const fields: Record<string, string> = {};
    let staged: StagedUpload | null = null;
    let claimedFilename = 'document';

    try {
      // The whole request is walked so that fields sent after the file part are
      // still picked up. The file lands on disk as it streams; nothing is held
      // in memory.
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (staged) {
            throw AppError.invalidRequest('only one file per upload');
          }
          claimedFilename = part.filename || 'document';
          staged = await this.documents.stage(part.file);
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value.slice(0, 2000);
        }
      }

      if (!staged) {
        throw AppError.invalidRequest('no file part in upload');
      }

      const meta: UploadMetadata = {
        title: fields.title,
        categorySlug: fields.category ?? fields.categorySlug,
        tags: fields.tags?.split(',').map((t) => t.trim()).filter(Boolean),
        documentDate: fields.documentDate,
      };

      const result = await this.documents.commit(
        ctx.admin!.id,
        staged,
        claimedFilename,
        meta,
        ctx,
      );
      staged = null;
      return result;
    } finally {
      // Any failure after staging must not leave a plaintext temp file behind.
      if (staged) await this.documents.discard(staged);
    }
  }

  @Patch(':id')
  @AdminRoute()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @Ctx() ctx: VaultRequestContext,
  ) {
    return this.documents.update(ctx.admin!.id, id, dto, ctx);
  }

  @Delete(':id')
  @AdminRoute()
  @RequiresStepUp()
  @HttpCode(204)
  async remove(@Param('id') id: string, @Ctx() ctx: VaultRequestContext): Promise<void> {
    await this.documents.delete(ctx.admin!.id, id, ctx);
  }
}
