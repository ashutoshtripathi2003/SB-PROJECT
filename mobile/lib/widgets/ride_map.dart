import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' as fm;
import 'package:google_maps_flutter/google_maps_flutter.dart' as gm;
import 'package:latlong2/latlong.dart' as ll;
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../data/places.dart';
import '../state/session.dart';
import '../theme.dart';

/// Built with --dart-define=GOOGLE_MAPS=true (and a Google Maps key in the
/// Android/iOS project) → real Google Maps. Otherwise the free OpenStreetMap map.
const useGoogleMaps = bool.fromEnvironment('GOOGLE_MAPS');

/// Google Maps colours: clear = blue (the route itself), slow = orange, heavy = red, standstill = dark red.
const routeBlue = Color(0xFF1A73E8);
Color trafficColor(String level) => switch (level) { 'severe' => const Color(0xFF8B1A1A), 'heavy' => const Color(0xFFE3242B), _ => const Color(0xFFF29900) };

class MapPin {
  final LatLngPoint at;
  final String kind; // pickup | drop | car | me | eta (time bubble on the route)
  final String? label;
  final String? sublabel;
  final double? heading;

  /// Traffic colour for an eta bubble: light | moderate | heavy.
  final String? tone;
  const MapPin(this.at, this.kind, {this.label, this.sublabel, this.heading, this.tone});
}

/// Label card above a pin ("BKC · Arrive ~4:36 AM").
class _PinLabel extends StatelessWidget {
  const _PinLabel(this.pin);
  final MapPin pin;
  @override
  Widget build(BuildContext context) {
    final dark = pin.kind == 'pickup';
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        padding: const EdgeInsets.fromLTRB(9, 5, 9, 6),
        decoration: BoxDecoration(
          color: dark ? RS.ink900 : Colors.white,
          borderRadius: BorderRadius.circular(9),
          boxShadow: const [BoxShadow(color: Color(0x2915182E), blurRadius: 10, offset: Offset(0, 3))],
        ),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(pin.label!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: dark ? Colors.white : RS.ink900, fontWeight: FontWeight.w700, fontSize: 11.5)),
          if (pin.sublabel != null) Text(pin.sublabel!, maxLines: 1, style: TextStyle(color: dark ? Colors.white70 : RS.ink500, fontWeight: FontWeight.w500, fontSize: 10.5)),
        ]),
      ),
    );
  }
}

/// Dark time bubble with a pointer, sitting on the route.
class _EtaBubble extends StatelessWidget {
  const _EtaBubble(this.pin);
  final MapPin pin;
  @override
  Widget build(BuildContext context) {
    final dot = switch (pin.tone) { 'light' => const Color(0xFF34D27B), 'moderate' => const Color(0xFFFFB020), 'heavy' => const Color(0xFFFF5A5F), _ => const Color(0xFF9AA0B8) };
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.85, end: 1),
      duration: const Duration(milliseconds: 380),
      curve: Curves.easeOutBack,
      builder: (_, s, child) => Transform.scale(scale: s, alignment: Alignment.bottomCenter, child: child),
      child: Align(
        alignment: Alignment.bottomCenter,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.fromLTRB(11, 7, 11, 8),
            decoration: BoxDecoration(color: RS.ink900, borderRadius: BorderRadius.circular(12), boxShadow: const [BoxShadow(color: Color(0x4715182E), blurRadius: 14, offset: Offset(0, 5))]),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(pin.label ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 15, height: 1.1)),
              if (pin.sublabel != null)
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                  const SizedBox(width: 5),
                  Text(pin.sublabel!, style: const TextStyle(color: Colors.white70, fontSize: 10.5, fontWeight: FontWeight.w500)),
                ]),
            ]),
          ),
          Transform.translate(offset: const Offset(0, -5), child: Transform.rotate(angle: math.pi / 4, child: Container(width: 10, height: 10, color: RS.ink900))),
        ]),
      ),
    );
  }
}

/// The ride map, Ola/Uber style: the route draws itself, the pickup pulses and the
/// driver's car glides smoothly between GPS updates instead of jumping.
class RideMap extends StatefulWidget {
  const RideMap({
    super.key,
    this.route = const [],
    this.altRoutes = const [],
    this.pins = const [],
    this.follow,
    this.height,
    this.padding = EdgeInsets.zero,
    this.animateRoute = true,
    this.interactive = true,
    this.traffic = const [],
  });

  final List<LatLngPoint> route;

  /// Live traffic on [route] (index ranges), drawn over the blue line like Google Maps.
  final List<TrafficSegment> traffic;

  /// Faded routes behind the main one (e.g. other matches).
  final List<List<LatLngPoint>> altRoutes;
  final List<MapPin> pins;

  /// Keep this point in view as it moves (the driver's car).
  final LatLngPoint? follow;
  final double? height;

  /// Space covered by sheets/headers, so the route is framed in the visible part.
  final EdgeInsets padding;
  final bool animateRoute;
  final bool interactive;

  @override
  State<RideMap> createState() => _RideMapState();
}

class _RideMapState extends State<RideMap> with TickerProviderStateMixin {
  late final _routeAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));
  late final _carAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();
  // Google Maps redraws are costly, so its pickup pulse steps ~8 times a second.
  final _gPulse = ValueNotifier<double>(0);
  Timer? _gPulseTimer;
  LatLngPoint? _carFrom;
  LatLngPoint? _carTo;
  double _headingFrom = 0;
  double _headingTo = 0;

  // Google
  gm.GoogleMapController? _g;
  final Map<String, gm.BitmapDescriptor> _icons = {};
  // OpenStreetMap
  final _osm = fm.MapController();
  int _tileErrors = 0;
  bool _tilesFailed = false;
  bool _osmReady = false;

  MapPin? get _car => widget.pins.where((p) => p.kind == 'car').firstOrNull;

  @override
  void initState() {
    super.initState();
    _syncCar(initial: true);
    if (widget.animateRoute) {
      _routeAnim.forward();
    } else {
      _routeAnim.value = 1;
    }
    if (useGoogleMaps && !kIsWeb) {
      _loadIcons();
      _gPulseTimer = Timer.periodic(const Duration(milliseconds: 120), (_) => _gPulse.value = _pulse.value);
    }
  }

  @override
  void didUpdateWidget(covariant RideMap old) {
    super.didUpdateWidget(old);
    _syncCar();
    final routeChanged = old.route.length != widget.route.length ||
        (widget.route.isNotEmpty && old.route.isNotEmpty && (old.route.first.lat != widget.route.first.lat || old.route.last.lat != widget.route.last.lat));
    if (routeChanged) {
      if (widget.animateRoute) _routeAnim.forward(from: 0);
      _fit();
    } else if (old.pins.length != widget.pins.length || old.padding != widget.padding) {
      if (widget.follow == null) _fit();
    }
    final f = widget.follow;
    if (f != null && (old.follow?.lat != f.lat || old.follow?.lng != f.lng)) _keepInView(f);
  }

  /// Start a glide from where the car is drawn now to its new position.
  void _syncCar({bool initial = false}) {
    final car = _car;
    if (car == null) {
      _carFrom = _carTo = null;
      return;
    }
    if (initial || _carTo == null) {
      _carFrom = _carTo = car.at;
      _headingFrom = _headingTo = car.heading ?? 0;
      return;
    }
    if (_carTo!.lat == car.at.lat && _carTo!.lng == car.at.lng) return;
    _carFrom = _carShown;
    _headingFrom = _headingShown;
    _carTo = car.at;
    _headingTo = car.heading ?? _bearing(_carFrom!, _carTo!);
    _carAnim.forward(from: 0);
  }

  LatLngPoint? get _carShown {
    if (_carFrom == null || _carTo == null) return null;
    final t = Curves.easeInOut.transform(_carAnim.value);
    return LatLngPoint(_carFrom!.lat + (_carTo!.lat - _carFrom!.lat) * t, _carFrom!.lng + (_carTo!.lng - _carFrom!.lng) * t);
  }

  double get _headingShown {
    var d = (_headingTo - _headingFrom) % 360;
    if (d > 180) d -= 360;
    return _headingFrom + d * Curves.easeInOut.transform(_carAnim.value);
  }

  static double _bearing(LatLngPoint a, LatLngPoint b) {
    final y = math.sin((b.lng - a.lng) * math.pi / 180) * math.cos(b.lat * math.pi / 180);
    final x = math.cos(a.lat * math.pi / 180) * math.sin(b.lat * math.pi / 180) -
        math.sin(a.lat * math.pi / 180) * math.cos(b.lat * math.pi / 180) * math.cos((b.lng - a.lng) * math.pi / 180);
    return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
  }

  List<LatLngPoint> get _allPoints => [...widget.route, ...widget.pins.where((p) => p.kind != 'car' || widget.follow == null).map((p) => p.at)];

  /// The slow / heavy / standstill stretches of the route, with their colours.
  List<(List<LatLngPoint>, Color)> _stretches() => [
        for (final t in widget.traffic)
          if (t.to > t.from && t.from >= 0 && t.from < widget.route.length) (widget.route.sublist(t.from, math.min(widget.route.length, t.to + 1)), trafficColor(t.level)),
      ];

  List<LatLngPoint> _partial(List<LatLngPoint> r, double t) {
    if (t >= 1 || r.length < 2) return r;
    final n = (r.length * t).ceil().clamp(2, r.length);
    return r.sublist(0, n);
  }

  /* ---- camera ---- */

  void _fit() {
    final pts = _allPoints;
    if (pts.isEmpty) return;
    if (useGoogleMaps && !kIsWeb) {
      final g = _g;
      if (g == null) return;
      if (pts.length == 1) {
        g.animateCamera(gm.CameraUpdate.newLatLngZoom(gm.LatLng(pts.first.lat, pts.first.lng), 15));
        return;
      }
      g.animateCamera(gm.CameraUpdate.newLatLngBounds(_gBounds(pts), 56));
    } else {
      if (!_osmReady) return;
      if (pts.length == 1) {
        _osm.move(ll.LatLng(pts.first.lat, pts.first.lng), 15);
        return;
      }
      _osm.fitCamera(fm.CameraFit.coordinates(
        coordinates: pts.map((p) => ll.LatLng(p.lat, p.lng)).toList(),
        padding: EdgeInsets.fromLTRB(48 + widget.padding.left, 56 + widget.padding.top, 48 + widget.padding.right, 40 + widget.padding.bottom),
        maxZoom: 16,
      ));
    }
  }

  Future<void> _keepInView(LatLngPoint p) async {
    if (useGoogleMaps && !kIsWeb) {
      final g = _g;
      if (g == null) return;
      final region = await g.getVisibleRegion();
      if (!region.contains(gm.LatLng(p.lat, p.lng))) g.animateCamera(gm.CameraUpdate.newLatLng(gm.LatLng(p.lat, p.lng)));
    } else if (_osmReady) {
      if (!_osm.camera.visibleBounds.contains(ll.LatLng(p.lat, p.lng))) _osm.move(ll.LatLng(p.lat, p.lng), _osm.camera.zoom);
    }
  }

  static gm.LatLngBounds _gBounds(List<LatLngPoint> pts) {
    var s = pts.first.lat, n = s, w = pts.first.lng, e = w;
    for (final p in pts) {
      s = math.min(s, p.lat);
      n = math.max(n, p.lat);
      w = math.min(w, p.lng);
      e = math.max(e, p.lng);
    }
    return gm.LatLngBounds(southwest: gm.LatLng(s, w), northeast: gm.LatLng(n, e));
  }

  void recenter() => widget.follow != null ? _keepInView(widget.follow!) : _fit();

  /* ---- Google marker icons, drawn to match RideSync's pins ---- */

  Future<void> _loadIcons() async {
    final ratio = WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    for (final kind in ['pickup', 'drop', 'car', 'me']) {
      _icons[kind] = await _drawIcon(kind, ratio);
    }
    if (mounted) setState(() {});
  }

  static Future<gm.BitmapDescriptor> _drawIcon(String kind, double ratio) async {
    final size = kind == 'car' ? 40.0 : 22.0;
    final rec = ui.PictureRecorder();
    final c = Canvas(rec)..scale(ratio);
    final center = Offset(size / 2, size / 2);
    final white = Paint()..color = Colors.white;
    final shadow = Paint()
      ..color = const Color(0x4015182E)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.5);
    switch (kind) {
      case 'car':
        c.drawCircle(center + const Offset(0, 1.5), size / 2 - 3, shadow);
        c.drawCircle(center, size / 2 - 3, white);
        c.drawCircle(center, size / 2 - 6, Paint()..color = RS.primary);
        final arrow = Path()
          ..moveTo(size / 2, 10)
          ..lineTo(size / 2 + 7, size - 11)
          ..lineTo(size / 2, size - 15)
          ..lineTo(size / 2 - 7, size - 11)
          ..close();
        c.drawPath(arrow, white);
      case 'drop':
        final r = RRect.fromRectAndRadius(Rect.fromCenter(center: center, width: size - 4, height: size - 4), const Radius.circular(4));
        c.drawRRect(r.shift(const Offset(0, 1.5)), shadow);
        c.drawRRect(r, white);
        c.drawRRect(r.deflate(4), Paint()..color = RS.primary);
        c.drawRRect(r.deflate(8), white);
      case 'me':
        c.drawCircle(center, size / 2 - 2, white);
        c.drawCircle(center, size / 2 - 5, Paint()..color = RS.secondary);
      default:
        c.drawCircle(center + const Offset(0, 1.5), size / 2 - 2, shadow);
        c.drawCircle(center, size / 2 - 2, white);
        c.drawCircle(center, size / 2 - 6, Paint()..color = RS.ink900);
        c.drawCircle(center, 3, white);
    }
    final img = await rec.endRecording().toImage((size * ratio).round(), (size * ratio).round());
    final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
    return gm.BitmapDescriptor.bytes(bytes!.buffer.asUint8List(), width: size, height: size);
  }

  @override
  void dispose() {
    _routeAnim.dispose();
    _carAnim.dispose();
    _pulse.dispose();
    _gPulseTimer?.cancel();
    _gPulse.dispose();
    _g?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final map = AnimatedBuilder(
      animation: Listenable.merge([_routeAnim, _carAnim, if (useGoogleMaps && !kIsWeb) _gPulse]),
      builder: (context, _) => useGoogleMaps && !kIsWeb ? _google() : _openStreetMap(context),
    );
    return widget.height == null ? map : SizedBox(height: widget.height, child: map);
  }

  /* ---- Google Maps ---- */

  static const _style = '''[
    {"featureType":"poi.business","stylers":[{"visibility":"off"}]},
    {"featureType":"poi","elementType":"labels.icon","stylers":[{"visibility":"off"}]},
    {"featureType":"transit","elementType":"labels.icon","stylers":[{"saturation":-100},{"lightness":15}]},
    {"featureType":"road","elementType":"labels.icon","stylers":[{"visibility":"off"}]}
  ]''';

  Widget _google() {
    final route = _partial(widget.route, _routeAnim.value).map((p) => gm.LatLng(p.lat, p.lng)).toList();
    final carAt = _carShown;
    final pickup = widget.pins.where((p) => p.kind == 'pickup').firstOrNull;
    final pulseT = _gPulse.value;
    final markers = <gm.Marker>{
      for (final (i, p) in widget.pins.indexed)
        if (p.kind != 'car' && p.kind != 'eta')
          gm.Marker(
            markerId: gm.MarkerId('$i-${p.kind}'),
            position: gm.LatLng(p.at.lat, p.at.lng),
            icon: _icons[p.kind] ?? gm.BitmapDescriptor.defaultMarkerWithHue(p.kind == 'drop' ? gm.BitmapDescriptor.hueViolet : gm.BitmapDescriptor.hueAzure),
            anchor: const Offset(0.5, 0.5),
            infoWindow: p.label == null ? gm.InfoWindow.noText : gm.InfoWindow(title: p.label),
          ),
      if (carAt != null)
        gm.Marker(
          markerId: const gm.MarkerId('car'),
          position: gm.LatLng(carAt.lat, carAt.lng),
          icon: _icons['car'] ?? gm.BitmapDescriptor.defaultMarkerWithHue(gm.BitmapDescriptor.hueBlue),
          anchor: const Offset(0.5, 0.5),
          rotation: _headingShown,
          flat: true,
          zIndexInt: 10,
        ),
    };
    return gm.GoogleMap(
      initialCameraPosition: gm.CameraPosition(target: gm.LatLng(campus.lat, campus.lng), zoom: 12.5),
      style: _style,
      padding: widget.padding,
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      mapToolbarEnabled: false,
      compassEnabled: false,
      trafficEnabled: true,
      rotateGesturesEnabled: false,
      tiltGesturesEnabled: false,
      scrollGesturesEnabled: widget.interactive,
      zoomGesturesEnabled: widget.interactive,
      onMapCreated: (c) {
        _g = c;
        Future.delayed(const Duration(milliseconds: 200), _fit);
      },
      markers: markers,
      circles: {
        if (pickup != null)
          gm.Circle(
            circleId: const gm.CircleId('pulse'),
            center: gm.LatLng(pickup.at.lat, pickup.at.lng),
            radius: 40 + 160 * pulseT,
            fillColor: RS.primary.withValues(alpha: 0.18 * (1 - pulseT)),
            strokeWidth: 0,
          ),
      },
      polylines: {
        for (final (i, r) in widget.altRoutes.indexed)
          gm.Polyline(polylineId: gm.PolylineId('alt$i'), points: r.map((p) => gm.LatLng(p.lat, p.lng)).toList(), color: const Color(0xFFA99EF2), width: 4, zIndex: 1),
        if (route.length > 1) ...{
          gm.Polyline(polylineId: const gm.PolylineId('casing'), points: route, color: Colors.white, width: 9, zIndex: 2, jointType: gm.JointType.round, startCap: gm.Cap.roundCap, endCap: gm.Cap.roundCap),
          gm.Polyline(polylineId: const gm.PolylineId('route'), points: route, color: routeBlue, width: 5, zIndex: 3, jointType: gm.JointType.round, startCap: gm.Cap.roundCap, endCap: gm.Cap.roundCap),
          if (_routeAnim.value >= 1)
            for (final (i, t) in _stretches().indexed)
              gm.Polyline(polylineId: gm.PolylineId('traffic$i'), points: t.$1.map((p) => gm.LatLng(p.lat, p.lng)).toList(), color: t.$2, width: 5, zIndex: 4, jointType: gm.JointType.round),
        },
      },
    );
  }

  /* ---- OpenStreetMap ---- */

  Widget _marker(MapPin p, {double heading = 0}) {
    switch (p.kind) {
      case 'car':
        return Container(
          decoration: BoxDecoration(color: RS.primary, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(blurRadius: 8, color: Color(0x5515182E))]),
          child: Transform.rotate(angle: heading * math.pi / 180, child: const Icon(Icons.navigation_rounded, color: Colors.white, size: 18)),
        );
      case 'drop':
        return Container(
          decoration: BoxDecoration(color: RS.primary, borderRadius: BorderRadius.circular(4), border: Border.all(color: Colors.white, width: 4), boxShadow: const [BoxShadow(blurRadius: 6, color: Color(0x5515182E))]),
        );
      case 'me':
        return Container(decoration: BoxDecoration(color: RS.secondary, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)));
      default:
        return Container(
          decoration: BoxDecoration(color: RS.ink900, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 4), boxShadow: const [BoxShadow(blurRadius: 6, color: Color(0x5515182E))]),
        );
    }
  }

  Widget _openStreetMap(BuildContext context) {
    final route = _partial(widget.route, _routeAnim.value).map((p) => ll.LatLng(p.lat, p.lng)).toList();
    final carAt = _carShown;
    final pickup = widget.pins.where((p) => p.kind == 'pickup').firstOrNull;
    // Street map from the RideSync server (TomTom → MapTiler → OpenStreetMap, fetched with the
    // server's keys): map services refuse keyless requests from apps ("API key required").
    final cfg = context.select<Session, (String, String?)>((s) => (s.api.mapTileUrl, s.config?.tileAttribution));
    final traffic = context.select<Session, String?>((s) => s.config?.traffic == true ? s.api.trafficTileUrl : null);
    // Only for an older RideSync server without /api/tiles.
    const carto = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
    final tileUrl = _tilesFailed ? carto : cfg.$1;
    final credit = (cfg.$2 ?? '© OpenStreetMap · CARTO').replaceAll(RegExp(r'<[^>]+>'), '');
    return fm.FlutterMap(
      mapController: _osm,
      options: fm.MapOptions(
        initialCenter: ll.LatLng(campus.lat, campus.lng),
        initialZoom: 12.5,
        interactionOptions: fm.InteractionOptions(flags: widget.interactive ? fm.InteractiveFlag.all & ~fm.InteractiveFlag.rotate : fm.InteractiveFlag.none),
        onMapReady: () {
          _osmReady = true;
          _fit();
        },
      ),
      children: [
        fm.TileLayer(
          urlTemplate: tileUrl,
          // The server has no map tiles (older version) → CARTO instead of empty tiles.
          errorTileCallback: (_, _, _) {
            if (tileUrl != carto && ++_tileErrors == 4 && mounted) setState(() => _tilesFailed = true);
          },
          subdomains: const ['a', 'b', 'c', 'd'],
          userAgentPackageName: 'com.ridesync.ridesync',
          retinaMode: fm.RetinaMode.isHighDensity(context),
        ),
        // Live traffic colours (green / orange / red), refreshed every 2 minutes.
        if (traffic != null)
          Opacity(
            opacity: 0.85,
            child: fm.TileLayer(
              key: ValueKey(DateTime.now().millisecondsSinceEpoch ~/ 120000),
              urlTemplate: traffic,
              minZoom: 10,
              maxNativeZoom: 18,
              userAgentPackageName: 'com.ridesync.ridesync',
              evictErrorTileStrategy: fm.EvictErrorTileStrategy.dispose,
            ),
          ),
        fm.PolylineLayer(polylines: [
          for (final r in widget.altRoutes) fm.Polyline(points: r.map((p) => ll.LatLng(p.lat, p.lng)).toList(), strokeWidth: 4, color: const Color(0xFFA99EF2)),
          if (route.length > 1) ...[
            fm.Polyline(points: route, strokeWidth: 9, color: Colors.white),
            fm.Polyline(points: route, strokeWidth: 5, color: routeBlue),
            // Traffic colours appear once the route has finished drawing.
            if (_routeAnim.value >= 1)
              for (final t in _stretches()) fm.Polyline(points: t.$1.map((p) => ll.LatLng(p.lat, p.lng)).toList(), strokeWidth: 5, color: t.$2),
          ],
        ]),
        fm.MarkerLayer(markers: [
          if (pickup != null)
            fm.Marker(
              point: ll.LatLng(pickup.at.lat, pickup.at.lng),
              width: 80,
              height: 80,
              child: AnimatedBuilder(
                animation: _pulse,
                builder: (_, _) {
                  final t = _pulse.value;
                  return Center(
                    child: Container(
                      width: 20 + 56 * t,
                      height: 20 + 56 * t,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: RS.primary.withValues(alpha: 0.22 * (1 - t))),
                    ),
                  );
                },
              ),
            ),
          for (final p in widget.pins)
            if (p.kind != 'car' && p.kind != 'eta') fm.Marker(point: ll.LatLng(p.at.lat, p.at.lng), width: 20, height: 20, child: _marker(p)),
          // Labels above pins, and the time bubble on the route.
          for (final p in widget.pins)
            if (p.label != null && (p.kind == 'pickup' || p.kind == 'drop'))
              fm.Marker(point: ll.LatLng(p.at.lat, p.at.lng), width: 170, height: 76, alignment: Alignment.topCenter, child: Padding(padding: const EdgeInsets.only(bottom: 16), child: _PinLabel(p))),
          for (final p in widget.pins)
            if (p.kind == 'eta') fm.Marker(point: ll.LatLng(p.at.lat, p.at.lng), width: 160, height: 64, alignment: Alignment.topCenter, child: _EtaBubble(p)),
          if (carAt != null) fm.Marker(point: ll.LatLng(carAt.lat, carAt.lng), width: 38, height: 38, child: _marker(const MapPin(LatLngPoint(0, 0), 'car'), heading: _headingShown)),
        ]),
        fm.SimpleAttributionWidget(source: Text(credit)),
      ],
    );
  }
}
