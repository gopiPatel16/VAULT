import 'dart:async';

import 'package:flutter/foundation.dart';

/// Holds the document grant.
///
/// In memory only. It is never written to secure storage, never to a file,
/// never to preferences, and it does not survive the process. Losing it costs
/// the user one password prompt; persisting it would mean an attacker with the
/// device at rest inherits a live unlock window.
///
/// Expiry is tracked locally so the UI can count down and re-prompt, but the
/// backend re-checks on every single request — this class is a convenience,
/// never an authority.
class GrantHolder extends ChangeNotifier {
  String? _token;
  DateTime? _expiresAt;
  Timer? _timer;

  bool get isUnlocked {
    final expiry = _expiresAt;
    return _token != null && expiry != null && expiry.isAfter(DateTime.now());
  }

  /// The header value, or null when locked. Reading it while expired clears
  /// the holder rather than handing back a token the backend will reject.
  String? get token {
    if (!isUnlocked) {
      _clear(notify: false);
      return null;
    }
    return _token;
  }

  Duration get remaining {
    final expiry = _expiresAt;
    if (expiry == null) return Duration.zero;
    final left = expiry.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  void grant(String token, DateTime expiresAt) {
    _token = token;
    _expiresAt = expiresAt;

    // Re-lock exactly on expiry so the UI does not sit on a stale "unlocked"
    // state until the next request happens to fail.
    _timer?.cancel();
    final delay = expiresAt.difference(DateTime.now());
    if (!delay.isNegative) {
      _timer = Timer(delay, () => _clear());
    }
    notifyListeners();
  }

  /// Called on explicit lock, on sign-out, and when the app leaves the
  /// foreground.
  void lock() => _clear();

  void _clear({bool notify = true}) {
    _timer?.cancel();
    _timer = null;
    _token = null;
    _expiresAt = null;
    if (notify) notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
