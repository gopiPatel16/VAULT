import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/enrolment_screen.dart';
import 'features/home_screen.dart';
import 'features/sign_in_screen.dart';
import 'providers.dart';
import 'ui/theme.dart';

class VaultApp extends ConsumerStatefulWidget {
  const VaultApp({super.key});

  @override
  ConsumerState<VaultApp> createState() => _VaultAppState();
}

class _VaultAppState extends ConsumerState<VaultApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Leaving the foreground drops the unlock window immediately.
  ///
  /// The grant would expire on its own within minutes, but an app sitting in
  /// the switcher in an unlocked state is exactly the situation a short window
  /// exists to avoid — and it costs the user one password prompt.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      ref.read(grantHolderProvider).lock();
    }
  }

  @override
  Widget build(BuildContext context) {
    final stage = ref.watch(appStageProvider);

    return MaterialApp(
      title: 'Private Vault',
      debugShowCheckedModeBanner: false,
      theme: buildVaultTheme(),
      home: switch (stage) {
        AppStage.loading => const _Splash(),
        AppStage.enrolment => const EnrolmentScreen(),
        AppStage.signIn => const SignInScreen(),
        AppStage.ready => const HomeScreen(),
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
