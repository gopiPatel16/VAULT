import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/export.dart';

/// The device's signing identity.
///
/// Requests are signed with this key in addition to carrying a bearer token,
/// so a token copied out of local storage is not by itself a usable
/// credential. That is the §31 threat "attacker modifies local client storage".
///
/// ── On hardware backing ─────────────────────────────────────────────────────
///
/// The curve is P-256 specifically because Apple's Secure Enclave and Android's
/// StrongBox can hold P-256 keys and cannot hold Ed25519 ones. The wire format
/// is therefore already correct for a hardware-backed key.
///
/// What ships here is [SoftwareDeviceKeyStore]: the private key is generated in
/// Dart and kept in Keychain / Android Keystore-backed secure storage. That
/// protects it at rest, but it is loadable into process memory and so
/// extractable on a rooted or jailbroken device.
///
/// [DeviceKeyStore] exists as an interface so that a platform channel to
/// `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`, and to
/// `KeyGenParameterSpec` with `setIsStrongBoxBacked`, can be dropped in as a
/// second implementation. Because the protocol already speaks P-256 SPKI and
/// P1363/DER signatures, adopting it is a re-enrolment, not a protocol change.
abstract class DeviceKeyStore {
  /// Creates a key if none exists. Returns the public key as base64 SPKI DER,
  /// which is what enrolment sends and what the backend stores.
  Future<String> ensureKeyPair();

  /// Signs the canonical request string. Returns raw r‖s (IEEE P1363), which
  /// the backend accepts alongside DER.
  Future<Uint8List> sign(String canonical);

  /// Whether the private key lives in secure hardware. Surfaced in Settings so
  /// the operator can tell at a glance, rather than assuming.
  bool get isHardwareBacked;

  Future<void> destroy();
}

/// SPKI DER prefix for an uncompressed P-256 public key.
///
/// SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING { 0x04 x y } }
///
/// Fixed for this curve and encoding. The trailing 0x04 is the uncompressed-
/// point marker, so the complete key is these 27 bytes followed by the 32-byte
/// x and 32-byte y coordinates: 91 bytes, byte-identical to what
/// `crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'})` exports on
/// the backend. `test/device_key_test.dart` pins that.
const List<int> _p256SpkiPrefix = [
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, //
  0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
  0x42, 0x00, 0x04,
];

/// Assembles the SPKI DER encoding the backend expects from a raw public point.
Uint8List p256SpkiFromXy(List<int> x, List<int> y) {
  if (x.length != 32 || y.length != 32) {
    throw ArgumentError('P-256 coordinates must be 32 bytes each');
  }
  return Uint8List.fromList([..._p256SpkiPrefix, ...x, ...y]);
}

/// Big-endian, fixed width, left-padded.
///
/// ECDSA components and curve coordinates are fixed-width on the wire; writing
/// a 31-byte `r` because it happened to have a leading zero produces a
/// signature that silently fails to verify roughly one time in 256.
Uint8List bigIntToFixedBytes(BigInt value, int length) {
  if (value.isNegative) throw ArgumentError('value must be non-negative');
  final out = Uint8List(length);
  var v = value;
  for (var i = length - 1; i >= 0; i--) {
    out[i] = (v & BigInt.from(0xff)).toInt();
    v = v >> 8;
  }
  if (v != BigInt.zero) {
    throw ArgumentError('value does not fit in $length bytes');
  }
  return out;
}

BigInt _bytesToBigInt(List<int> bytes) {
  var result = BigInt.zero;
  for (final b in bytes) {
    result = (result << 8) | BigInt.from(b);
  }
  return result;
}

class SoftwareDeviceKeyStore implements DeviceKeyStore {
  SoftwareDeviceKeyStore(this._storage);

  static const _privateKeyKey = 'vault.device.d';
  static const _publicKeyKey = 'vault.device.spki';

  final FlutterSecureStorage _storage;
  final ECDomainParameters _domain = ECDomainParameters('prime256v1');

  ECPrivateKey? _cachedPrivate;

  @override
  bool get isHardwareBacked => false;

  /// Fortuna seeded from the platform CSPRNG.
  ///
  /// `Random.secure()` is the OS entropy source; Fortuna is only the expansion
  /// function PointyCastle's key generator expects. The seed is never derived
  /// from anything predictable.
  SecureRandom _secureRandom() {
    final random = FortunaRandom();
    final seed = Uint8List.fromList(
      List<int>.generate(32, (_) => Random.secure().nextInt(256)),
    );
    random.seed(KeyParameter(seed));
    return random;
  }

  @override
  Future<String> ensureKeyPair() async {
    final existing = await _storage.read(key: _publicKeyKey);
    if (existing != null && await _storage.read(key: _privateKeyKey) != null) {
      return existing;
    }

    final generator = ECKeyGenerator()
      ..init(
        ParametersWithRandom(
          ECKeyGeneratorParameters(_domain),
          _secureRandom(),
        ),
      );

    final pair = generator.generateKeyPair();
    final private = pair.privateKey as ECPrivateKey;
    final public = pair.publicKey as ECPublicKey;

    final q = public.Q!;
    final spki = p256SpkiFromXy(
      bigIntToFixedBytes(q.x!.toBigInteger()!, 32),
      bigIntToFixedBytes(q.y!.toBigInteger()!, 32),
    );

    // Written together so a crash between the two cannot leave a public key
    // enrolled against a private key that no longer exists.
    await _storage.write(
      key: _privateKeyKey,
      value: base64Encode(bigIntToFixedBytes(private.d!, 32)),
    );
    await _storage.write(key: _publicKeyKey, value: base64Encode(spki));

    _cachedPrivate = private;
    return base64Encode(spki);
  }

  Future<ECPrivateKey> _privateKey() async {
    final cached = _cachedPrivate;
    if (cached != null) return cached;

    final d = await _storage.read(key: _privateKeyKey);
    if (d == null) {
      throw StateError('device key missing; re-enrolment required');
    }

    final key = ECPrivateKey(_bytesToBigInt(base64Decode(d)), _domain);
    _cachedPrivate = key;
    return key;
  }

  /// Deterministic ECDSA (RFC 6979).
  ///
  /// Passing an HMAC to `ECDSASigner` derives the per-signature nonce from the
  /// key and the message rather than from a random source. That removes an
  /// entire failure class: a repeated or predictable ECDSA nonce leaks the
  /// private key outright, and a mobile device early in boot is exactly where
  /// entropy is thinnest.
  @override
  Future<Uint8List> sign(String canonical) async {
    final signer = ECDSASigner(SHA256Digest(), HMac(SHA256Digest(), 64))
      ..init(true, PrivateKeyParameter<ECPrivateKey>(await _privateKey()));

    final signature =
        signer.generateSignature(utf8.encode(canonical)) as ECSignature;

    // Raw r‖s, fixed width — the IEEE P1363 form the backend accepts.
    return Uint8List.fromList([
      ...bigIntToFixedBytes(signature.r, 32),
      ...bigIntToFixedBytes(signature.s, 32),
    ]);
  }

  @override
  Future<void> destroy() async {
    _cachedPrivate = null;
    await _storage.delete(key: _privateKeyKey);
    await _storage.delete(key: _publicKeyKey);
  }
}
