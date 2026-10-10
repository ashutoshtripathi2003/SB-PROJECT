import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'admin_models.dart';
import 'models.dart';

/// A failed request, with the server's message ready to show to the student.
class ApiError implements Exception {
  final String message;
  final int status;
  final String? field;
  const ApiError(this.message, {this.status = 0, this.field});
  bool get isAuth => status == 401;
  bool get isNetwork => status == 0;
  @override
  String toString() => message;
}

/// HTTP client for the RideSync server. The app signs in with a bearer token
/// (the website uses a cookie instead).
class Api {
  Api(this.baseUrl, {this.token});

  /// e.g. https://ridesync.onrender.com
  String baseUrl;
  String? token;
  final http.Client _client = http.Client();

  Map<String, String> get _headers => {
        'x-ridesync': '1',
        'x-ridesync-app': '1',
        'Accept': 'application/json',
        if (token != null && token!.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  Uri uri(String path, [Map<String, String>? query]) => Uri.parse('$baseUrl/api$path').replace(queryParameters: query);

  Future<dynamic> request(String method, String path, {Object? body, Map<String, String>? query}) async {
    final req = http.Request(method, uri(path, query))..headers.addAll(_headers);
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(req).timeout(const Duration(seconds: 25)));
    } on TimeoutException {
      throw const ApiError('The server is taking too long. Check your connection and try again.');
    } catch (_) {
      throw const ApiError('You’re offline or the server can’t be reached. Check your connection and try again.');
    }
    dynamic data;
    try {
      data = res.body.isEmpty ? <String, dynamic>{} : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      data = <String, dynamic>{};
    }
    if (res.statusCode >= 400) {
      final map = data is Map ? data : const {};
      throw ApiError('${map['error'] ?? 'Something went wrong. Please try again.'}', status: res.statusCode, field: map['field'] as String?);
    }
    return data;
  }

  Future<dynamic> get(String path, [Map<String, String>? query]) => request('GET', path, query: query);
  Future<dynamic> post(String path, [Object? body]) => request('POST', path, body: body ?? const {});
  Future<dynamic> patch(String path, Object body) => request('PATCH', path, body: body);
  Future<dynamic> put(String path, Object body) => request('PUT', path, body: body);
  Future<dynamic> delete(String path) => request('DELETE', path);

  static Map<String, dynamic> _map(dynamic v) => (v as Map).cast<String, dynamic>();
  static List<Map<String, dynamic>> _list(dynamic v) => (v as List).whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();

  /* ---- Config & sign-in ---- */

  Future<AppConfig> config() async => AppConfig.fromJson(_map(await get('/config')));
  Future<void> requestCode(String email) => post('/auth/code/request', {'email': email});

  /// Returns (user, token).
  Future<(User, String)> verifyCode(String email, String code) async => _login(await post('/auth/code/verify', {'email': email, 'code': code}));
  Future<(User, String)> devLogin(String email) async => _login(await post('/auth/dev', {'email': email}));

  (User, String) _login(dynamic data) {
    final m = _map(data);
    final t = m['token'];
    if (t is! String || t.isEmpty) throw const ApiError('This server didn’t return an app login. Update the RideSync server and try again.');
    return (User.fromJson(_map(m['user'])), t);
  }

  Future<void> logout() => post('/auth/logout');

  /// Finish Sign in with Microsoft: swap the one-time code from ridesync://auth for a login.
  Future<(User, String)> appExchange(String code) async => _login(await post('/auth/app/exchange', {'code': code}));

  /// Address that starts Sign in with Microsoft in the phone's browser.
  String get microsoftStartUrl => '$baseUrl/api/auth/microsoft/start?app=1';

  /* ---- Me ---- */

  Future<User> me() async => User.fromJson(_map(await get('/me')));
  Future<User> updateMe(Map<String, dynamic> patch) async => User.fromJson(_map(await this.patch('/me', patch)));
  Future<User> saveVehicle(Map<String, dynamic> v) async => User.fromJson(_map(await put('/me/vehicle', v)));
  Future<void> deleteAccount() => delete('/me');

  /// Photo of the VIT ID card as a data URL; the user's idStatus becomes 'pending'.
  Future<User> uploadIdCard(String image) async => User.fromJson(_map(await put('/me/id-card', {'image': image})));

  /* ---- Places & routes ---- */

  Future<List<Place>> searchPlaces(String q, String session) async => _list(await get('/places', {'q': q, 's': session})).map(Place.fromJson).toList();
  Future<Place> resolvePlace(String id, String session) async => Place.fromJson(_map(await get('/places/resolve', {'id': id, 's': session})));
  Future<({String name, String area})> reverse(double lat, double lng) async {
    final m = _map(await get('/places/reverse', {'lat': '$lat', 'lng': '$lng'}));
    return (name: '${m['name']}', area: '${m['area']}');
  }

  Future<LiveEta> eta(LatLngPoint from, LatLngPoint to, {bool route = false, DateTime? departAt}) async => LiveEta.fromJson(_map(await get('/eta', {
        'fromLat': from.lat.toStringAsFixed(5),
        'fromLng': from.lng.toStringAsFixed(5),
        'toLat': to.lat.toStringAsFixed(5),
        'toLng': to.lng.toStringAsFixed(5),
        if (route) 'route': '1',
        if (departAt != null) 'departAt': departAt.toUtc().toIso8601String(),
      })));
  String get trafficTileUrl => '$baseUrl/api/traffic/{z}/{x}/{y}.png';
  Future<RouteInfo> route(Place from, Place to) async => RouteInfo.fromJson(_map(await post('/route', {'from': from.toJson(), 'to': to.toJson()})));

  /* ---- Rides ---- */

  Future<(List<MatchResult>, int)> search(SearchQuery q) async {
    final m = _map(await post('/rides/search', q.toJson()));
    return (_list(m['results']).map(MatchResult.fromJson).toList(), (m['ridesInWindow'] as num?)?.toInt() ?? 0);
  }

  Future<List<FeedItem>> feed() async => _list(await get('/rides/feed')).map(FeedItem.fromJson).toList();
  Future<RideDetail> ride(String id) async => RideDetail.fromJson(_map(await get('/rides/$id')));
  Future<MatchResult?> match(String rideId, SearchQuery q) async {
    final m = _map(await post('/rides/$rideId/match', {'query': q.toJson()}));
    return m['match'] is Map ? MatchResult.fromJson(_map(m['match'])) : null;
  }

  Future<Ride> offerRide(Map<String, dynamic> body) async => Ride.fromJson(_map(await post('/rides', body)));
  Future<void> cancelRide(String id, [String? reason]) => post('/rides/$id/cancel', {'reason': ?reason});
  Future<void> startRide(String id) => post('/rides/$id/start');
  Future<void> sendLocation(String rideId, double lat, double lng, double? heading) =>
      post('/rides/$rideId/location', {'lat': lat, 'lng': lng, 'heading': (heading == null || heading < 0 || heading > 360) ? null : heading});
  Future<void> completeRide(String id) => post('/rides/$id/complete');

  /* ---- Bookings ---- */

  Future<Booking> requestSeat(String rideId, SearchQuery q, String? message) async =>
      Booking.fromJson(_map(await post('/bookings', {'rideId': rideId, 'query': q.toJson(), if (message != null && message.isNotEmpty) 'message': message})));
  Future<BookingDetail> booking(String id) async => BookingDetail.fromJson(_map(await get('/bookings/$id')));
  Future<void> respond(String id, bool accept) => post('/bookings/$id/respond', {'accept': accept});
  Future<void> pay(String id, String method, [String? reference]) => post('/bookings/$id/pay', {'method': method, if (reference != null && reference.isNotEmpty) 'reference': reference});
  Future<void> paymentReceived(String id) => post('/bookings/$id/payment-received');
  Future<void> cancelBooking(String id, [String? reason]) => post('/bookings/$id/cancel', {'reason': ?reason});
  Future<void> arrived(String id) => post('/bookings/$id/arrived');
  /// The driver types the rider's 4-digit ride PIN to start their trip.
  Future<void> pickedUp(String id, String pin) => post('/bookings/$id/picked-up', {'pin': pin});
  Future<({String url, String text, bool local})> shareTrip(String id) async {
    final m = _map(await post('/bookings/$id/share'));
    return (url: '${m['url'] ?? ''}', text: '${m['text'] ?? ''}', local: m['local'] == true);
  }

  /// Rider: this phone's live location for the driver, until pickup.
  Future<void> riderLocation(String id, double lat, double lng, double? accuracy) =>
      post('/bookings/$id/rider-location', {'lat': lat, 'lng': lng, 'accuracy': accuracy == null || !accuracy.isFinite || accuracy < 0 ? null : accuracy.round().clamp(0, 10000)});

  /// Driver waited 5+ minutes after arriving and the rider never came.
  Future<void> noShow(String id) => post('/bookings/$id/no-show');

  Future<void> dropped(String id) => post('/bookings/$id/dropped');
  Future<void> rate(String id, int stars, [List<String> tags = const []]) => post('/bookings/$id/rate', {'stars': stars, if (tags.isNotEmpty) 'tags': tags});

  /// Razorpay: the server creates the order (amount is decided server-side).
  Future<Map<String, dynamic>> onlineOrder(String bookingId) async => _map(await post('/bookings/$bookingId/pay/online'));
  Future<void> verifyOnline(String bookingId, String orderId, String paymentId, String signature) =>
      post('/bookings/$bookingId/pay/online/verify', {'razorpay_order_id': orderId, 'razorpay_payment_id': paymentId, 'razorpay_signature': signature});

  /* ---- RideSync Wallet ---- */

  Future<WalletInfo> wallet() async => WalletInfo.fromJson(_map(await get('/wallet')));
  Future<Map<String, dynamic>> walletTopUpOrder(int amount) async => _map(await post('/wallet/topup', {'amount': amount}));
  Future<void> verifyTopUp(String orderId, String paymentId, String signature) =>
      post('/wallet/topup/verify', {'razorpay_order_id': orderId, 'razorpay_payment_id': paymentId, 'razorpay_signature': signature});
  Future<void> payFromWallet(String bookingId) => post('/bookings/$bookingId/pay/wallet');

  /* ---- Lists ---- */

  Future<Trips> trips() async => Trips.fromJson(_map(await get('/trips')));
  Future<List<PaymentRecord>> payments() async => _list(await get('/payments')).map(PaymentRecord.fromJson).toList();
  Future<List<Thread>> threads() async => _list(await get('/threads')).map(Thread.fromJson).toList();
  Future<List<Message>> messages(String bookingId) async => _list(await get('/bookings/$bookingId/messages')).map(Message.fromJson).toList();
  Future<void> sendMessage(String bookingId, String text) => post('/bookings/$bookingId/messages', {'text': text});
  Future<List<AppNotification>> notifications() async => _list(await get('/notifications')).map(AppNotification.fromJson).toList();
  Future<void> readAllNotifications() => post('/notifications/read-all');
  Future<({int unread, int requests})> badges() async {
    final m = _map(await get('/badges'));
    return (unread: (m['unread'] as num?)?.toInt() ?? 0, requests: (m['requests'] as num?)?.toInt() ?? 0);
  }

  /* ---- RideSync Assistant ---- */

  Future<AssistantReply> assistant(String text) async => AssistantReply.fromJson(_map(await post('/assistant', {'text': text})));

  /* ---- Admin dashboard (admins only) ---- */

  Future<AdminStats> adminStats() async => AdminStats.fromJson(_map(await get('/admin/stats')));

  /// [status]: scheduled | in_progress | completed | cancelled, or null for all.
  Future<List<AdminRide>> adminRides([String? status]) async =>
      _list(await get('/admin/rides', status == null || status.isEmpty ? null : {'status': status})).map(AdminRide.fromJson).toList();
  Future<List<AdminUser>> adminUsers([String q = '']) async => _list(await get('/admin/users', q.trim().isEmpty ? null : {'q': q.trim()})).map(AdminUser.fromJson).toList();
  Future<List<IdCardReview>> adminIdCards() async => _list(await get('/admin/id-cards')).map(IdCardReview.fromJson).toList();
  Future<void> reviewIdCard(String userId, bool approve, [String? note]) =>
      post('/admin/id-cards/$userId', {'approve': approve, if (!approve && note != null && note.isNotEmpty) 'note': note});

  /// Checks an address answers like a RideSync server.
  static Future<bool> probe(String baseUrl) async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/config'), headers: {'x-ridesync': '1', 'x-ridesync-app': '1'}).timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return false;
      final j = jsonDecode(res.body);
      return j is Map && j['allowedDomain'] != null;
    } catch (_) {
      return false;
    }
  }
}
