import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import * as crypto from 'node:crypto';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppError } from './common/errors/app-error';
import { PublicErrorCode } from './common/errors/public-error-codes';
import { APP_CONFIG, AppConfig } from './config/configuration';
import { hashIp } from './common/crypto/hashing';

export const API_PREFIX = 'api/v1';

/**
 * Builds the application. Shared by `main.ts` and the test suite so that what
 * the tests exercise is the same wiring that runs in production — a test
 * harness that assembles the app differently proves very little about it.
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // No request logging: URLs carry document ids and search terms.
      logger: false,
      bodyLimit: 1024 * 1024,
      // Do not echo the caller's request id back as our own.
      requestIdHeader: false,
      genReqId: () => crypto.randomBytes(8).toString('hex'),
    }),
    // Nest's own JSON parser is disabled: we install one below that keeps the
    // raw bytes, which device signature verification depends on.
    { bufferLogs: false, bodyParser: false },
  );

  const config = app.get<AppConfig>(APP_CONFIG);
  const fastify = app.getHttpAdapter().getInstance();

  /**
   * Establish the per-request context before anything else runs.
   *
   * An `onRequest` hook rather than Nest middleware, because this must fire for
   * every request including ones that match no route — that is what lets an
   * unmatched path return a real request id instead of a placeholder, and it
   * removes any dependence on middleware path matching for a security-critical
   * invariant.
   *
   * `scope` is deliberately left unset: RouteScopeGuard is the only thing that
   * may assign it, and it refuses any route that failed to declare one.
   */
  fastify.addHook('onRequest', async (req) => {
    (req as unknown as { vault: unknown }).vault = {
      requestId: crypto.randomBytes(12).toString('base64url'),
      ipHash: hashIp(req.ip, config.ipHashSalt),
    };
  });

  /**
   * Capture the raw JSON body before parsing.
   *
   * Device signatures cover a hash of the exact bytes sent, so verification
   * cannot use a re-serialised object — key order and whitespace would differ
   * and every signature would fail.
   */
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: unknown, body: Buffer, done: (err: Error | null, result?: unknown) => void) => {
      (req as { rawBody?: Buffer }).rawBody = body;
      if (body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch {
        done(new AppError(PublicErrorCode.INVALID_REQUEST, 400, 'malformed json body'));
      }
    },
  );

  await app.register(fastifyMultipart as never, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 20,
      fieldSize: 4096,
    },
  });

  /**
   * Response headers.
   *
   * The API returns JSON and byte streams to a native client, so the strictest
   * possible CSP applies: nothing may be loaded, nothing may frame us. The
   * `Server` header is dropped here as well as at the proxy — defence in depth
   * against a misconfigured deployment that exposes the app directly.
   */
  fastify.addHook('onSend', async (_req, rawReply, payload: unknown) => {
    const reply = rawReply as unknown as FastifyReplyLike;
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    if (config.isProduction) {
      reply.header(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload',
      );
    }
    reply.removeHeader('X-Powered-By');
    reply.removeHeader('Server');
    return payload;
  });

  // Unmatched routes are handled by Nest's own not-found path, which raises a
  // NotFoundException and therefore flows through GlobalExceptionFilter like
  // every other error — one sanitiser, no second code path to keep in sync.

  app.setGlobalPrefix(API_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // The default factory returns per-field messages. Those describe the
      // caller's own schema and are harmless, but the response envelope is
      // fixed at { code, requestId } and the detail belongs in the server log.
      exceptionFactory: (errors) =>
        AppError.invalidRequest(
          `validation failed: ${errors.map((e) => e.property).join(', ')}`,
        ),
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // No CORS for the client API: the client is a native app and needs none.
  // The admin console is served from its own origin and is the only caller
  // that requires it.
  app.enableCors({
    origin: [config.adminOrigin],
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.enableShutdownHooks();
  return app;
}

export async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<AppConfig>(APP_CONFIG);

  await app.listen({ port: config.port, host: config.host });

  const logger = new Logger('Vault');
  logger.log(`API listening on ${config.host}:${config.port} (${config.nodeEnv})`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    logger.warn(
      'API is not bound to loopback. In production the reverse proxy should be ' +
        'the only public listener.',
    );
  }
}

/** Minimal structural type — avoids importing fastify types into this file. */
interface FastifyReplyLike {
  header(name: string, value: string): FastifyReplyLike;
  removeHeader(name: string): FastifyReplyLike;
  status(code: number): FastifyReplyLike;
  send(payload: unknown): unknown;
}
