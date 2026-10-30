import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'screens/admin.dart';
import 'screens/auth.dart';
import 'screens/onboarding.dart';
import 'screens/shell.dart';
import 'state/session.dart';
import 'theme.dart';
import 'util/sound.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark));
  Sounds.load();
  runApp(ChangeNotifierProvider(create: (_) => Session()..init(), child: const RideSyncApp()));
}

class RideSyncApp extends StatelessWidget {
  const RideSyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    final status = context.select<Session, SessionStatus>((s) => s.status);
    return MaterialApp(
      title: 'RideSync',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: switch (status) {
        SessionStatus.loading => const SplashScreen(),
        SessionStatus.needsServer => const ConnectScreen(),
        SessionStatus.signedOut => const LoginScreen(),
        SessionStatus.needsOnboarding => const OnboardingScreen(),
        SessionStatus.ready => const HomeShell(),
        SessionStatus.admin => const AdminShell(),
      },
    );
  }
}
