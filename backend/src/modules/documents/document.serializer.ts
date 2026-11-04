import type { Category, Document, DocumentTag, Favorite, Tag } from '@prisma/client';

export type DocumentWithRelations = Document & {
  category: Category;
  tags: (DocumentTag & { tag: Tag })[];
  /** Present only on client-scoped queries, and already filtered to the
   *  requesting client — see `clientDocumentInclude`. */
  favorites?: Pick<Favorite, 'clientId'>[];
};

export interface DocumentMetadata {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  category: { slug: string; name: string };
  tags: string[];
  isFavourite: boolean;
  documentDate: string | null;
  uploadedAt: string;
  updatedAt: string;
}

/**
 * The only function that turns a database row into something a client sees.
 *
 * It builds a new object from named fields rather than copying the row and
 * deleting the sensitive ones. That direction matters: with an allowlist, a
 * column added to the schema later is invisible by default. With a denylist, a
 * new column leaks until somebody remembers to add it to the list — and
 * `storageKey`, `encDek` and `searchText` are exactly the kind of thing that
 * must never be one forgotten line away from the wire.
 */
export function toDocumentMetadata(doc: DocumentWithRelations): DocumentMetadata {
  return {
    id: doc.id,
    title: doc.title,
    filename: doc.originalFilename,
    fileType: doc.mimeType,
    sizeBytes: Number(doc.sizeBytes),
    category: { slug: doc.category.slug, name: doc.category.name },
    tags: doc.tags.map((t) => t.tag.name).sort(),
    // Absent on the administrator surface, where "whose favourite" has no
    // meaning; a client query always scopes it to the caller.
    isFavourite: (doc.favorites?.length ?? 0) > 0,
    documentDate: doc.documentDate ? doc.documentDate.toISOString().slice(0, 10) : null,
    uploadedAt: doc.uploadedAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Relations every document response needs. Administrator surface. */
export const DOCUMENT_RELATIONS = {
  category: true,
  tags: { include: { tag: true } },
} as const;

/**
 * Client-scoped relations.
 *
 * The favourites join is filtered to the requesting client in the query
 * itself, so a response can never carry another client's favourite as if it
 * were the caller's — and the row set never contains one to leak.
 */
export function clientDocumentInclude(clientId: string) {
  return {
    category: true,
    tags: { include: { tag: true } },
    favorites: { where: { clientId }, select: { clientId: true } },
  } as const;
}
