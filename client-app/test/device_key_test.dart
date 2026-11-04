import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/device_key_store.dart';

/// The public key the client enrols must be byte-identical to what the backend
/// expects to parse. Getting this wrong fails at enrolment with a generic
/// error and is miserable to diagnose from either side, so it is pinned here.
void main() {
  group('P-256 SPKI assembly', () {
    final x = Uint8List.fromList(List<int>.generate(32, (i) => i));
    final y = Uint8List.fromList(List<int>.generate(32, (i) => 255 - i));

    test('produces the 91-byte encoding OpenSSL and Node produce', () {
      final spki = p256SpkiFromXy(x, y);
      expect(spki, hasLength(91));
    });

    test('carries the exact prefix for prime256v1', () {
      final spki = p256SpkiFromXy(x, y);
      final hex = spki
          .sublist(0, 27)
          .map((b) => b.toRadixString(16).padLeft(2, '0'))
          .join();

      // Verified against Node:
      //   publicKey.export({format: 'der', type: 'spki'}).subarray(0, 27)
      expect(hex, '3059301306072a8648ce3d020106082a8648ce3d03010703420004');
    });

    test('places the coordinates after the prefix', () {
      final spki = p256SpkiFromXy(x, y);
      expect(spki.sublist(27, 59), x);
      expect(spki.sublist(59, 91), y);
    });

    test('rejects coordinates that are not 32 bytes', () {
      expect(
        () => p256SpkiFromXy(Uint8List(31), y),
        throwsA(isA<ArgumentError>()),
      );
      expect(
        () => p256SpkiFromXy(x, Uint8List(33)),
        throwsA(isA<ArgumentError>()),
      );
    });
  });
}
