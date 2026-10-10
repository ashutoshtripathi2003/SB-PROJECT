import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Phone notifications through Firebase Cloud Messaging: ride updates reach the notification bar
/// even when the app is closed. Only active in builds made with the Firebase app file
/// (GOOGLE_SERVICES_JSON on GitHub); otherwise [start] returns null and the app works as before.
class Push {
  static bool _started = false;

  /// Ask for permission and return this phone's Firebase address, or null when push isn't available.
  /// [onOpen] gets the notification's link (e.g. /trip/b_123) when the user taps one.
  static Future<String?> start({required void Function(String link) onOpen, required void Function(String token) onNewToken}) async {
    if (kIsWeb) return null;
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission();
      if (perm.authorizationStatus == AuthorizationStatus.denied) return null;
      if (!_started) {
        _started = true;
        void open(RemoteMessage m) {
          final link = m.data['link'];
          if (link is String && link.isNotEmpty) onOpen(link);
        }

        // Tapped while the app was in the background, or tapped to start the app.
        FirebaseMessaging.onMessageOpenedApp.listen(open);
        final initial = await fm.getInitialMessage();
        if (initial != null) open(initial);
        fm.onTokenRefresh.listen(onNewToken);
      }
      return await fm.getToken();
    } catch (e) {
      debugPrint('RideSync: phone notifications off ($e)');
      return null;
    }
  }

  static String get platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
}
