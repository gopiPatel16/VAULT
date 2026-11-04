import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Document } from '@prisma/client';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.driver';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { documentAccessFilter } from './document-access';
import {
  DocumentMetadata,
  clientDocumentInclude,
  toDocumentMetadata,
} from './document.serializer';
import { AppError } from '../../common/errors/app-error';
import type { VaultRequestContext } from '../../common/request-context';
import { fromDbBytes } from '../../common/crypto/bytes';

export interface SearchParams {
  q?: string;
  category?: string;
  tags?: string[];
  fileType?: string;
  from?: string;
  to?: string;
  favorites?: boolean;
  page?: number;
  limit?: number;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeCryptoService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ── Metadata (Layer 1 only) ───────────────────────────────────────────────

  async search(
    clientId: string,
    params: SearchParams,
  ): Promise<{ items: DocumentMetadata[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));

    const where = {
      ...documentAccessFilter(clientId),
      ...(params.q ? { searchText: { contains: params.q, mode: 'insensitive' as const } } : {}),
      ...(params.category ? { category: { slug: params.category } } : {}),
      ...(params.fileType ? { mimeType: params.fileType } : {}),
      ...(params.tags?.length
        ? { tags: { some: { tag: { name: { in: params.tags } } } } }
        : {}),
      ...(params.favorites ? { favorites: { some: { clientId } } } : {}),
      ...(params.from || params.to
        ? {
            documentDate: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(params.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: clientDocumentInclude(clientId),
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items: rows.map(toDocumentMetadata), total, page, limit };
  }

  /** Categories the client can actually reach, with their document counts. */
  async categoriesFor(clientId: string) {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const counts = await this.prisma.document.groupBy({
      by: ['categoryId'],
      where: documentAccessFilter(clientId),
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.categoryId, c._count._all]));

    return categories
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        documentCount: byId.get(c.id) ?? 0,
      }))
      // An empty category still tells the client a category exists. Since
      // categories are a fixed vocabulary and not user data, showing only the
      // non-empty ones keeps the client's view honest about what it can reach.
      .filter((c) => c.documentCount > 0);
  }

  async metadataFor(document: Document, clientId: string): Promise<DocumentMetadata> {
    const full = await this.prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      include: clientDocumentInclude(clientId),
    });
    return toDocumentMetadata(full);
  }

  // ── Favourites ────────────────────────────────────────────────────────────

  async addFavorite(clientId: string, documentId: string): Promise<void> {
    await this.prisma.favorite.upsert({
      where: { clientId_documentId: { clientId, documentId } },
      create: { clientId, documentId },
      update: {},
    });
  }

  async removeFavorite(clientId: string, documentId: string): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { clientId, documentId } });
  }

  // ── Content (Layer 1 + Layer 2) ───────────────────────────────────────────

  /**
   * Decrypting read stream for an already-authorised document.
   *
   * Takes the row that `DocumentResourceGuard` resolved, so it cannot be
   * called with a document the caller was not cleared for — there is no
   * `getById` on this service for a handler to reach for instead.
   */
  async openContentStream(document: Document): Promise<Readable> {
    let dek: Buffer;
    try {
      dek = this.envelope.unwrapDek({
        wrapped: fromDbBytes(document.encDek),
        nonce: fromDbBytes(document.encDekNonce),
        tag: fromDbBytes(document.encDekTag),
      });
    } catch (err) {
      // Wrong KEK, or a tampered row. Either way the caller gets a 404 like
      // any other miss — a distinct error here would confirm the document is
      // real and merely broken.
      this.logger.error(`DEK unwrap failed for document ${document.id}`);
      throw AppError.notFound('dek unwrap failed', { documentId: document.id }, true);
    }

    let source: Readable;
    try {
      source = await this.storage.createReadStream(document.storageKey);
    } catch (err) {
      this.logger.error(`Storage open failed for document ${document.id}`);
      throw AppError.notFound('storage open failed', { documentId: document.id }, true);
    }

    const decrypt = this.envelope.createDecryptStream(dek);
    source.on('error', (e) => decrypt.destroy(e));
    return source.pipe(decrypt);
  }

  async recordAccess(
    document: Document,
    ctx: VaultRequestContext,
    kind: 'view' | 'download',
  ): Promise<void> {
    await this.audit.record({
      actorType: 'client',
      actorId: ctx.client!.id,
      deviceId: ctx.device!.id,
      event: kind === 'download' ? AuditEvent.DOCUMENT_DOWNLOADED : AuditEvent.DOCUMENT_VIEWED,
      targetType: 'document',
      targetId: document.id,
      result: 'success',
      ipHash: ctx.ipHash,
      // Titles are document data. The id is enough to correlate; the audit
      // reader can look the title up if they are entitled to.
      metadata: { fileType: document.mimeType },
    });
  }
}
