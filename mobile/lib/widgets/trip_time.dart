import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../util/format.dart';
import '../util/geo.dart';
import 'ride_map.dart';

/// Trip time and arrival, with live traffic when the trip starts within 90 minutes or is under way.
typedef TripEta = ({int minutes, double km, DateTime arrive, String? traffic, int delay, List<LatLngPoint> coords, List<TrafficSegment> segments});

/// Fetches the traffic-aware trip time (every 2 minutes) and hands it to [builder].
/// Falls back to the planned route time until/unless live data arrives.
class TripEtaBuilder extends StatefulWidget {
  const TripEtaBuilder({super.key, required this.from, required this.to, required this.departAt, required this.plannedMin, required this.distanceKm, this.live = false, required this.builder});
  final LatLngPoint from;
  final LatLngPoint to;
  final DateTime departAt;
  final int plannedMin;
  final double distanceKm;
  final bool live;
  final Widget Function(BuildContext context, TripEta eta) builder;

  @override
  State<TripEtaBuilder> createState() => _TripEtaBuilderState();
}

class _TripEtaBuilderState extends State<TripEtaBuilder> {
  LiveEta? _eta;
  Timer? _timer;
  String? _key;

  bool get _soon => widget.live || widget.departAt.difference(DateTime.now()).inMinutes < 90;
  // ~1 km steps for a moving car, so live GPS doesn't trigger a lookup on every update.
  String get _k => '${widget.from.lat.toStringAsFixed(2)},${widget.from.lng.toStringAsFixed(2)}|${widget.to.lat},${widget.to.lng}';

  // Live traffic for trips starting soon; typical traffic for that hour for later ones.
  void _load() {
    final later = !_soon && widget.departAt.isAfter(DateTime.now());
    context.read<Session>().api.eta(widget.from, widget.to, route: _soon, departAt: later ? widget.departAt : null).then((r) {
      if (mounted) setState(() => _eta = r);
    }).catchError((_) {});
  }

  void _restart() {
    _key = _k;
    _timer?.cancel();
    _load();
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => _load());
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _restart());
  }

  @override
  void didUpdateWidget(TripEtaBuilder old) {
    super.didUpdateWidget(old);
    if (_k != _key) _restart();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final e = _eta;
    final mins = e?.durationMin ?? widget.plannedMin;
    final start = widget.live || widget.departAt.isBefore(DateTime.now()) ? DateTime.now() : widget.departAt;
    return widget.builder(context, (minutes: mins, km: widget.distanceKm, arrive: start.add(Duration(minutes: mins)), traffic: e?.traffic, delay: e?.trafficDelayMin ?? 0, coords: e?.coords ?? const [], segments: e?.segments ?? const []));
  }
}

/// The point `frac` of the way along a route (by distance).
LatLngPoint? pointAlong(List<LatLngPoint> coords, [double frac = 0.5]) {
  if (coords.isEmpty) return null;
  if (coords.length == 1) return coords.first;
  final seg = <double>[];
  var total = 0.0;
  for (var i = 1; i < coords.length; i++) {
    final d = haversineKm(coords[i - 1], coords[i]);
    seg.add(d);
    total += d;
  }
  var want = total * frac;
  for (var i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i == seg.length - 1) {
      final k = seg[i] == 0 ? 0.0 : (want / seg[i]).clamp(0.0, 1.0);
      return LatLngPoint(coords[i].lat + (coords[i + 1].lat - coords[i].lat) * k, coords[i].lng + (coords[i + 1].lng - coords[i].lng) * k);
    }
    want -= seg[i];
  }
  return coords.last;
}

/// The time bubble on the route: "21 min" + "Light traffic · 10 km" / "+8 min traffic" / "10 km".
MapPin? etaPin(List<LatLngPoint> route, TripEta eta, [LatLngPoint? at]) {
  final p = at ?? pointAlong(route);
  if (p == null) return null;
  final sub = switch (eta.traffic) {
    'light' => 'Light traffic · ${km(eta.km)}',
    null => km(eta.km),
    _ => '+${eta.delay} min traffic',
  };
  return MapPin(p, 'eta', label: minutes(eta.minutes), sublabel: sub, tone: eta.traffic);
}

/// Seconds since [since], ticking every second — the wait timer at pickup.
class WaitedBuilder extends StatefulWidget {
  const WaitedBuilder({super.key, required this.since, required this.builder});
  final DateTime since;
  final Widget Function(BuildContext context, int seconds) builder;
  @override
  State<WaitedBuilder> createState() => _WaitedBuilderState();
}

class _WaitedBuilderState extends State<WaitedBuilder> {
  late final Timer _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _tick.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, DateTime.now().difference(widget.since).inSeconds.clamp(0, 1 << 31));
}
