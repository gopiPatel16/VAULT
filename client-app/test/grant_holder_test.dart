import 'package:flutter_test/flutter_test.dart';
import 'package:vault_client/core/grant_holder.dart';

/// The unlock window, as the client models it.
///
/// The backend is the authority on whether a grant is valid — these tests are
/// about the client never *presenting* a token it should already know is dead,
/// and never leaving the UI showing "unlocked" after the window closes.
void main() {
  group('GrantHolder', () {
    test('starts locked', () {
      final holder = GrantHolder();
      expect(holder.isUnlocked, isFalse);
      expect(holder.token, isNull);
      expect(holder.remaining, Duration.zero);
      holder.dispose();
    });

    test('holds a token for the granted window', () {
      final holder = GrantHolder();
      holder.grant('opaque-token', DateTime.now().add(const Duration(minutes: 5)));

      expect(holder.isUnlocked, isTrue);
      expect(holder.token, 'opaque-token');
      expect(holder.remaining.inSeconds, greaterThan(290));
      holder.dispose();
    });

    test('refuses to hand back an expired token', () {
      final holder = GrantHolder();
      holder.grant('stale', DateTime.now().subtract(const Duration(seconds: 1)));

      expect(holder.isUnlocked, isFalse);
      // The client drops it rather than sending something the backend will
      // reject — one fewer failed request, and no window where the UI claims
      // to be unlocked while every call 401s.
      expect(holder.token, isNull);
      holder.dispose();
    });

    test('lock() clears immediately', () {
      final holder = GrantHolder();
      holder.grant('t', DateTime.now().add(const Duration(minutes: 5)));
      holder.lock();

      expect(holder.isUnlocked, isFalse);
      expect(holder.token, isNull);
      holder.dispose();
    });

    test('notifies listeners on grant and on lock', () {
      final holder = GrantHolder();
      var notifications = 0;
      holder.addListener(() => notifications++);

      holder.grant('t', DateTime.now().add(const Duration(minutes: 5)));
      holder.lock();

      expect(notifications, 2);
      holder.dispose();
    });

    test('re-locks automatically when the window elapses', () async {
      final holder = GrantHolder();
      holder.grant('t', DateTime.now().add(const Duration(milliseconds: 60)));
      expect(holder.isUnlocked, isTrue);

      await Future<void>.delayed(const Duration(milliseconds: 120));

      expect(holder.isUnlocked, isFalse);
      holder.dispose();
    });

    test('a second grant replaces the first', () {
      final holder = GrantHolder();
      holder.grant('first', DateTime.now().add(const Duration(minutes: 1)));
      holder.grant('second', DateTime.now().add(const Duration(minutes: 5)));

      expect(holder.token, 'second');
      expect(holder.remaining.inSeconds, greaterThan(120));
      holder.dispose();
    });
  });
}
