import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api.dart';
import '../api/events.dart';
import '../api/models.dart';
import 'push.dart';

/// Server built into the app at build time:
///   flutter build apk --dart-define=RIDESYNC_SERVER_URL=https://your-server
const builtInServer = String.fromEnvironment('RIDESYNC_SERVER_URL');

enum SessionStatus { loading, needsServer, signedOut, needsOnboarding, ready, admin }

/// Where a signed-in user lands: admin-only accounts get the admin dashboard, never the student app.
SessionStatus statusFor(User u) => u.adminOnly ? SessionStatus.admin : (u.onboarded ? SessionStatus.ready : SessionStatus.needsOnboarding);

String normalizeServer(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return '';
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) s = 'https://$s';
  s = s.replaceAll(RegExp(r'/+$'), '');
  if (s.endsWith('/api')) s = s.substring(0, s.length - 4);
  return s;
}

/// Who is signed in, to which server — and the live connection for that login.
class Session extends ChangeNotifier {
  static const _storage = FlutterSecureStorage();

  SessionStatus status = SessionStatus.loading;
  Api? _api;
  AppConfig? config;
  User? user;
  LiveEvents? events;
  String? startupError;

  /// The rider's latest search, reused when requesting a seat.
  SearchQuery? lastQuery;

  /// This phone's Firebase address (null when phone notifications aren't available).
  String? pushToken;
  String? _pendingPushLink;
  final _pushOpened = StreamController<void>.broadcast();

  /// Fires when a phone notification was tapped; read the link with [takePushLink].
  Stream<void> get onPushOpened => _pushOpened.stream;

  /// The link of the last tapped phone notification, once.
  String? takePushLink() {
    final l = _pendingPushLink;
    _pendingPushLink = null;
    return l;
  }

  Api get api => _api!;
  String get server => _api?.baseUrl ?? '';
  bool get hasBuiltInServer => builtInServer.isNotEmpty;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('server') ?? '';
    final server = normalizeServer(saved.isNotEmpty ? saved : builtInServer);
    if (server.isEmpty) return _set(SessionStatus.needsServer);
    String? token;
    try {
      token = await _storage.read(key: 'token');
    } catch (_) {
      token = null;
    }
    _api = Api(server, token: token);
    await refresh();
  }

  /// Reload config and the signed-in user.
  Future<void> refresh() async {
    startupError = null;
    try {
      config = await api.config();
    } on ApiError catch (e) {
      startupError = e.message;
      _set(status == SessionStatus.loading ? SessionStatus.signedOut : status);
      return;
    }
    if (api.token == null || api.token!.isEmpty) return _set(SessionStatus.signedOut);
    try {
      user = await api.me();
      _afterSignIn();
    } on ApiError catch (e) {
      if (e.isAuth) {
        await _clearToken();
        _set(SessionStatus.signedOut);
      } else {
        startupError = e.message;
        _set(user == null ? SessionStatus.signedOut : status);
      }
    }
  }

  /// Re-read the server's settings (e.g. after email was set up on the laptop).
  Future<void> reloadConfig() async {
    try {
      config = await api.config();
      notifyListeners();
    } catch (_) {/* keep the last copy */}
  }

  Future<void> connect(String raw) async {
    final s = normalizeServer(raw);
    if (s.isEmpty) throw const ApiError('Enter the server link.');
    if (!await Api.probe(s)) {
      throw const ApiError('Couldn’t reach RideSync at that link. Check it, and that RideSync and share.bat are running on the laptop.');
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server', s);
    if (_api?.baseUrl != s) await _clearToken();
    _api = Api(s);
    _set(SessionStatus.loading);
    await refresh();
  }

  Future<void> changeServer() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('server');
    await signOut(remote: false);
    if (hasBuiltInServer) {
      _api = Api(normalizeServer(builtInServer));
      return refresh();
    }
    _api = null;
    _set(SessionStatus.needsServer);
  }

  Future<void> signedIn(User u, String token) async {
    api.token = token;
    try {
      await _storage.write(key: 'token', value: token);
    } catch (_) {/* keep the in-memory login */}
    user = u;
    _afterSignIn();
  }

  void _afterSignIn() {
    events?.dispose();
    events = LiveEvents(baseUrl: api.baseUrl, token: api.token!)..start();
    _set(statusFor(user!));
    unawaited(_startPush());
  }

  Future<void> _startPush() async {
    Future<void> register(String token) async {
      pushToken = token;
      if (_api?.token == null) return;
      try {
        await api.registerPush(token, Push.platform);
      } catch (_) {/* tried again on the next start */}
    }

    final token = await Push.start(
      onOpen: (link) {
        _pendingPushLink = link;
        _pushOpened.add(null);
      },
      onNewToken: register,
    );
    if (token != null) await register(token);
  }

  void setUser(User u) {
    user = u;
    _set(statusFor(u));
  }

  Future<void> reloadUser() async {
    try {
      setUser(await api.me());
    } catch (_) {/* keep the current copy */}
  }

  Future<void> signOut({bool remote = true}) async {
    if (remote && _api != null) {
      try {
        await api.logout(pushToken: pushToken);
      } catch (_) {}
    }
    events?.dispose();
    events = null;
    user = null;
    await _clearToken();
    _set(_api == null ? SessionStatus.needsServer : SessionStatus.signedOut);
  }

  Future<void> _clearToken() async {
    _api?.token = null;
    try {
      await _storage.delete(key: 'token');
    } catch (_) {}
  }

  void _set(SessionStatus s) {
    status = s;
    notifyListeners();
  }

  @override
  void dispose() {
    _pushOpened.close();
    events?.dispose();
    super.dispose();
  }
}
