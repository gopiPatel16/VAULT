import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'canonical_request.dart';
import 'device_key_store.dart';
import 'failure.dart';
import 'grant_holder.dart';
import 'session_store.dart';

/// The only way this application talks to anything.
///
/// Two responsibilities, both security-relevant:
///
///   1. sign every request with the device key, over the exact bytes sent
///   2. flatten every possible outcome into a [Failure], so that no code path
///      above this class can accidentally render a diagnostic
///
/// There is no logging of URLs, bodies or errors. A crash reporter that
/// uploaded a stack trace containing a request URL would carry document ids
/// off the device.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required DeviceKeyStore keyStore,
    required SessionStore session,
    required GrantHolder grants,
    Dio? dio,
  })  : _keyStore = keyStore,
        _session = session,
        _grants = grants,
        _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 60)
      ..sendTimeout = const Duration(seconds: 60)
      // Every status is "successful" as far as Dio is concerned; this class
      // decides what each one means. Letting Dio throw would scatter status
      // handling across the app.
      ..validateStatus = (_) => true;
  }

  static const String apiPrefix = '/api/v1';

  final Dio _dio;
  final DeviceKeyStore _keyStore;
  final SessionStore _session;
  final GrantHolder _grants;
  final Random _random = Random.secure();

  bool _refreshing = false;

  String _nonce() {
    final bytes = List<int>.generate(12, (_) => _random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// Performs a signed request, refreshing the session once on a 401 before
  /// giving up.
  Future<Response<T>> send<T>({
    required String method,
    required String path,
    Object? body,
    Map<String, String>? query,
    bool withGrant = false,
    bool allowRefresh = true,
    ResponseType responseType = ResponseType.json,
    String? overrideDeviceId,
  }) async {
    final response = await _signAndSend<T>(
      method: method,
      path: path,
      body: body,
      query: query,
      withGrant: withGrant,
      responseType: responseType,
      overrideDeviceId: overrideDeviceId,
    );

    if (response.statusCode == 401 && allowRefresh && !_refreshing) {
      // Retry ONLY when the session itself was the problem.
      //
      // The earlier version retried on any 401 other than GRANT_REQUIRED,
      // which silently re-sent rejected credentials: a single wrong master
      // password produced two `dmp.verify.failure` audit entries and burned
      // two of the five allowed attempts, halving the lockout threshold and
      // putting the password on the wire twice for no reason. Caught by the
      // end-to-end run, not by any unit test.
      //
      // INVALID_CREDENTIAL means what was typed was wrong; no amount of
      // token refreshing changes that. GRANT_REQUIRED means the master
      // password is needed, which is a prompt, not a retry.
      final code = _codeOf(response);
      if (code == 'UNAUTHORIZED' && await _tryRefresh()) {
        return _signAndSend<T>(
          method: method,
          path: path,
          body: body,
          query: query,
          withGrant: withGrant,
          responseType: responseType,
        );
      }
    }
    return response;
  }

  Future<Response<T>> _signAndSend<T>({
    required String method,
    required String path,
    Object? body,
    Map<String, String>? query,
    bool withGrant = false,
    ResponseType responseType = ResponseType.json,
    String? overrideDeviceId,
  }) async {
    final queryString = (query == null || query.isEmpty)
        ? ''
        : '?${query.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&')}';

    final pathWithQuery = '$apiPrefix$path$queryString';

    // Serialised exactly once. The signature covers these bytes and these
    // bytes are what get sent — re-encoding anywhere in between would reorder
    // keys and invalidate the signature.
    final rawBody = body == null ? '' : jsonEncode(body);

    final deviceId = overrideDeviceId ?? await _session.deviceId ?? '';
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final nonce = _nonce();

    await _keyStore.ensureKeyPair();
    final Uint8List signature = await _keyStore.sign(
      buildCanonicalRequest(
        method: method,
        pathWithQuery: pathWithQuery,
        timestampMs: timestamp,
        nonce: nonce,
        rawBody: rawBody,
      ),
    );

    final headers = <String, String>{
      'x-device-id': deviceId,
      'x-timestamp': '$timestamp',
      'x-nonce': nonce,
      'x-signature': base64Encode(signature),
      if (body != null) 'content-type': 'application/json',
      if (_session.accessToken != null)
        'authorization': 'Bearer ${_session.accessToken}',
      if (withGrant && _grants.token != null)
        'x-vault-grant': _grants.token!,
    };

    try {
      return await _dio.request<T>(
        pathWithQuery,
        data: rawBody.isEmpty ? null : rawBody,
        options: Options(
          method: method.toUpperCase(),
          headers: headers,
          responseType: responseType,
        ),
      );
    } on DioException {
      // Timeout, DNS failure, TLS failure, refused connection, socket reset —
      // every one of them becomes the same thing. This is the single most
      // important line in the client.
      throw const VaultException(Failure.unavailable);
    }
  }

  Future<bool> _tryRefresh() async {
    final refresh = await _session.refreshToken;
    if (refresh == null) return false;

    _refreshing = true;
    try {
      final response = await _signAndSend<Map<String, dynamic>>(
        method: 'post',
        path: '/auth/refresh',
        body: {'refreshToken': refresh},
      );
      if (response.statusCode != 200) return false;

      final data = response.data!;
      _session.accessToken = data['accessToken'] as String;
      await _session.saveRefreshToken(data['refreshToken'] as String);
      return true;
    } on VaultException {
      return false;
    } finally {
      _refreshing = false;
    }
  }

  String? _codeOf(Response<dynamic> response) {
    final data = response.data;
    if (data is Map && data['error'] is Map) {
      return (data['error'] as Map)['code'] as String?;
    }
    return null;
  }

  /// Maps a response onto the failure vocabulary.
  ///
  /// Note what is absent: no branch inspects a message, and no branch
  /// distinguishes 500 from 502 from 503. Anything that is not a recognised
  /// outcome is [Failure.unavailable].
  Never throwFor(Response<dynamic> response) {
    final code = _codeOf(response);
    throw switch (code) {
      'GRANT_REQUIRED' => const VaultException(Failure.locked),
      'INVALID_CREDENTIAL' => const VaultException(Failure.invalidCredential),
      'UNAUTHORIZED' => const VaultException(Failure.notAuthorised),
      'TOO_MANY_REQUESTS' => const VaultException(Failure.tooManyAttempts),
      'NOT_FOUND' => const VaultException(Failure.notFound),
      _ => const VaultException(Failure.unavailable),
    };
  }

  bool isOk(Response<dynamic> response) {
    final status = response.statusCode ?? 0;
    return status >= 200 && status < 300;
  }
}
