import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/failure.dart';
import '../providers.dart';

/// Layer 1 only.
///
/// Signing in gets the user as far as browsing and searching titles. It does
/// not get them a single byte of a document — that needs the master password,
/// which is a separate prompt at a separate moment.
///
/// Note what this screen does not have: no "forgot password" link, no "reset",
/// no "recover". Not hidden — never written. If a client forgets a credential,
/// the administrator is the only route, and that is deliberate.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _loginId = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscured = true;
  Failure? _failure;

  @override
  void dispose() {
    _loginId.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _failure = null;
    });

    try {
      await ref.read(vaultRepositoryProvider).signIn(
            loginId: _loginId.text.trim(),
            password: _password.text,
          );
      // Cleared the instant it is no longer needed.
      _password.clear();
      ref.read(appStageProvider.notifier).signedIn();
    } on VaultException catch (e) {
      if (!mounted) return;
      if (e.failure == Failure.notAuthorised) {
        // The device itself was rejected. Nothing local is worth keeping.
        await ref.read(vaultRepositoryProvider).forget();
        if (mounted) ref.read(appStageProvider.notifier).forgotten();
        return;
      }
      setState(() => _failure = e.failure);
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
                  Icon(Icons.folder_shared_outlined,
                      size: 44, color: theme.colorScheme.primary),
                  const SizedBox(height: 20),
                  Text('Private Vault',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _loginId,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(labelText: 'Account'),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _password,
                    obscureText: _obscured,
                    autocorrect: false,
                    enableSuggestions: false,
                    onSubmitted: (_) => _busy ? null : _submit(),
                    decoration: InputDecoration(
                      labelText: 'Password',
                      suffixIcon: IconButton(
                        icon: Icon(_obscured
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscured = !_obscured),
                      ),
                    ),
                  ),
                  if (_failure != null) ...[
                    const SizedBox(height: 18),
                    Text(
                      _failure!.detail,
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
                        : const Text('Sign in'),
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
