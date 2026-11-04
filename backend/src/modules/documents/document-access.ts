import type { Prisma } from '@prisma/client';

/**
 * The single definition of "may this client see this document".
 *
 * Deny by default: a document is visible only if the administrator granted the
 * client access to it directly, or to its category. Every list, search, detail,
 * preview and download path composes this same filter, so there is one place to
 * audit and no possibility of one endpoint being more permissive than another.
 */
export function documentAccessFilter(clientId: string): Prisma.DocumentWhereInput {
  return {
    deletedAt: null,
    OR: [
      { clientAccess: { some: { clientId } } },
      { category: { clientAccess: { some: { clientId } } } },
    ],
  };
}
