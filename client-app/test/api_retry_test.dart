import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/api_client.dart';
import 'package:vault_client/core/device_key_store.dart';
import 'package:vault_client/core/grant_holder.dart';
import 'package:vault_client/core/session_store.dart';

/// Regression cover for the automatic-retry rule.
///
/// The API client refreshes the session once and retries when a request fails
/// because the session expired. Getting the condition slightly wrong is
/// expensive in a way that is invisible in normal use: an earlier version
/// retried on any 401 except GRANT_REQUIRED, so a single mistyped master
/// password was submitted twice — two audit entries, two of the five allowed
/// attempts consumed, and the password on the wire twice.
///
/// It was found by the end-to-end run counting audit rows, not by any unit
/// test, which is why there is now a unit test.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter(this.respond);

  final ResponseBody Function(RequestOptions options) respond;
  final List<String> requests = <String>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options.path);
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Map<String, dynamic> body, int status) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

void main() {
  late _RecordingAdapter adapter;
  late ApiClient api;
  late SessionStore session;

  Future<void> build(ResponseBody Function(RequestOptions) respond) async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    const storage = FlutterSecureStorage();

    session = SessionStore(storage);
    await session.saveDeviceId('11111111-1111-4111-8111-111111111111');
    await session.saveRefreshToken('a-refresh-token');
    session.accessToken = 'an-access-token';

    adapter = _RecordingAdapter(respond);
    final dio = Dio()..httpClientAdapter = adapter;

    api = ApiClient(
      baseUrl: 'https://vault.invalid',
      keyStore: SoftwareDeviceKeyStore(storage),
      session: session,
      grants: GrantHolder(),
      dio: dio,
    );
  }

  test('a rejected credential is submitted exactly once', () async {
    await build(
      (_) => _json({
        'error': {'code': 'INVALID_CREDENTIAL', 'requestId': 'x'},
      }, 401),
    );

    await api.send<Map<String, dynamic>>(
      method: 'post',
      path: '/vault/unlock',
      body: {'password': 'wrong'},
    );

    final unlocks =
        adapter.requests.where((p) => p.contains('/vault/unlock')).length;
    expect(unlocks, 1, reason: 'a wrong password must not be retried');
    expect(
      adapter.requests.where((p) => p.contains('/auth/refresh')),
      isEmpty,
      reason: 'a wrong password is not a session problem',
    );
  });

  test('a missing grant is not retried either', () async {
    await build(
      (_) => _json({
        'error': {'code': 'GRANT_REQUIRED', 'requestId': 'x'},
      }, 401),
    );

    await api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/documents/abc/content',
      withGrant: true,
    );

    expect(adapter.requests, hasLength(1));
  });

  test('an expired session is refreshed and the request retried once', () async {
    var refreshed = false;

    await build((options) {
      if (options.path.contains('/auth/refresh')) {
        refreshed = true;
        return _json({
          'accessToken': 'a-new-access-token',
          'refreshToken': 'a-new-refresh-token',
          'expiresIn': 600,
        }, 200);
      }
      if (!refreshed) {
        return _json({
          'error': {'code': 'UNAUTHORIZED', 'requestId': 'x'},
        }, 401);
      }
      return _json({'items': <dynamic>[], 'total': 0, 'page': 1}, 200);
    });

    final response = await api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/documents',
    );

    expect(response.statusCode, 200);
    expect(
      adapter.requests.where((p) => p.contains('/auth/refresh')),
      hasLength(1),
    );
    expect(
      adapter.requests.where((p) => p.contains('/documents')),
      hasLength(2),
      reason: 'once before the refresh, once after — and no more',
    );
    expect(session.accessToken, 'a-new-access-token');
  });

  test('gives up rather than looping when the refresh also fails', () async {
    await build((options) {
      if (options.path.contains('/auth/refresh')) {
        return _json({
          'error': {'code': 'UNAUTHORIZED', 'requestId': 'x'},
        }, 401);
      }
      return _json({
        'error': {'code': 'UNAUTHORIZED', 'requestId': 'x'},
      }, 401);
    });

    final response = await api.send<Map<String, dynamic>>(
      method: 'get',
      path: '/documents',
    );

    expect(response.statusCode, 401);
    expect(
      adapter.requests.where((p) => p.contains('/documents')),
      hasLength(1),
    );
  });
}
