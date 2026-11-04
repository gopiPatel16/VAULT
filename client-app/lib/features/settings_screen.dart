import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';

/// Basic settings.
///
/// Read this list for what is missing. There is no "change master password",
/// no "reset", no "recover", no "master password settings", and no diagnostic
/// or connection section. Those screens are not disabled or permission-gated —
/// they were never written, which is the only version of that guarantee an
/// attacker with the binary cannot argue with.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final identity = ref.watch(identityProvider);
    final grants = ref.watch(grantHolderProvider);
    final keyStore = ref.watch(deviceKeyStoreProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          identity.when(
            loading: () => const ListTile(title: Text('...')),
            // A failure here is not worth a whole error screen; the rest of
            // settings still works.
            error: (_, __) => const SizedBox.shrink(),
            data: (value) => Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: const Text('Account'),
                  subtitle: Text(value.displayName),
                ),
                ListTile(
                  leading: const Icon(Icons.devices_outlined),
                  title: const Text('This device'),
                  subtitle: Text(value.deviceName),
                ),
              ],
            ),
          ),

          ListTile(
            leading: Icon(
              keyStore.isHardwareBacked ? Icons.memory : Icons.key_outlined,
            ),
            title: const Text('Device key'),
            subtitle: Text(
              keyStore.isHardwareBacked
                  ? 'Held in secure hardware'
                  : 'Held in encrypted storage',
            ),
          ),

          const Divider(height: 32),

          ListTile(
            leading: Icon(
              grants.isUnlocked ? Icons.lock_open_outlined : Icons.lock_outline,
            ),
            title: const Text('Document access'),
            subtitle: Text(
              grants.isUnlocked
                  ? 'Unlocked for ${grants.remaining.inMinutes} more minutes'
                  : 'Locked',
            ),
            trailing: grants.isUnlocked
                ? TextButton(
                    onPressed: () => ref.read(vaultRepositoryProvider).lock(),
                    child: const Text('Lock now'),
                  )
                : null,
          ),

          const Divider(height: 32),

          ListTile(
            leading: const Icon(Icons.logout, color: Colors.redAccent),
            title: const Text('Sign out',
                style: TextStyle(color: Colors.redAccent)),
            onTap: () async {
              await ref.read(vaultRepositoryProvider).signOut();
              ref.read(appStageProvider.notifier).signedOut();
              if (context.mounted) Navigator.of(context).pop();
            },
          ),
        ],
      ),
    );
  }
}
