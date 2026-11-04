import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/failure.dart';
import '../providers.dart';

/// The Document Master Password prompt.
///
/// Everything about this sheet is constrained by ARCHITECTURE §13 and §22:
///
///   * it collects the password and submits it — nothing else
///   * there is no "forgot", no "reset", no "change", no "set", no "remove"
///   * the password is never stored, never cached, and the controller is
///     disposed the moment the sheet closes
///   * autofill and suggestions are off, so it cannot land in a keyboard
///     dictionary or a password manager entry the client controls
///   * the verdict comes from the backend; this widget contains no comparison
///
/// Returns true when the vault was unlocked.
Future<bool> showUnlockSheet(BuildContext context) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => const _UnlockSheet(),
  );
  return result ?? false;
}

class _UnlockSheet extends ConsumerStatefulWidget {
  const _UnlockSheet();

  @override
  ConsumerState<_UnlockSheet> createState() => _UnlockSheetState();
}

class _UnlockSheetState extends ConsumerState<_UnlockSheet> {
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscured = true;
  bool _empty = true;
  Failure? _failure;

  @override
  void dispose() {
    // The password does not outlive the sheet.
    _password.clear();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // An empty submission would come back as a generic validation failure,
    // which renders as "unable to load" and tells the user nothing useful.
    // The backend still validates; this only avoids a pointless round trip.
    if (_password.text.isEmpty) return;

    setState(() {
      _busy = true;
      _failure = null;
    });

    try {
      await ref.read(vaultRepositoryProvider).unlock(_password.text);
      _password.clear();
      if (mounted) Navigator.of(context).pop(true);
    } on VaultException catch (e) {
      if (mounted) setState(() => _failure = e.failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Text('🔐', style: TextStyle(fontSize: 22)),
              const SizedBox(width: 10),
              Text('Protected Document',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Enter the document master password.',
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _password,
            autofocus: true,
            obscureText: _obscured,
            autocorrect: false,
            enableSuggestions: false,
            autofillHints: const <String>[],
            onChanged: (value) => setState(() => _empty = value.isEmpty),
            onSubmitted: (_) => _busy || _empty ? null : _submit(),
            decoration: InputDecoration(
              hintText: '•••••••••••••',
              suffixIcon: IconButton(
                icon: Icon(_obscured
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _obscured = !_obscured),
              ),
            ),
          ),
          if (_failure != null) ...[
            const SizedBox(height: 14),
            Text(
              switch (_failure!) {
                Failure.invalidCredential => 'Invalid password.',
                Failure.tooManyAttempts => 'Too many attempts. Try again later.',
                _ => _failure!.detail,
              },
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          const SizedBox(height: 22),
          FilledButton(
            onPressed: _busy || _empty ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Unlock Document'),
          ),
        ],
      ),
    );
  }
}
