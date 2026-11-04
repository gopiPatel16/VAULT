import { Injectable, Inject, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_DRIVER, StorageDriver } from '../storage/storage.driver';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { AuditService, AuditEvent } from '../audit/audit.service';
import { ALLOWED_TYPES, sanitizeFilename, sniffMime } from '../documents/mime-sniffer';
import {
  DOCUMENT_RELATIONS,
  DocumentMetadata,
  toDocumentMetadata,
} from '../documents/document.serializer';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import type { VaultRequestContext } from '../../common/request-context';
import { toDbBytes } from '../../common/crypto/bytes';

export interface UploadMetadata {
  title?: string;
  categorySlug?: string;
  tags?: string[];
  documentDate?: string;
}

export interface StagedUpload {
  tempPath: string;
  sizeBytes: number;
  sha256: Buffer;
}

const SNIFF_BYTES = 64 * 1024;

@Injectable()
export class AdminDocumentsService {
  private readonly logger = new Logger(AdminDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeCryptoService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Stage an incoming stream to a private temp file, enforcing the size cap as
   * the bytes arrive.
   *
   * Separated from `commit` because multipart fields may legitimately arrive
   * after the file part: the stream has to be consumed to reach them, so the
   * bytes land on disk first and the metadata is applied once the whole
   * request has been read.
   */
  async stage(source: Readable): Promise<StagedUpload> {
    const tempDir = path.join(this.config.storageRoot, 'tmp');
    await fsp.mkdir(tempDir, { recursive: true, mode: 0o700 });
    const tempPath = path.join(tempDir, `${crypto.randomUUID()}.part`);

    let sizeBytes = 0;
    const digest = crypto.createHash('sha256');
    let overLimit = false;

    try {
      const sink = fs.createWriteStream(tempPath, { mode: 0o600, flags: 'wx' });
      source.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length;
        digest.update(chunk);
        if (sizeBytes > this.config.maxUploadBytes) {
          // Abort mid-transfer rather than accepting the whole thing and
          // rejecting it afterwards.
          overLimit = true;
          source.destroy(new Error('upload exceeds size limit'));
        }
      });
      await pipeline(source, sink);
    } catch (err) {
      await fsp.unlink(tempPath).catch(() => undefined);
      if (overLimit) {
        throw AppError.payloadTooLarge('upload exceeds configured size limit', {
          sizeBytes,
        });
      }
      throw err;
    }

    if (overLimit || sizeBytes > this.config.maxUploadBytes) {
      await fsp.unlink(tempPath).catch(() => undefined);
      throw AppError.payloadTooLarge('upload exceeds configured size limit', { sizeBytes });
    }

    return { tempPath, sizeBytes, sha256: digest.digest() };
  }

  async discard(staged: StagedUpload): Promise<void> {
    await fsp.unlink(staged.tempPath).catch(() => undefined);
  }

  /**
   * The rest of the ingestion pipeline (ARCHITECTURE §7.1).
   *
   *   sniff the real type from magic bytes, discard the claimed one
   *   → reject anything outside the allowlist
   *   → generate a per-file key, encrypt, write under a random storage key
   *   → record metadata, delete the temp file
   *
   * The client-supplied filename is used only as a display label. It never
   * becomes a path component, which is why path traversal has nothing to
   * traverse: `../../etc/passwd` is stored as a title and the bytes land under
   * a server-generated UUID like everything else.
   */
  async commit(
    adminId: string,
    staged: StagedUpload,
    claimedFilename: string,
    meta: UploadMetadata,
    ctx: VaultRequestContext,
  ): Promise<DocumentMetadata> {
    const { tempPath, sizeBytes } = staged;

    try {
      if (sizeBytes === 0) {
        throw AppError.invalidRequest('empty upload');
      }

      const head = await this.readHead(tempPath);
      const mimeType = sniffMime(head);
      if (!mimeType) {
        // Whatever the extension said, the bytes are not one of the eight
        // formats this vault accepts.
        throw AppError.unsupportedMediaType('file type not in allowlist', {
          claimedFilename: claimedFilename.slice(0, 120),
          firstBytes: head.subarray(0, 8).toString('hex'),
        });
      }

      const category = await this.resolveCategory(meta.categorySlug);
      const filename = sanitizeFilename(claimedFilename, ALLOWED_TYPES[mimeType]);
      const title = (meta.title?.trim() || filename.replace(/\.[^.]+$/, '')).slice(0, 200);
      const tags = (meta.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);

      const dek = this.envelope.generateDek();
      const storageKey = this.storage.allocateKey();

      await pipeline(
        fs.createReadStream(tempPath),
        this.envelope.createEncryptStream(dek),
        await this.storage.createWriteStream(storageKey),
      );

      const wrapped = this.envelope.wrapDek(dek);
      dek.fill(0);

      const searchText = [title, filename, category.name, ...tags].join(' ').toLowerCase();

      const document = await this.prisma.document.create({
        data: {
          title,
          originalFilename: filename,
          mimeType,
          sizeBytes: BigInt(sizeBytes),
          sha256: toDbBytes(staged.sha256),
          categoryId: category.id,
          storageKey,
          encDek: toDbBytes(wrapped.wrapped),
          encDekNonce: toDbBytes(wrapped.nonce),
          encDekTag: toDbBytes(wrapped.tag),
          searchText,
          documentDate: meta.documentDate ? new Date(meta.documentDate) : null,
          uploadedBy: adminId,
          tags: {
            create: tags.map((name) => ({
              tag: {
                connectOrCreate: { where: { name }, create: { name } },
              },
            })),
          },
        },
        include: DOCUMENT_RELATIONS,
      });

      await this.audit.record({
        actorType: 'admin',
        actorId: adminId,
        event: AuditEvent.DOCUMENT_UPLOADED,
        targetType: 'document',
        targetId: document.id,
        result: 'success',
        ipHash: ctx.ipHash,
        metadata: { mimeType, sizeBytes },
      });

      return toDocumentMetadata(document);
    } finally {
      await fsp.unlink(tempPath).catch(() => undefined);
    }
  }

  private async readHead(filePath: string): Promise<Buffer> {
    const handle = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async resolveCategory(slug?: string) {
    const wanted = (slug ?? 'other').trim().toLowerCase();
    const category = await this.prisma.category.findUnique({ where: { slug: wanted } });
    if (!category) throw AppError.invalidRequest('unknown category', { slug: wanted });
    return category;
  }

  // ── Management ────────────────────────────────────────────────────────────

  async list(params: { q?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const where = {
      deletedAt: null,
      ...(params.q
        ? { searchText: { contains: params.q.toLowerCase(), mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: DOCUMENT_RELATIONS,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { items: rows.map(toDocumentMetadata), total, page, limit };
  }

  async update(
    adminId: string,
    documentId: string,
    patch: { title?: string; categorySlug?: string; tags?: string[]; documentDate?: string | null },
    ctx: VaultRequestContext,
  ): Promise<DocumentMetadata> {
    const existing = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: DOCUMENT_RELATIONS,
    });
    if (!existing) throw AppError.notFound('document not found', { documentId });

    const category = patch.categorySlug
      ? await this.resolveCategory(patch.categorySlug)
      : existing.category;
    const title = patch.title?.trim().slice(0, 200) ?? existing.title;
    const tags =
      patch.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20) ??
      existing.tags.map((t) => t.tag.name);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (patch.tags) {
        await tx.documentTag.deleteMany({ where: { documentId } });
      }
      return tx.document.update({
        where: { id: documentId },
        data: {
          title,
          categoryId: category.id,
          searchText: [title, existing.originalFilename, category.name, ...tags]
            .join(' ')
            .toLowerCase(),
          ...(patch.documentDate !== undefined
            ? { documentDate: patch.documentDate ? new Date(patch.documentDate) : null }
            : {}),
          ...(patch.tags
            ? {
                tags: {
                  create: tags.map((name) => ({
                    tag: { connectOrCreate: { where: { name }, create: { name } } },
                  })),
                },
              }
            : {}),
        },
        include: DOCUMENT_RELATIONS,
      });
    });

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DOCUMENT_UPDATED,
      targetType: 'document',
      targetId: documentId,
      result: 'success',
      ipHash: ctx.ipHash,
    });

    return toDocumentMetadata(updated);
  }

  /**
   * Delete the row and the bytes.
   *
   * The row is soft-deleted first so it disappears from every client query
   * immediately, then the blob is removed. If the blob removal fails the
   * document is already unreachable — the reverse order would leave a window
   * where a client could still resolve a document whose bytes were gone.
   */
  async delete(adminId: string, documentId: string, ctx: VaultRequestContext): Promise<void> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!doc) throw AppError.notFound('document not found', { documentId });

    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    try {
      await this.storage.delete(doc.storageKey);
      await this.prisma.document.delete({ where: { id: documentId } });
    } catch (err) {
      this.logger.error(
        `Blob removal failed for ${documentId}; row remains soft-deleted: ${(err as Error).message}`,
      );
    }

    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      event: AuditEvent.DOCUMENT_DELETED,
      targetType: 'document',
      targetId: documentId,
      result: 'success',
      ipHash: ctx.ipHash,
    });
  }
}
