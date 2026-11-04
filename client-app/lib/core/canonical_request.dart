import 'dart:convert';
import 'package:crypto/crypto.dart';

/// Builds the string the backend rebuilds and verifies in `SignatureService`.
///
/// The two must agree byte for byte or every request fails, so this is kept in
/// one function with no formatting choices left to callers, and it is covered
/// by `test/canonical_request_test.dart` using vectors taken from the backend's
/// own definition.
///
///   v1
///   <HTTP METHOD, uppercase>
///   <path with query string, exactly as sent>
///   <unix milliseconds>
///   <nonce>
///   <lowercase hex sha256 of the raw request body>
///
/// Note "exactly as sent": the body is hashed as the bytes that go on the
/// wire, never as a re-encoded object. Re-serialising would reorder keys and
/// invalidate the signature.
String buildCanonicalRequest({
  required String method,
  required String pathWithQuery,
  required int timestampMs,
  required String nonce,
  required String rawBody,
}) {
  final bodyHash = sha256.convert(utf8.encode(rawBody)).toString();
  return [
    'v1',
    method.toUpperCase(),
    pathWithQuery,
    '$timestampMs',
    nonce,
    bodyHash,
  ].join('\n');
}
