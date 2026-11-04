import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/device_key_store.dart';
import 'package:vault_client/core/failure.dart';
import 'package:vault_client/core/grant_holder.dart';
import 'package:vault_client/data/models.dart';
import 'package:vault_client/features/document_detail_screen.dart';
import 'package:vault_client/features/home_screen.dart';
import 'package:vault_client/features/settings_screen.dart';
import 'package:vault_client/features/unlock_sheet.dart';
import 'package:vault_client/providers.dart';
import 'package:vault_client/ui/theme.dart';
import 'package:vault_client/ui/unavailable_view.dart';

/// Renders the real screens.
///
/// No simulator is involved: `testWidgets` builds and lays out the actual
/// widget tree, so these assert what a person would see rather than what the
/// source says. That matters most for the two guarantees that are about
/// absence — §13 (no master-password management anywhere in the client) and
/// §23 (failures never name infrastructure) — because absence is exactly what
/// a source review skims past.

/// Words that must never reach a client user (ARCHITECTURE §2, §21).
final _forbiddenVocabulary = RegExp(
  r'server|offline|online|unreachable|connection refused|host|database|'
  r'ip address|filesystem|localhost|timeout|econnrefused',
  caseSensitive: false,
);

/// Anything that would imply the client can manage the master password (§13).
final _passwordManagement = RegExp(
  r'forgot|reset|recover|change password|set password|remove password|'
  r'master password settings',
  caseSensitive: false,
);

/// Every piece of text currently on screen.
List<String> visibleText(WidgetTester tester) {
  final strings = <String>[];
  for (final widget in tester.allWidgets) {
    if (widget is Text && widget.data != null) strings.add(widget.data!);
    if (widget is RichText) strings.add(widget.text.toPlainText());
  }
  return strings;
}

class _FakeKeyStore implements DeviceKeyStore {
  @override
  bool get isHardwareBacked => false;
  @override
  Future<String> ensureKeyPair() async => 'unused';
  @override
  Future<Uint8List> sign(String canonical) async => Uint8List(64);
  @override
  Future<void> destroy() async {}
}

DocumentMeta _document({String title = 'MCA Degree', bool favourite = false}) =>
    DocumentMeta(
      id: '11111111-1111-4111-8111-111111111111',
      title: title,
      filename: 'mca.pdf',
      fileType: 'application/pdf',
      sizeBytes: 2048,
      categorySlug: 'education',
      categoryName: 'Education',
      tags: const ['degree'],
      isFavourite: favourite,
      documentDate: null,
      uploadedAt: DateTime(2026, 1, 1),
    );

Widget _host(Widget child, {List<Override> overrides = const []}) {
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp(theme: buildVaultTheme(), home: child),
  );
}

void main() {
  group('the generic failure screen', () {
    testWidgets('says 404 and nothing about why', (tester) async {
      await tester.pumpWidget(
        _host(const Scaffold(body: UnavailableView(failure: Failure.unavailable))),
      );

      expect(find.text('404'), findsOneWidget);
      expect(find.text('Unable to load this page.'), findsOneWidget);

      for (final text in visibleText(tester)) {
        expect(
          _forbiddenVocabulary.hasMatch(text),
          isFalse,
          reason: 'failure screen leaked infrastructure vocabulary: "$text"',
        );
      }
    });

    testWidgets('looks the same for a transport failure and a missing document',
        (tester) async {
      await tester.pumpWidget(
        _host(const Scaffold(body: FailureView(error: 'some internal object'))),
      );
      final unknownError = visibleText(tester);

      await tester.pumpWidget(
        _host(
          const Scaffold(
            body: FailureView(error: VaultException(Failure.unavailable)),
          ),
        ),
      );
      await tester.pump();

      // An unexpected exception must not produce a more informative screen
      // than an expected one.
      expect(visibleText(tester), unknownError);
    });
  });

  group('settings', () {
    testWidgets('offers no way to manage the master password', (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          const SettingsScreen(),
          overrides: [
            grantHolderProvider.overrideWith((ref) => grants),
            deviceKeyStoreProvider.overrideWithValue(_FakeKeyStore()),
            identityProvider.overrideWith(
              (ref) async =>
                  const Identity(displayName: 'Test Client', deviceName: 'iPhone'),
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      final texts = visibleText(tester);
      expect(texts, isNotEmpty);

      for (final text in texts) {
        expect(
          _passwordManagement.hasMatch(text),
          isFalse,
          reason: 'settings exposed password management: "$text"',
        );
        expect(
          _forbiddenVocabulary.hasMatch(text),
          isFalse,
          reason: 'settings leaked infrastructure vocabulary: "$text"',
        );
      }

      // What it *should* offer.
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.text('Document access'), findsOneWidget);
    });

    testWidgets('reports the lock state and offers Lock now when unlocked',
        (tester) async {
      final grants = GrantHolder()
        ..grant('t', DateTime.now().add(const Duration(minutes: 5)));

      await tester.pumpWidget(
        _host(
          const SettingsScreen(),
          overrides: [
            grantHolderProvider.overrideWith((ref) => grants),
            deviceKeyStoreProvider.overrideWithValue(_FakeKeyStore()),
            identityProvider.overrideWith(
              (ref) async =>
                  const Identity(displayName: 'Test Client', deviceName: 'iPhone'),
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Lock now'), findsOneWidget);
      expect(find.textContaining('Unlocked for'), findsOneWidget);
    });
  });

  group('the unlock prompt', () {
    testWidgets('collects the password and offers nothing else', (tester) async {
      await tester.pumpWidget(
        _host(
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => showUnlockSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      expect(find.text('Protected Document'), findsOneWidget);
      expect(find.text('Unlock Document'), findsOneWidget);

      // The field must be obscured and must not offer autofill.
      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.obscureText, isTrue);
      expect(field.autocorrect, isFalse);
      expect(field.enableSuggestions, isFalse);
      expect(field.autofillHints, isEmpty);

      for (final text in visibleText(tester)) {
        expect(
          _passwordManagement.hasMatch(text),
          isFalse,
          reason: 'the unlock prompt offered password management: "$text"',
        );
      }
    });
  });

  group('document detail', () {
    testWidgets('withholds Preview and Download until unlocked', (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          DocumentDetailScreen(document: _document()),
          overrides: [grantHolderProvider.overrideWith((ref) => grants)],
        ),
      );
      await tester.pumpAndSettle();

      // Metadata is visible with Layer 1 alone...
      expect(find.text('mca.pdf'), findsOneWidget);
      expect(find.text('Education'), findsOneWidget);

      // ...but nothing that yields bytes.
      expect(find.text('Protected Document'), findsOneWidget);
      expect(find.text('Preview'), findsNothing);
      expect(find.text('Download'), findsNothing);
    });

    testWidgets('offers Preview and Download once a grant is held',
        (tester) async {
      final grants = GrantHolder()
        ..grant('t', DateTime.now().add(const Duration(minutes: 5)));

      await tester.pumpWidget(
        _host(
          DocumentDetailScreen(document: _document()),
          overrides: [grantHolderProvider.overrideWith((ref) => grants)],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Preview'), findsOneWidget);
      expect(find.text('Download'), findsOneWidget);
      expect(find.textContaining('Access expires in'), findsOneWidget);
    });
  });

  group('favourites', () {
    testWidgets('offers a star that reflects the current state', (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          DocumentDetailScreen(document: _document(favourite: true)),
          overrides: [grantHolderProvider.overrideWith((ref) => grants)],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.star), findsOneWidget);
      expect(find.byIcon(Icons.star_outline), findsNothing);
    });

    testWidgets('shows an empty star when not favourited', (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          DocumentDetailScreen(document: _document()),
          overrides: [grantHolderProvider.overrideWith((ref) => grants)],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.star_outline), findsOneWidget);
      expect(find.byIcon(Icons.star), findsNothing);
    });

    testWidgets('is available while still locked — it is metadata, not content',
        (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          DocumentDetailScreen(document: _document()),
          overrides: [grantHolderProvider.overrideWith((ref) => grants)],
        ),
      );
      await tester.pumpAndSettle();

      expect(grants.isUnlocked, isFalse);
      final star = tester.widget<IconButton>(
        find.ancestor(
          of: find.byIcon(Icons.star_outline),
          matching: find.byType(IconButton),
        ),
      );
      expect(star.onPressed, isNotNull);
      // And still no way to reach the bytes.
      expect(find.text('Preview'), findsNothing);
      expect(find.text('Download'), findsNothing);
    });
  });

  group('home', () {
    testWidgets('lists documents and never mentions infrastructure',
        (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          const HomeScreen(),
          overrides: [
            grantHolderProvider.overrideWith((ref) => grants),
            categoriesProvider.overrideWith(
              (ref) async => [
                const CategorySummary(
                  slug: 'education',
                  name: 'Education',
                  documentCount: 1,
                ),
              ],
            ),
            documentsProvider.overrideWith(
              (ref) async =>
                  DocumentPage(items: [_document()], total: 1, page: 1),
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Private Vault'), findsOneWidget);
      expect(find.text('MCA Degree'), findsOneWidget);
      expect(find.text('Search documents...'), findsOneWidget);

      for (final text in visibleText(tester)) {
        expect(
          _forbiddenVocabulary.hasMatch(text),
          isFalse,
          reason: 'home leaked infrastructure vocabulary: "$text"',
        );
      }
    });

    testWidgets('renders the generic failure screen when loading fails',
        (tester) async {
      final grants = GrantHolder();

      await tester.pumpWidget(
        _host(
          const HomeScreen(),
          overrides: [
            grantHolderProvider.overrideWith((ref) => grants),
            categoriesProvider.overrideWith((ref) async => <CategorySummary>[]),
            documentsProvider.overrideWith(
              (ref) async => throw const VaultException(Failure.unavailable),
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('404'), findsOneWidget);
      expect(find.text('Unable to load this page.'), findsOneWidget);
    });
  });
}
