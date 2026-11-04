import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/api_client.dart';
import 'package:vault_client/core/device_key_store.dart';
import 'package:vault_client/core/failure.dart';
import 'package:vault_client/core/grant_holder.dart';
import 'package:vault_client/core/session_store.dart';
import 'package:vault_client/data/vault_repository.dart';

/// End-to-end, against a running backend.
///
/// Deliberately outside `test/` so the ordinary suite stays hermetic. This one
/// needs a live service and a seeded vault:
///
///   cd backend
///   createdb vault_e2e
///   DATABASE_URL=...vault_e2e npx prisma migrate deploy
///   DATABASE_URL=...vault_e2e STORAGE_ROOT=./var/e2e-storage PORT=3100 \
///     node dist/main.js &
///   DATABASE_URL=...vault_e2e npx ts-node -T scripts/seed-e2e.ts
///
///   cd ../client-app && flutter test test_e2e/e2e_test.dart
///
/// Every layer is the real one: the client's own key store signs, its own
/// repository makes the calls, and the backend's guards decide. Nothing is
/// stubbed, so this is the test that would notice the two halves disagreeing
/// about anything the unit tests each verified in isolation.
void main() {
  late Map<String, dynamic> fixture;
  late VaultRepository vault;
  late GrantHolder grants;

  setUpAll(() async {
    final file = File('test/fixtures/e2e.json');
    if (!file.existsSync()) {
      fail('fixture missing — run backend/scripts/seed-e2e.ts first');
    }
    fixture = jsonDecode(await file.readAsString()) as Map<String, dynamic>;

    // The analyzer only treats `test/` as a test directory, and this file
    // lives outside it deliberately so the hermetic suite does not try to
    // reach a live service.
    // ignore: invalid_use_of_visible_for_testing_member
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    const storage = FlutterSecureStorage();

    final keyStore = SoftwareDeviceKeyStore(storage);
    final session = SessionStore(storage);
    grants = GrantHolder();

    vault = VaultRepository(
      api: ApiClient(
        baseUrl: fixture['baseUrl'] as String,
        keyStore: keyStore,
        session: session,
        grants: grants,
      ),
      session: session,
      grants: grants,
      keyStore: keyStore,
    );
  });

  test('the full client journey, against a live vault', () async {
    // ── Enrolment ─────────────────────────────────────────────────────────
    await vault.enroll(
      code: fixture['enrollmentCode'] as String,
      deviceName: 'E2E Device',
      platform: 'ios',
    );

    // Enrolment alone must not be able to read anything.
    await expectLater(
      vault.documents(),
      throwsA(isA<VaultException>()),
      reason: 'an enrolled but unauthenticated device must not list documents',
    );

    // ── Layer 1 ───────────────────────────────────────────────────────────
    await vault.signIn(
      loginId: fixture['loginId'] as String,
      password: fixture['clientPassword'] as String,
    );

    final identity = await vault.identity();
    expect(identity.displayName, 'End-to-end Client');
    expect(identity.deviceName, 'E2E Device');

    final page = await vault.documents();
    expect(page.total, 1);
    expect(page.items.single.title, fixture['documentTitle']);
    expect(page.items.single.sizeBytes, fixture['expectedSizeBytes']);
    expect(page.items.single.tags, ['degree', 'university']);

    final searched = await vault.documents(query: 'mca');
    expect(searched.total, 1);
    final missed = await vault.documents(query: 'nothing-like-this');
    expect(missed.total, 0);

    final categories = await vault.categories();
    expect(categories.single.slug, 'personal');

    final documentId = fixture['documentId'] as String;

    // ── Being signed in is not permission to read ─────────────────────────
    expect(grants.isUnlocked, isFalse);
    await expectLater(
      vault.content(documentId),
      throwsA(
        isA<VaultException>().having((e) => e.failure, 'failure', Failure.locked),
      ),
      reason: 'Layer 1 alone must not yield document bytes',
    );

    // ── Wrong master password ─────────────────────────────────────────────
    await expectLater(
      vault.unlock('not-the-master-password'),
      throwsA(
        isA<VaultException>()
            .having((e) => e.failure, 'failure', Failure.invalidCredential),
      ),
    );
    expect(grants.isUnlocked, isFalse);

    // ── Layer 2 ───────────────────────────────────────────────────────────
    await vault.unlock(fixture['masterPassword'] as String);
    expect(grants.isUnlocked, isTrue);
    expect(grants.remaining.inSeconds, greaterThan(240));

    final bytes = await vault.content(documentId);
    expect(
      base64Encode(bytes),
      fixture['expectedContentBase64'],
      reason: 'the document must arrive byte-identical through encryption',
    );

    // ── Locking again ─────────────────────────────────────────────────────
    await vault.lock();
    expect(grants.isUnlocked, isFalse);
    await expectLater(
      vault.content(documentId),
      throwsA(
        isA<VaultException>().having((e) => e.failure, 'failure', Failure.locked),
      ),
      reason: 'locking must actually re-lock, not just update the UI',
    );

    // ── A document that does not exist ────────────────────────────────────
    await vault.unlock(fixture['masterPassword'] as String);
    await expectLater(
      vault.content('00000000-0000-4000-8000-000000000000'),
      throwsA(isA<VaultException>()),
    );

    // ── Signing out ───────────────────────────────────────────────────────
    await vault.signOut();
    expect(grants.isUnlocked, isFalse);
    await expectLater(vault.documents(), throwsA(isA<VaultException>()));
  }, timeout: const Timeout(Duration(minutes: 2)));
}
