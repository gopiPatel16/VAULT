import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/failure.dart';
import '../providers.dart';

/// First launch: register this device against a one-time code.
///
/// The code comes from the administrator out of band. Enrolling does not sign
/// anyone in — the account password is still required afterwards.
class EnrolmentScreen extends ConsumerStatefulWidget {
  const EnrolmentScreen({super.key});

  @override
  ConsumerState<EnrolmentScreen> createState() => _EnrolmentScreenState();
}

class _EnrolmentScreenState extends ConsumerState<EnrolmentScreen> {
  final _code = TextEditingController();
  final _name = TextEditingController(text: _defaultDeviceName());
  bool _busy = false;
  Failure? _failure;

  // `defaultTargetPlatform` rather than `dart:io`'s Platform: the latter does
  // not exist on web and throws at startup there, and this is a UI file that
  // has no business depending on dart:io regardless.
  static String _defaultDeviceName() => switch (defaultTargetPlatform) {
        TargetPlatform.iOS => 'iPhone',
        TargetPlatform.android => 'Android',
        TargetPlatform.macOS => 'MacBook',
        TargetPlatform.windows => 'Windows PC',
        _ => 'Device',
      };

  /// Must be one of the values the backend's enrolment DTO accepts.
  static String _platform() => switch (defaultTargetPlatform) {
        TargetPlatform.iOS => 'ios',
        TargetPlatform.android => 'android',
        TargetPlatform.macOS => 'macos',
        TargetPlatform.windows => 'windows',
        _ => 'linux',
      };

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _failure = null;
    });

    try {
      await ref.read(vaultRepositoryProvider).enroll(
            code: _code.text.trim().toUpperCase(),
            deviceName: _name.text.trim(),
            platform: _platform(),
          );
      await ref.read(appStageProvider.notifier).refresh();
    } on VaultException catch (e) {
      if (mounted) setState(() => _failure = e.failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.lock_outline,
                      size: 44, color: theme.colorScheme.primary),
                  const SizedBox(height: 20),
                  Text('Private Vault',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Text(
                    'Enter the setup code you were given to authorise this device.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _code,
                    autocorrect: false,
                    enableSuggestions: false,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Setup code',
                      hintText: 'XXXXX-XXXXX-XXXXX-XXXXX',
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Device name'),
                  ),
                  if (_failure != null) ...[
                    const SizedBox(height: 18),
                    Text(
                      _failure == Failure.invalidCredential
                          ? 'That code was not accepted.'
                          : _failure!.detail,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 26),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Authorise device'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
