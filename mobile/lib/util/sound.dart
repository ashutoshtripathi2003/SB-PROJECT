import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Short, friendly sounds for the moments people wait for (like Uber and Rapido): a seat confirmed, a new ride
/// request, the driver arriving, a new message — with a matching vibration. The same chimes as the website
/// (src/lib/sound.ts), as small files in assets/sounds. Students can turn them off in Settings → Notifications.
enum Sound { success, request, arrived, message, sent, start, cancel }

class Sounds {
  static const _key = 'sounds_on';
  static bool _on = true;
  static final _player = AudioPlayer()..setReleaseMode(ReleaseMode.stop);

  static bool get on => _on;

  /// Reads the saved setting (call once at start-up).
  static Future<void> load() async {
    try {
      _on = (await SharedPreferences.getInstance()).getBool(_key) ?? true;
    } catch (_) {}
  }

  static Future<void> setOn(bool value) async {
    _on = value;
    try {
      await (await SharedPreferences.getInstance()).setBool(_key, value);
    } catch (_) {}
  }

  static Future<void> play(Sound s) async {
    if (!_on) return;
    switch (s) {
      case Sound.request || Sound.arrived:
        HapticFeedback.heavyImpact();
      case Sound.success || Sound.start:
        HapticFeedback.mediumImpact();
      default:
        HapticFeedback.lightImpact();
    }
    try {
      await _player.stop();
      await _player.play(AssetSource('sounds/${s.name}.wav'));
    } catch (_) {
      // No sound on this device: the vibration is enough.
    }
  }
}
