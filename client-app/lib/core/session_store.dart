import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Layer-1 credentials at rest.
///
/// The refresh token and the device id live in Keychain / Android Keystore-
/// backed storage. The access token is held in memory only: it lasts ten
/// minutes and is re-minted from the refresh token, so writing it down would
/// add persistence risk for no benefit.
///
/// The document grant is not here at all — see [GrantHolder].
class SessionStore {
  SessionStore(this._storage);

  static const _refreshKey = 'vault.session.refresh';
  static const _deviceIdKey = 'vault.device.id';

  final FlutterSecureStorage _storage;

  /// In memory only: it lasts ten minutes and is re-minted from the refresh
  /// token, so persisting it would add risk for no benefit.
  String? accessToken;

  Future<String?> get deviceId => _storage.read(key: _deviceIdKey);
  Future<String?> get refreshToken => _storage.read(key: _refreshKey);

  Future<bool> get isEnrolled async => (await deviceId) != null;
  Future<bool> get hasSession async => (await refreshToken) != null;

  Future<void> saveDeviceId(String id) =>
      _storage.write(key: _deviceIdKey, value: id);

  Future<void> saveRefreshToken(String token) =>
      _storage.write(key: _refreshKey, value: token);

  /// Signing out drops the session but keeps the device enrolled: the device
  /// is still authorised hardware, the person just is not signed in.
  Future<void> clearSession() async {
    accessToken = null;
    await _storage.delete(key: _refreshKey);
  }

  /// Used when the backend rejects the device outright. Everything local goes,
  /// so the app returns to enrolment with no stale state to reason about.
  Future<void> clearAll() async {
    accessToken = null;
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _deviceIdKey);
  }
}
