import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/canonical_request.dart';

/// Cross-check against the backend.
///
/// These digests were produced by running the backend's own definition of the
/// canonical string (`SignatureService.canonicalString`) over the same inputs.
/// If either side's formatting drifts — a changed separator, a different
/// timestamp rendering, an added field — these fail, and they fail here rather
/// than as a mystifying 401 on every request in production.
void main() {
  String digestOf({
    required String method,
    required String path,
    required int timestampMs,
    required String nonce,
    required String body,
  }) {
    final canonical = buildCanonicalRequest(
      method: method,
      pathWithQuery: path,
      timestampMs: timestampMs,
      nonce: nonce,
      rawBody: body,
    );
    return sha256.convert(utf8.encode(canonical)).toString();
  }

  group('canonical request agrees with the backend', () {
    test('GET with no body', () {
      expect(
        digestOf(
          method: 'get',
          path: '/api/v1/documents',
          timestampMs: 1700000000000,
          nonce: 'abc123',
          body: '',
        ),
        '03182ed7c281e414d06aaf318d114bedc3eaf6af580867090a02d9e576a3e831',
      );
    });

    test('POST with a JSON body', () {
      expect(
        digestOf(
          method: 'post',
          path: '/api/v1/vault/unlock',
          timestampMs: 1712345678901,
          nonce: 'nOnCe-_1',
          body: '{"password":"hunter2"}',
        ),
        '0f94b2534e98982868ca7b78eafceba855fb50e61a76a8b0b730ecfeadc08ae1',
      );
    });

    test('GET with a query string', () {
      expect(
        digestOf(
          method: 'get',
          path: '/api/v1/documents?q=mca&page=1',
          timestampMs: 1699999999999,
          nonce: 'zz',
          body: '',
        ),
        '5ea478d7633a77c6744924c8bd857586ff856658f0d4729300f8fb4fcd4fb09f',
      );
    });
  });

  group('structure', () {
    test('is six newline-separated lines', () {
      final canonical = buildCanonicalRequest(
        method: 'get',
        pathWithQuery: '/api/v1/me',
        timestampMs: 1,
        nonce: 'n',
        rawBody: '',
      );
      expect(canonical.split('\n'), hasLength(6));
      expect(canonical.split('\n').first, 'v1');
    });

    test('uppercases the method, because the backend does', () {
      expect(
        buildCanonicalRequest(
          method: 'post',
          pathWithQuery: '/x',
          timestampMs: 1,
          nonce: 'n',
          rawBody: '',
        ),
        buildCanonicalRequest(
          method: 'POST',
          pathWithQuery: '/x',
          timestampMs: 1,
          nonce: 'n',
          rawBody: '',
        ),
      );
    });

    test('a different body produces a different string', () {
      final a = buildCanonicalRequest(
        method: 'post',
        pathWithQuery: '/x',
        timestampMs: 1,
        nonce: 'n',
        rawBody: '{"a":1}',
      );
      final b = buildCanonicalRequest(
        method: 'post',
        pathWithQuery: '/x',
        timestampMs: 1,
        nonce: 'n',
        rawBody: '{"a":2}',
      );
      expect(a, isNot(b));
    });
  });
}
