import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../core/device_key_store.dart';
import '../core/failure.dart';
import '../core/grant_holder.dart';
import '../core/session_store.dart';
import 'models.dart';

/// Every call the client is capable of making.
///
/// Worth reading as a list, because the list is the point: there is no method
/// to change the master password, no method to reset it, no method to recover
/// it, and no method to read it. A reverse-engineered binary reveals no such
/// call because none is written.
class VaultRepository {
  VaultRepository({
    required ApiClient api,
    required SessionStore session,
    required GrantHolder grants,
    required DeviceKeyStore keyStore,
  })  : _api = api,
        _session = session,
        _grants = grants,
        _keyStore = keyStore;

  final ApiClient _api;
  final SessionStore _session;
  final GrantHolder _grants;
  final DeviceKeyStore _keyStore;

  // ── Enrolment and sign-in ─────────────────────────────────────────────────

  /// Registers this device against a one-time code from the administrator.
  ///
  /// Enrolling does not sign anyone in — the account password is still
  /// required — so a leaked code on its own is not a way in.
  Future<void> enroll({
    required String code,
    required String deviceName,
    required String platform,
  }) async {
    final publicKey = await _keyStore.ensureKeyPair();

    final response = await _api.send<Map<String, dynamic>>(
      method: 'post',
      path: '/auth/enroll',
      allowRefresh: false,
      // No device id exists yet; the signature proves possession of the key
      // being enrolled.
      overrideDeviceId: '00000000-0000-4000-8000-000000000000',
      body: {
        'code': code,
        'publicKey': publicKey,
        'deviceName': deviceName,
        'platform': platform,
      },
    );

    if (!_api.isOk(response)) _api.throwFor(response);
    await _session.saveDeviceId(response.data!['deviceId'] as String);
  }

  Future<void> signIn({required String loginId, required String password}) async {
    final response = await _api.send<Map<String, dynamic>>(
      method: 'post',
      path: '/auth/login',
      allowRefresh: false,
      body: {'loginId': loginId, 'password': password},
    );

    if (!_api.isOk(response)) _api.throwFor(response);

    final data = response.data!;
    _session.accessToken = data['accessToken'] as String;
    await _session.saveRefreshToken(data['refreshToken'] as String);
  }

  Future<void> signOut() async {
    try {
      await _api.send<dynamic>(method: 'post', path: '/auth/logout');
    } on VaultException {
      // Signing out locally must succeed even if the request does not.
    }
    _grants.lock();
    await _session.clearSession();
  }

  /// Called when the backend says this device is no longer authorised. Wipes
  /// local state so the app returns to enrolment with nothing stale left.
  Future<void> forget() async {
    _grants.lock();
    await _session.clearAll();
    await _keyStore.destroy();
  }

  Future<Identity> identity() async {
    final response = await _api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/auth/me',
    );
    if (!_api.isOk(response)) _api.throwFor(response);
    return Identity.fromJson(response.data!);
  }

  // ── Metadata (Layer 1) ────────────────────────────────────────────────────

  Future<List<CategorySummary>> categories() async {
    final response = await _api.send<List<dynamic>>(
      method: 'get',
      path: '/categories',
    );
    if (!_api.isOk(response)) _api.throwFor(response);
    return response.data!
        .map((e) => CategorySummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<DocumentPage> documents({
    String? query,
    String? category,
    bool favouritesOnly = false,
    int page = 1,
  }) async {
    final response = await _api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/documents',
      query: {
        if (query != null && query.isNotEmpty) 'q': query,
        if (category != null) 'category': category,
        if (favouritesOnly) 'favorites': 'true',
        'page': '$page',
      },
    );
    if (!_api.isOk(response)) _api.throwFor(response);
    return DocumentPage.fromJson(response.data!);
  }

  Future<DocumentMeta> document(String id) async {
    final response = await _api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/documents/$id',
    );
    if (!_api.isOk(response)) _api.throwFor(response);
    return DocumentMeta.fromJson(response.data!);
  }

  Future<void> setFavourite(String id, bool favourite) async {
    final response = await _api.send<dynamic>(
      method: favourite ? 'post' : 'delete',
      path: '/documents/$id/favorite',
    );
    if (!_api.isOk(response)) _api.throwFor(response);
  }

  // ── The master password (Layer 2) ─────────────────────────────────────────

  /// Submits the master password for verification.
  ///
  /// This is the entire extent of the client's relationship with that
  /// password: it collects it, sends it once, and keeps only the short-lived
  /// grant that comes back. The password itself is not stored, not cached, and
  /// not held beyond this call.
  Future<void> unlock(String password) async {
    final response = await _api.send<Map<String, dynamic>>(
      method: 'post',
      path: '/vault/unlock',
      body: {'password': password},
    );

    if (!_api.isOk(response)) _api.throwFor(response);

    final data = response.data!;
    _grants.grant(
      data['grant'] as String,
      DateTime.parse(data['expiresAt'] as String),
    );
  }

  Future<void> lock() async {
    _grants.lock();
    try {
      await _api.send<dynamic>(method: 'post', path: '/vault/lock');
    } on VaultException {
      // The local lock already happened; that is the part that matters here.
    }
  }

  // ── Content (Layer 1 + Layer 2) ───────────────────────────────────────────

  Future<Uint8List> content(String id, {bool preview = false}) async {
    if (_grants.token == null) throw const VaultException(Failure.locked);

    final response = await _api.send<List<int>>(
      method: 'get',
      path: '/documents/$id/${preview ? 'preview' : 'content'}',
      withGrant: true,
      responseType: ResponseType.bytes,
    );

    if (!_api.isOk(response)) {
      // A bytes response type means an error body arrives as bytes too; it is
      // discarded rather than parsed, because nothing in it is needed.
      throw switch (response.statusCode) {
        401 => const VaultException(Failure.locked),
        404 => const VaultException(Failure.notFound),
        _ => const VaultException(Failure.unavailable),
      };
    }
    return Uint8List.fromList(response.data!);
  }
}
