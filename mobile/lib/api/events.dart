import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

/// Live updates from the server (Server-Sent Events): new rides, requests,
/// chat, notifications and the driver's position. Reconnects automatically.
class LiveEvents {
  LiveEvents({required this.baseUrl, required this.token});

  final String baseUrl;
  final String token;

  final _sync = StreamController<void>.broadcast();
  final _notifications = StreamController<AppNotification>.broadcast();
  final _locations = StreamController<(String rideId, DriverLocation location)>.broadcast();
  final _riderLocations = StreamController<(String rideId, String bookingId, RiderLocation location)>.broadcast();
  final _connected = StreamController<bool>.broadcast();

  /// Something changed on the server — refetch what's on screen.
  Stream<void> get onSync => _sync.stream;
  Stream<AppNotification> get onNotification => _notifications.stream;
  Stream<(String, DriverLocation)> get onLocation => _locations.stream;
  /// Driver only: a waiting rider's phone location.
  Stream<(String, String, RiderLocation)> get onRiderLocation => _riderLocations.stream;
  Stream<bool> get onConnection => _connected.stream;

  http.Client? _client;
  StreamSubscription<String>? _sub;
  bool _stopped = false;
  int _attempt = 0;
  Timer? _retry;

  void start() {
    _stopped = false;
    _connect();
  }

  Future<void> _connect() async {
    if (_stopped) return;
    _client?.close();
    final client = _client = http.Client();
    try {
      final req = http.Request('GET', Uri.parse('$baseUrl/api/events'))
        ..headers.addAll({'Accept': 'text/event-stream', 'Authorization': 'Bearer $token', 'x-ridesync': '1', 'x-ridesync-app': '1'});
      final res = await client.send(req);
      if (res.statusCode != 200) throw Exception('events ${res.statusCode}');
      _attempt = 0;
      _connected.add(true);
      _sync.add(null); // catch up on anything missed while disconnected
      final buffer = StringBuffer();
      _sub = res.stream.transform(utf8.decoder).transform(const LineSplitter()).listen(
        (line) {
          if (line.startsWith('data:')) {
            buffer.write(line.substring(5).trimLeft());
          } else if (line.isEmpty && buffer.isNotEmpty) {
            _handle(buffer.toString());
            buffer.clear();
          }
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
        cancelOnError: true,
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _handle(String data) {
    try {
      final ev = (jsonDecode(data) as Map).cast<String, dynamic>();
      switch (ev['type']) {
        case 'sync':
          _sync.add(null);
        case 'notification':
          _notifications.add(AppNotification.fromJson((ev['notification'] as Map).cast<String, dynamic>()));
          _sync.add(null);
        case 'location':
          _locations.add(('${ev['rideId']}', DriverLocation.fromJson((ev['location'] as Map).cast<String, dynamic>())));
        case 'riderLocation':
          _riderLocations.add(('${ev['rideId']}', '${ev['bookingId']}', RiderLocation.fromJson((ev['location'] as Map).cast<String, dynamic>())));
      }
    } catch (_) {
      /* ignore malformed events */
    }
  }

  void _scheduleReconnect() {
    if (_stopped) return;
    _connected.add(false);
    _retry?.cancel();
    final delay = Duration(seconds: [1, 2, 4, 8, 15][_attempt.clamp(0, 4)]);
    _attempt++;
    _retry = Timer(delay, _connect);
  }

  void stop() {
    _stopped = true;
    _retry?.cancel();
    _sub?.cancel();
    _client?.close();
  }

  void dispose() {
    stop();
    _sync.close();
    _notifications.close();
    _locations.close();
    _riderLocations.close();
    _connected.close();
  }
}
