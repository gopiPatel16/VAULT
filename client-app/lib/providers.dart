import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'core/api_client.dart';
import 'core/device_key_store.dart';
import 'core/grant_holder.dart';
import 'core/session_store.dart';
import 'data/models.dart';
import 'data/vault_repository.dart';

/// Where the service lives.
///
/// A compile-time constant supplied with `--dart-define`, deliberately not a
/// setting. There is no screen in this application that displays or edits an
/// address, because an address is infrastructure and the client is not
/// supposed to know it is a thing that exists.
const String kBaseUrl = String.fromEnvironment(
  'VAULT_BASE_URL',
  defaultValue: 'https://vault.example.com',
);

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
  );
});

final deviceKeyStoreProvider = Provider<DeviceKeyStore>((ref) {
  return SoftwareDeviceKeyStore(ref.watch(secureStorageProvider));
});

final sessionStoreProvider = Provider<SessionStore>((ref) {
  return SessionStore(ref.watch(secureStorageProvider));
});

final grantHolderProvider = ChangeNotifierProvider<GrantHolder>((ref) {
  return GrantHolder();
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: kBaseUrl,
    keyStore: ref.watch(deviceKeyStoreProvider),
    session: ref.watch(sessionStoreProvider),
    grants: ref.watch(grantHolderProvider),
  );
});

final vaultRepositoryProvider = Provider<VaultRepository>((ref) {
  return VaultRepository(
    api: ref.watch(apiClientProvider),
    session: ref.watch(sessionStoreProvider),
    grants: ref.watch(grantHolderProvider),
    keyStore: ref.watch(deviceKeyStoreProvider),
  );
});

/// Which screen the app should be showing at the top level.
enum AppStage { loading, enrolment, signIn, ready }

class AppStageNotifier extends StateNotifier<AppStage> {
  AppStageNotifier(this._session) : super(AppStage.loading) {
    refresh();
  }

  final SessionStore _session;

  Future<void> refresh() async {
    if (!await _session.isEnrolled) {
      state = AppStage.enrolment;
    } else if (!await _session.hasSession) {
      state = AppStage.signIn;
    } else {
      state = AppStage.ready;
    }
  }

  void signedIn() => state = AppStage.ready;
  void signedOut() => state = AppStage.signIn;
  void forgotten() => state = AppStage.enrolment;
}

final appStageProvider =
    StateNotifierProvider<AppStageNotifier, AppStage>((ref) {
  return AppStageNotifier(ref.watch(sessionStoreProvider));
});

// ── Data ────────────────────────────────────────────────────────────────────

final identityProvider = FutureProvider<Identity>((ref) {
  return ref.watch(vaultRepositoryProvider).identity();
});

final categoriesProvider = FutureProvider<List<CategorySummary>>((ref) {
  return ref.watch(vaultRepositoryProvider).categories();
});

/// Current browse/search state.
class DocumentQuery {
  const DocumentQuery({
    this.search = '',
    this.category,
    this.favouritesOnly = false,
  });

  final String search;
  final String? category;
  final bool favouritesOnly;

  DocumentQuery copyWith({
    String? search,
    String? category,
    bool clearCategory = false,
    bool? favouritesOnly,
  }) {
    return DocumentQuery(
      search: search ?? this.search,
      category: clearCategory ? null : (category ?? this.category),
      favouritesOnly: favouritesOnly ?? this.favouritesOnly,
    );
  }
}

final documentQueryProvider =
    StateProvider<DocumentQuery>((ref) => const DocumentQuery());

final documentsProvider = FutureProvider<DocumentPage>((ref) {
  final query = ref.watch(documentQueryProvider);
  return ref.watch(vaultRepositoryProvider).documents(
        query: query.search,
        category: query.category,
        favouritesOnly: query.favouritesOnly,
      );
});
