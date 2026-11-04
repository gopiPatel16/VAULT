import { Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Document } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { SearchQueryDto } from './dto/search.dto';
import { sanitizeFilename, ALLOWED_TYPES } from './mime-sniffer';
import {
  ClientRoute,
  Ctx,
  CurrentDocument,
  DocumentResource,
  RateLimit,
  RequiresDocumentGrant,
} from '../../common/decorators/route.decorators';
import type { VaultRequestContext } from '../../common/request-context';

/**
 * The client document surface.
 *
 * Metadata routes need Layer 1 only — browsing and searching titles is not the
 * same as reading contents. The two routes that emit actual bytes carry
 * `@RequiresDocumentGrant()`, which is what makes "logged in" insufficient.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ClientRoute()
  list(@Query() query: SearchQueryDto, @Ctx() ctx: VaultRequestContext) {
    return this.documents.search(ctx.client!.id, {
      ...query,
      favorites: query.favorites === 'true',
    });
  }

  @Get(':id')
  @ClientRoute()
  @DocumentResource()
  detail(@CurrentDocument() doc: Document, @Ctx() ctx: VaultRequestContext) {
    return this.documents.metadataFor(doc, ctx.client!.id);
  }

  @Post(':id/favorite')
  @ClientRoute()
  @DocumentResource()
  @HttpCode(204)
  async favorite(@CurrentDocument() doc: Document, @Ctx() ctx: VaultRequestContext) {
    await this.documents.addFavorite(ctx.client!.id, doc.id);
  }

  @Delete(':id/favorite')
  @ClientRoute()
  @DocumentResource()
  @HttpCode(204)
  async unfavorite(@CurrentDocument() doc: Document, @Ctx() ctx: VaultRequestContext) {
    await this.documents.removeFavorite(ctx.client!.id, doc.id);
  }

  // ── Layer 2 required beyond this point ────────────────────────────────────

  @Get(':id/preview')
  @RequiresDocumentGrant()
  @DocumentResource()
  @RateLimit({ name: 'doc-content', limit: 120, windowSeconds: 300, by: ['device'] })
  async preview(
    @CurrentDocument() doc: Document,
    @Ctx() ctx: VaultRequestContext,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.send(doc, ctx, reply, 'inline');
  }

  @Get(':id/content')
  @RequiresDocumentGrant()
  @DocumentResource()
  @RateLimit({ name: 'doc-content', limit: 120, windowSeconds: 300, by: ['device'] })
  async content(
    @CurrentDocument() doc: Document,
    @Ctx() ctx: VaultRequestContext,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.send(doc, ctx, reply, 'attachment');
  }

  private async send(
    doc: Document,
    ctx: VaultRequestContext,
    reply: FastifyReply,
    disposition: 'inline' | 'attachment',
  ): Promise<void> {
    const stream = await this.documents.openContentStream(doc);
    await this.documents.recordAccess(
      doc,
      ctx,
      disposition === 'inline' ? 'view' : 'download',
    );

    const ext = ALLOWED_TYPES[doc.mimeType as keyof typeof ALLOWED_TYPES] ?? 'bin';
    const safe = sanitizeFilename(doc.originalFilename, ext);
    const asciiName = safe.replace(/[^\x20-\x7E]/g, '_');

    void reply
      // The server-detected type, never anything the uploader claimed, and
      // never sniffed by the recipient.
      .header('Content-Type', doc.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `${disposition}; filename="${asciiName}"; ` +
          `filename*=UTF-8''${encodeURIComponent(safe)}`,
      )
      .header('Content-Length', String(doc.sizeBytes))
      // Document bytes must not sit in any intermediate cache, and the URL
      // must not travel to anywhere as a referrer.
      .header('Cache-Control', 'no-store, private')
      .header('Referrer-Policy', 'no-referrer')
      .send(stream);
  }
}

/** Categories are part of the client's browse surface, not a document itself. */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ClientRoute()
  list(@Ctx() ctx: VaultRequestContext) {
    return this.documents.categoriesFor(ctx.client!.id);
  }
}
