import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/checkout.dart';
import '../util/format.dart';
import '../util/geo.dart';
import '../widgets/common.dart';
import '../widgets/map_sheet.dart';
import '../widgets/motion.dart';
import '../widgets/ride_card.dart';
import '../widgets/ride_map.dart';
import '../widgets/safety.dart';
import '../widgets/trip_time.dart';
import 'chat.dart';
import 'drive.dart';
import 'find.dart';

Future<void> openUrl(BuildContext context, String url, {String? failure}) async {
  final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication).catchError((_) => false);
  if (!ok && context.mounted) toast(context, failure ?? 'Couldn’t open that on this phone.');
}

String upiLink(String pa, String pn, int amount, String note) {
  final q = {'pa': pa, 'pn': pn, 'am': amount.toStringAsFixed(2), 'cu': 'INR', 'tn': note.length > 60 ? note.substring(0, 60) : note};
  return 'upi://pay?${q.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value)}').join('&')}';
}

Future<void> shareRide(BuildContext context, Ride ride, String driverName) async {
  final server = context.read<Session>().server;
  final text = 'RideSync: $driverName is driving ${ride.origin.name} → ${ride.destination.name}, ${when(ride.departAt)} · ${money(ride.farePerSeat)}/seat. '
      'Open RideSync to book: $server/ride/${ride.id}';
  try {
    await SharePlus.instance.share(ShareParams(text: text, subject: 'Ride on RideSync'));
  } catch (_) {
    if (context.mounted) toast(context, 'Couldn’t open sharing on this phone.');
  }
}

/* ==========================================================================
   Ride details (before booking)
   ========================================================================== */

class RideDetailsScreen extends StatefulWidget {
  const RideDetailsScreen({super.key, required this.rideId, this.match});
  final String rideId;
  final MatchResult? match;
  @override
  State<RideDetailsScreen> createState() => _RideDetailsScreenState();
}

class _RideDetailsScreenState extends State<RideDetailsScreen> {
  bool _requesting = false;

  SearchQuery _queryFor(Ride ride) {
    final last = context.read<Session>().lastQuery;
    return last ?? SearchQuery(pickup: ride.origin, drop: ride.destination, at: ride.departAt);
  }

  Future<void> _request(Ride ride, PublicUser driver) async {
    final note = TextEditingController();
    final send = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(sheet).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Request a seat', style: RS.heading(20)),
          const SizedBox(height: 6),
          Text('${driver.firstName} gets your request instantly. You’ll be notified when they accept.', style: const TextStyle(color: RS.ink500)),
          const SizedBox(height: 16),
          TextField(controller: note, maxLength: 140, decoration: const InputDecoration(labelText: 'Message to driver (optional)', hintText: 'e.g. I’ll be at the main gate')),
          const SizedBox(height: 8),
          FilledButton(onPressed: () => Navigator.pop(sheet, true), child: const Text('Send request')),
        ]),
      ),
    );
    if (send != true || !mounted) return;
    setState(() => _requesting = true);
    final api = context.read<Session>().api;
    try {
      final b = await api.requestSeat(ride.id, _queryFor(ride), note.text.trim());
      if (!mounted) return;
      await showMoment(context, Moment.sent, 'Ride requested successfully', subtitle: 'Waiting for ${driver.firstName} to accept…');
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => TripScreen(bookingId: b.id)));
    } catch (e) {
      if (mounted) {
        toast(context, errorText(e));
        setState(() => _requesting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = context.read<Session>().user!;
    return LiveLoader<RideDetail>(
      refreshable: false,
      loading: MapSheetScaffold(map: (pad) => RideMap(padding: pad), children: const [SizedBox(height: 260, child: SkeletonList(count: 1))]),
      load: (api) => api.ride(widget.rideId),
      builder: (context, d, reload) {
        final ride = d.ride;
        final m = widget.match;
        final mine = ride.driverId == me.id;
        final booking = d.myBooking;
        final arrive = ride.departAt.add(Duration(minutes: ride.durationMin));
        final q = context.read<Session>().lastQuery;
        final Widget footer = mine
            ? LoadingButton(label: 'Manage your ride', icon: Icons.directions_car, onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => DriveScreen(rideId: ride.id))))
            : booking != null && booking.isActive
                ? LoadingButton(label: 'View your booking', onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => TripScreen(bookingId: booking.id))))
                : ride.status != 'scheduled'
                    ? const LoadingButton(label: 'This ride is no longer open', onPressed: null)
                    : ride.seatsLeft <= 0
                        ? const LoadingButton(label: 'Full', onPressed: null)
                        : LoadingButton(label: 'Request seat · ${money(m?.fare ?? ride.farePerSeat)}', loading: _requesting, onPressed: () => _request(ride, d.driver));
        return MapSheetScaffold(
          initialSize: 0.55,
          topActions: [FloatingMapButton(icon: Icons.ios_share_rounded, onTap: () => shareRide(context, ride, d.driver.name))],
          map: (pad) => RideMap(
            padding: pad,
            route: ride.route,
            pins: [
              MapPin(ride.origin.point, 'pickup', label: ride.origin.name),
              MapPin(ride.destination.point, 'drop', label: ride.destination.name),
              if (m != null && q != null) MapPin(q.pickup.point, 'me', label: 'Your pickup'),
            ],
          ),
          footer: footer,
          children: [
            Row(children: [
              Expanded(child: Text(when(ride.departAt), style: RS.heading(22))),
              Text(money(m?.fare ?? ride.farePerSeat), style: RS.heading(24, color: RS.primary)),
            ]),
            Text('${km(ride.distanceKm)} · about ${minutes(ride.durationMin)} · per seat', style: const TextStyle(color: RS.ink500)),
            const SizedBox(height: 16),
            FadeSlideIn(child: Panel(child: RouteLine(from: ride.origin, to: ride.destination, fromTime: timeOf(ride.departAt), toTime: timeOf(arrive)))),
            const SizedBox(height: 12),
            FadeSlideIn(
              index: 1,
              child: Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  DriverRow(driver: d.driver, vehicle: d.vehicle),
                  const SizedBox(height: 12),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (ride.womenOnly) const WomenOnlyPill(),
                    if (m?.aiChance != null) AiChancePill(m!.aiChance!),
                    Pill('${ride.seatsLeft} of ${ride.seatsTotal} seats left', icon: Icons.event_seat_outlined),
                    if (d.driver.ridesOffered > 0) Pill('${d.driver.ridesOffered} rides driven', color: RS.ink700, background: RS.sunken),
                    if (d.driver.ratingCount > 0) Pill('${(d.driver.completionRate * 100).round()}% completed', color: RS.ink700, background: RS.sunken),
                    for (final p in ride.preferences) Pill(preferenceLabel[p] ?? p, color: RS.ink700, background: RS.sunken),
                  ]),
                  if (ride.note != null) ...[const SizedBox(height: 12), Text('“${ride.note}”', style: const TextStyle(color: RS.ink700, fontStyle: FontStyle.italic))],
                ]),
              ),
            ),
            if (m != null) ...[
              const SizedBox(height: 12),
              FadeSlideIn(
                index: 2,
                child: Panel(
                  onTap: () => showWhyMatch(context, m),
                  child: Row(children: [
                    const Icon(Icons.auto_awesome, color: RS.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('Why this ride?', style: TextStyle(fontWeight: FontWeight.w700)),
                        Text(m.reasons.isNotEmpty ? m.reasons.first : 'See how RideSync AI matched it', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: RS.ink500, fontSize: 13)),
                      ]),
                    ),
                    MatchBadge(score: m.score, tier: m.tier),
                  ]),
                ),
              ),
              const SizedBox(height: 10),
              Text('Pickup ${km(m.pickupDistanceKm)} from you · drop ${km(m.dropDistanceKm)} from your destination', style: const TextStyle(color: RS.ink500, fontSize: 13)),
            ],
            const SizedBox(height: 16),
            const Row(children: [
              Icon(Icons.verified_user_outlined, size: 18, color: RS.success),
              SizedBox(width: 8),
              Expanded(child: Text('Verified VIT student. Phone numbers are shared only after a seat is confirmed.', style: TextStyle(color: RS.ink500, fontSize: 13))),
            ]),
          ],
        );
      },
    );
  }
}

/* ==========================================================================
   Trip — one booking, live like Ola/Uber: car on the map, ETA, status, pay, rate
   ========================================================================== */

class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.bookingId});
  final String bookingId;
  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  DriverLocation? _car;
  StreamSubscription<(String, DriverLocation)>? _loc;
  String? _rideId;

  // Traffic-aware ETA from the server, refreshed when the car moves ~300 m or every 90 s.
  ({LiveEta eta, LatLngPoint from, LatLngPoint to, DateTime at})? _eta;
  bool _etaBusy = false;

  void _refreshEta(LatLngPoint? from, LatLngPoint? to) {
    if (from == null || to == null || _etaBusy) return;
    final e = _eta;
    final fresh = e != null && e.to.lat == to.lat && e.to.lng == to.lng && haversineKm(e.from, from) < 0.3 && DateTime.now().difference(e.at).inSeconds < 90;
    if (fresh) return;
    _etaBusy = true;
    context.read<Session>().api.eta(from, to, route: true).then((r) {
      if (mounted) setState(() => _eta = (eta: r, from: from, to: to, at: DateTime.now()));
    }).catchError((_) {}).whenComplete(() => _etaBusy = false);
  }

  // The rider's own live location for the driver, until pickup (Uber/Ola style).
  StreamSubscription<Position>? _share;
  String? _shareFor;
  bool _paused = false;
  String _shareState = 'off'; // off | waiting | live | blocked | paused
  ({DateTime at, LatLngPoint point})? _lastSent;

  /// Rider shares while the driver is coming or waiting, or from 30 min before a confirmed ride.
  static bool shouldShare(BookingDetail d, DateTime now) =>
      d.isRider &&
      (const ['driver_arriving', 'driver_arrived'].contains(d.booking.status) || (d.booking.status == 'confirmed' && d.ride.departAt.difference(now).inMinutes < 30));

  void _syncSharing(BookingDetail d) {
    if (!mounted) return;
    final active = shouldShare(d, DateTime.now()) && !_paused;
    if (!active) {
      _stopShare();
      final next = _paused && shouldShare(d, DateTime.now()) ? 'paused' : 'off';
      if (next != _shareState) setState(() => _shareState = next);
      return;
    }
    if (_shareFor != null || _shareState == 'blocked') return;
    _startShare(d.booking.id);
  }

  Future<void> _startShare(String bookingId) async {
    _shareFor = bookingId;
    setState(() => _shareState = 'waiting');
    final api = context.read<Session>().api;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'off';
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) throw 'denied';
      if (!mounted || _shareFor != bookingId || _share != null) return;
      _share = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)).listen((p) {
        final here = LatLngPoint(p.latitude, p.longitude);
        final last = _lastSent;
        if (mounted && _shareState != 'live') setState(() => _shareState = 'live');
        if (last == null || DateTime.now().difference(last.at).inSeconds >= 5 || haversineKm(last.point, here) * 1000 > 25) {
          _lastSent = (at: DateTime.now(), point: here);
          api.riderLocation(bookingId, p.latitude, p.longitude, p.accuracy).catchError((_) {});
        }
      }, onError: (_) => mounted ? setState(() => _shareState = 'waiting') : null);
    } catch (_) {
      if (mounted) setState(() => _shareState = 'blocked');
    }
  }

  void _stopShare() {
    _share?.cancel();
    _share = null;
    _shareFor = null;
    _lastSent = null;
  }

  void _togglePause(BookingDetail d) {
    setState(() => _paused = !_paused);
    _syncSharing(d);
  }

  @override
  void initState() {
    super.initState();
    _loc = context.read<Session>().events?.onLocation.listen((e) {
      if (e.$1 == _rideId && mounted) setState(() => _car = e.$2);
    });
  }

  @override
  void dispose() {
    _loc?.cancel();
    _stopShare();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LiveLoader<BookingDetail>(
        refreshable: false,
        loading: MapSheetScaffold(map: (pad) => RideMap(padding: pad), children: const [SizedBox(height: 260, child: SkeletonList(count: 1))]),
        load: (api) async {
          final d = await api.booking(widget.bookingId);
          _rideId = d.ride.id;
          return d;
        },
        builder: (context, d, reload) {
          final car = _car ?? d.ride.driverLocation;
          final from = car == null ? null : LatLngPoint(car.lat, car.lng);
          final to = switch (d.booking.status) { 'driver_arriving' => d.booking.pickup.point, 'in_progress' => d.booking.drop.point, _ => null };
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _refreshEta(from, to);
            _syncSharing(d);
          });
          final e = _eta;
          final live = e != null && to != null && from != null && e.to.lat == to.lat && e.to.lng == to.lng ? e : null;
          return _TripView(
            detail: d,
            car: car,
            share: _shareState,
            onToggleShare: () => _togglePause(d),
            // Minus the distance already covered since the last check, so it keeps counting down.
            liveEta: live == null ? null : (minutes: math.max(1, live.eta.durationMin - (haversineKm(live.from, from!) * 1.2 / 22 * 60).round()), traffic: live.eta.traffic, delay: live.eta.trafficDelayMin, coords: live.eta.coords, segments: live.eta.segments),
          );
        },
      );
}

class _TripView extends StatelessWidget {
  const _TripView({required this.detail, required this.car, this.liveEta, this.share = 'off', this.onToggleShare});
  final BookingDetail detail;
  final DriverLocation? car;

  /// Rider's own live location for the driver: off | waiting | live | blocked | paused.
  final String share;
  final VoidCallback? onToggleShare;
  final ({int minutes, String? traffic, int delay, List<LatLngPoint> coords, List<TrafficSegment> segments})? liveEta;

  static const _steps = ['pending', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed'];

  @override
  Widget build(BuildContext context) {
    final b = detail.booking;
    final ride = detail.ride;
    final other = detail.isRider ? detail.driver : detail.rider;
    final phone = detail.isRider ? detail.driverPhone : detail.riderPhone;
    final live = const ['driver_arriving', 'driver_arrived', 'in_progress'].contains(b.status);
    final carPoint = car == null ? null : LatLngPoint(car!.lat, car!.lng);
    final stepIndex = _steps.indexOf(b.status == 'accepted' ? 'pending' : b.status);
    final eta = carPoint == null
        ? null
        : switch (b.status) {
            'driver_arriving' => liveEta?.minutes ?? etaMinutes(carPoint, b.pickup.point),
            'in_progress' => liveEta?.minutes ?? etaMinutes(carPoint, b.drop.point),
            _ => null,
          };
    final traffic = eta == null ? null : liveEta?.traffic;
    // Family can follow the car live from the moment the seat is accepted.
    final canShareLive = const ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress'].contains(b.status);

    return MapSheetScaffold(
      initialSize: live ? 0.42 : 0.55,
      minSize: 0.28,
      topActions: [
        if (live && detail.isRider) _SosButton(detail: detail, car: carPoint),
        if (live) FloatingMapButton(icon: Icons.share_location_rounded, onTap: () => showShareTripSheet(context, b.id)),
      ],
      map: (pad) => RideMap(
        padding: pad,
        // The road ahead with live traffic colours when available, else the planned route.
        route: live && (liveEta?.coords.length ?? 0) > 1 ? liveEta!.coords : ride.route,
        traffic: live && (liveEta?.coords.length ?? 0) > 1 ? liveEta!.segments : const [],
        follow: live ? carPoint : null,
        pins: [
          MapPin(b.pickup.point, 'pickup', label: b.pickup.name, sublabel: b.status == 'driver_arriving' && eta != null ? '${detail.driver.firstName} in $eta min' : null),
          MapPin(b.drop.point, 'drop', label: b.drop.name, sublabel: b.status == 'in_progress' && eta != null ? 'Arrive ~${timeOf(DateTime.now().add(Duration(minutes: eta)))}' : null),
          if (carPoint != null && live) MapPin(carPoint, 'car', heading: car!.heading),
          // Time bubble between the car and where it's heading.
          if (carPoint != null && eta != null && traffic != null)
            MapPin(
              LatLngPoint((carPoint.lat + (b.status == 'in_progress' ? b.drop : b.pickup).lat) / 2, (carPoint.lng + (b.status == 'in_progress' ? b.drop : b.pickup).lng) / 2),
              'eta',
              label: '$eta min',
              sublabel: traffic == 'light' ? 'Light traffic' : '+${liveEta!.delay} min traffic',
              tone: traffic,
            ),
        ],
      ),
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 350),
          transitionBuilder: (c, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0, 0.2), end: Offset.zero).animate(a), child: c)),
          child: Row(
            key: ValueKey(b.status + (eta?.toString() ?? '')),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (live) const Padding(padding: EdgeInsets.only(top: 4, right: 4), child: LiveDot()),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(eta != null ? (b.status == 'driver_arriving' ? 'Arriving in $eta min' : '$eta min to ${b.drop.name}') : (bookingStatusLabel[b.status] ?? b.status), style: RS.heading(22)),
                  const SizedBox(height: 4),
                  Text(_subtitle(b, ride, detail), style: const TextStyle(color: RS.ink500, height: 1.4)),
                  if (detail.isRider && b.status == 'driver_arrived' && b.arrivedAt != null) ...[
                    const SizedBox(height: 4),
                    WaitedBuilder(
                      since: b.arrivedAt!,
                      builder: (_, waited) => Text(
                        waited < freeWaitSeconds
                            ? 'Waiting ${mmss(waited)} · please reach within ${mmss(freeWaitSeconds - waited)}'
                            : '${detail.driver.firstName} has waited ${mmss(waited)} — hurry, or call so they don’t leave.',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: waited < freeWaitSeconds ? RS.warning : RS.danger),
                      ),
                    ),
                  ],
                  if (traffic != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      traffic == 'light' ? 'Light traffic · live' : '${traffic == 'heavy' ? 'Heavy' : 'Some'} traffic · +${liveEta!.delay} min · live',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: traffic == 'heavy' ? RS.danger : traffic == 'moderate' ? RS.warning : RS.success),
                    ),
                  ],
                ]),
              ),
            ],
          ),
        ),
        if (b.isActive && stepIndex >= 0) ...[
          const SizedBox(height: 14),
          Row(children: [
            for (var i = 0; i < _steps.length; i++)
              Expanded(
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: i <= stepIndex ? 1 : 0),
                  duration: Duration(milliseconds: 400 + i * 80),
                  builder: (_, v, _) => Container(
                    height: 4,
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    decoration: BoxDecoration(color: Color.lerp(RS.sunken, RS.primary, v), borderRadius: BorderRadius.circular(9)),
                  ),
                ),
              ),
          ]),
        ],
      ]),
      children: [
        if (detail.isRider && share != 'off') ...[const SizedBox(height: 12), RiderLiveBar(state: share, driver: detail.driver.firstName, onToggle: onToggleShare)],
        if (live && carPoint == null && detail.isRider) ...[const SizedBox(height: 12), const Notice('Waiting for the driver’s location… it appears once their app shares GPS.')],
        if (detail.isRider && detail.ridePin != null) ...[const SizedBox(height: 14), FadeSlideIn(child: RidePinCard(pin: detail.ridePin!))],
        if (detail.isRider && const ['confirmed', 'driver_arriving', 'driver_arrived'].contains(b.status)) ...[
          const SizedBox(height: 14),
          Panel(
            child: Row(children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: RS.ink900, borderRadius: BorderRadius.circular(8)),
                child: Text(detail.vehicle.plate, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, letterSpacing: 1)),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(detail.vehicle.title, style: const TextStyle(fontWeight: FontWeight.w600))),
              const Icon(Icons.directions_car_filled_rounded, color: RS.primary),
            ]),
          ),
        ],
        const SizedBox(height: 12),
        Panel(
          child: Column(children: [
            DriverRow(driver: other, vehicle: detail.isRider ? detail.vehicle : null),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(bookingId: b.id, other: other))),
                  icon: const Icon(Icons.chat_bubble_outline, size: 18),
                  label: const Text('Message'),
                ),
              ),
              if (phone != null) ...[
                const SizedBox(width: 10),
                Expanded(child: OutlinedButton.icon(onPressed: () => openUrl(context, 'tel:+91$phone'), icon: const Icon(Icons.call_outlined, size: 18), label: const Text('Call'))),
              ],
            ]),
          ]),
        ),
        const SizedBox(height: 12),
        Panel(child: RouteLine(from: b.pickup, to: b.drop, fromTime: timeOf(ride.departAt))),
        const SizedBox(height: 12),
        Panel(
          child: Row(children: [
            const Icon(Icons.payments_outlined, color: RS.ink700),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${money(b.fare)} · ${b.seats} seat${b.seats == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(paymentLabel(b.paymentMethod, b.paymentStatus), style: const TextStyle(color: RS.ink500, fontSize: 13)),
              ]),
            ),
            if (b.isPaid) const Icon(Icons.check_circle, color: RS.success),
          ]),
        ),
        const SizedBox(height: 16),
        ..._actions(context, detail),
        const SizedBox(height: 8),
        if (canShareLive) ...[
          OutlinedButton.icon(onPressed: () => showShareTripSheet(context, b.id), icon: const Icon(Icons.share_location_rounded, size: 18), label: const Text('Share trip')),
          const SizedBox(height: 4),
        ],
        TextButton.icon(onPressed: () => shareRide(context, ride, detail.driver.name), icon: const Icon(Icons.ios_share_rounded, size: 18), label: const Text('Share trip details')),
      ],
    );
  }

  String _subtitle(Booking b, Ride ride, BookingDetail d) => switch (b.status) {
        'pending' => '${d.driver.firstName} will accept or decline soon. You’ll get a notification.',
        'accepted' => '${d.driver.firstName} accepted! Choose how you’ll pay to confirm your seat.',
        'confirmed' => 'Be at ${b.pickup.name} by ${timeOf(ride.departAt)}. You can track the car here once the ride starts.',
        'driver_arriving' => '${d.driver.firstName} is on the way to ${b.pickup.name}.',
        'driver_arrived' => '${d.driver.firstName} is at ${b.pickup.name}. Look for the ${d.vehicle.title} (${d.vehicle.plate}).',
        'in_progress' => 'On the way to ${b.drop.name}. Enjoy the ride!',
        'completed' => 'Thanks for sharing the ride — you saved money and CO₂.',
        'rejected' => 'The driver couldn’t take this request. Try another match.',
        'cancelled' => b.cancelReason ?? 'This booking was cancelled.',
        _ => '',
      };

  List<Widget> _actions(BuildContext context, BookingDetail d) {
    final b = d.booking;
    final api = context.read<Session>().api;
    final out = <Widget>[];
    if (d.isRider) {
      final canPay = const ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed'].contains(b.status) && !b.isPaid && b.paymentStatus != 'refunded';
      if (canPay && !(b.paymentMethod == 'cash' && b.status != 'accepted')) {
        out.add(LoadingButton(label: b.status == 'accepted' ? 'Confirm seat & choose payment' : 'Pay ${money(b.fare)}', icon: Icons.payments, onPressed: () => showPaySheet(context, d)));
      }
      if (b.status == 'completed' && b.riderRating == null) out.add(LoadingButton(label: 'Rate ${d.driver.firstName}', icon: Icons.star_rounded, onPressed: () => showRateSheet(context, b.id, d.driver.firstName, photo: d.driver.photo)));
      if (const ['pending', 'accepted', 'confirmed'].contains(b.status)) {
        out.add(const SizedBox(height: 10));
        out.add(LoadingButton(label: 'Cancel booking', secondary: true, danger: true, onPressed: () => _cancel(context, () => api.cancelBooking(b.id))));
      }
    } else {
      out.add(LoadingButton(label: 'Open ride controls', icon: Icons.directions_car, onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DriveScreen(rideId: d.ride.id)))));
      if (b.status == 'completed' && b.driverRating == null) {
        out.add(const SizedBox(height: 10));
        out.add(LoadingButton(label: 'Rate ${d.rider.firstName}', secondary: true, icon: Icons.star_rounded, onPressed: () => showRateSheet(context, b.id, d.rider.firstName, photo: d.rider.photo, ratingDriver: false)));
      }
    }
    if (b.status == 'rejected' || b.status == 'cancelled') {
      out.add(LoadingButton(label: 'Find another ride', secondary: true, onPressed: () => Navigator.popUntil(context, (r) => r.isFirst)));
    }
    return out;
  }

  Future<void> _cancel(BuildContext context, Future<void> Function() action) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Cancel this booking?'),
        content: const Text('The driver will be notified. Please cancel early so they can offer the seat to someone else. Online payments are refunded automatically.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(c, true), style: TextButton.styleFrom(foregroundColor: RS.danger), child: const Text('Cancel booking')),
        ],
      ),
    );
    if (ok == true && context.mounted && await attempt(context, action) && context.mounted) await showMoment(context, Moment.cancelled, 'Booking cancelled', subtitle: 'The driver has been told. Online payments are refunded.');
  }
}

/// "Sara can see where you are until pickup · Stop" — the rider's live location status.
class RiderLiveBar extends StatelessWidget {
  const RiderLiveBar({super.key, required this.state, required this.driver, this.onToggle});
  final String state;
  final String driver;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final on = state == 'live' || state == 'waiting';
    final (fg, bg) = on ? (RS.success, RS.success50) : (RS.warning, RS.warning50);
    final text = switch (state) {
      'live' => '$driver can see where you are until pickup',
      'waiting' => 'Finding your location…',
      'paused' => 'Live location paused — $driver sees your pickup pin',
      _ => 'Location is blocked. Allow it for RideSync in Settings so $driver can find you.',
    };
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
      constraints: const BoxConstraints(minHeight: 48),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(RS.radiusMd)),
      child: Row(children: [
        Icon(on ? Icons.my_location : Icons.location_disabled_outlined, color: fg, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: fg, fontWeight: FontWeight.w600, fontSize: 13.5, height: 1.35))),
        if (state != 'blocked' && onToggle != null) TextButton(onPressed: onToggle, child: Text(state == 'paused' ? 'Share' : 'Stop')),
      ]),
    );
  }
}

class _SosButton extends StatelessWidget {
  const _SosButton({required this.detail, required this.car});
  final BookingDetail detail;
  final LatLngPoint? car;
  @override
  Widget build(BuildContext context) {
    final user = context.read<Session>().user!;
    final v = detail.vehicle;
    return Material(
      color: RS.danger,
      borderRadius: BorderRadius.circular(999),
      elevation: 3,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => showModalBottomSheet<void>(
          context: context,
          builder: (sheet) {
            final loc = car == null ? '' : ' Location: https://maps.google.com/?q=${car!.lat},${car!.lng}';
            final body = Uri.encodeComponent('SOS from ${user.name}: I’m in a RideSync carpool with ${detail.driver.name}, ${v.color} ${v.model} ${v.plate}.$loc');
            final contacts = user.emergencyContacts.map((c) => '+91${c.phone}').join(',');
            return SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Safety', style: RS.heading(20))),
                ListTile(leading: const Icon(Icons.local_police_outlined, color: RS.danger), title: const Text('Call 112 (emergency)'), onTap: () => openUrl(context, 'tel:112')),
                if (contacts.isNotEmpty)
                  ListTile(leading: const Icon(Icons.sms_outlined), title: const Text('Text my emergency contacts'), subtitle: const Text('Sends your ride details and live location'), onTap: () => openUrl(context, 'sms:$contacts?body=$body'))
                else
                  const ListTile(leading: Icon(Icons.info_outline), title: Text('Add emergency contacts in Profile → Safety')),
                ListTile(
                  leading: const Icon(Icons.share_location_rounded),
                  title: const Text('Share my live trip'),
                  subtitle: const Text('Family can follow the car on a link'),
                  onTap: () {
                    Navigator.pop(sheet);
                    showShareTripSheet(context, detail.booking.id);
                  },
                ),
                const SizedBox(height: 8),
              ]),
            );
          },
        ),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.sos_rounded, color: Colors.white, size: 20), SizedBox(width: 6), Text('SOS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800))]),
        ),
      ),
    );
  }
}

/* ---- Payment ---- */

void showPaySheet(BuildContext context, BookingDetail d) {
  final b = d.booking;
  final session = context.read<Session>();
  final api = session.api;
  final upi = d.driverUpiId;
  final razorpayKey = session.config?.razorpayKeyId;

  Future<void> afterUpi() async {
    final paid = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Did the payment go through?'),
        content: Text('Only confirm after your UPI app shows ${money(b.fare)} sent to $upi.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not yet')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Yes, I paid')),
        ],
      ),
    );
    if (paid == true && context.mounted && await attempt(context, () => api.pay(b.id, 'upi')) && context.mounted) {
      await showSuccess(context, 'Payment recorded', subtitle: '${d.driver.firstName} will confirm it’s received.');
    }
  }

  Widget option(IconData icon, String title, String subtitle, VoidCallback? onTap, {bool highlight = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Opacity(
          opacity: onTap == null ? 0.55 : 1,
          child: Panel(
          onTap: onTap,
          child: Row(children: [
            CircleAvatar(backgroundColor: highlight ? RS.primary : RS.primary50, child: Icon(icon, color: highlight ? Colors.white : RS.primary)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(subtitle, style: const TextStyle(color: RS.ink500, fontSize: 13)),
              ]),
            ),
            if (onTap != null) const Icon(Icons.chevron_right),
          ]),
        ),
        ),
      );

  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Pay ${money(b.fare)}', style: RS.heading(24)),
          const SizedBox(height: 4),
          Text(razorpayKey != null ? 'Pay from your wallet or online, or pay ${d.driver.firstName} directly.' : 'You pay ${d.driver.firstName} directly. RideSync never holds your money.', style: const TextStyle(color: RS.ink500)),
          const SizedBox(height: 18),
          if (!kIsWeb)
            FutureBuilder<WalletInfo>(
              future: api.wallet(),
              builder: (_, snap) {
                final w = snap.data;
                if (w == null || (!w.canTopUp && w.balance == 0)) return const SizedBox.shrink();
                final short = b.fare - w.balance;
                return option(
                  Icons.account_balance_wallet,
                  'RideSync Wallet',
                  short > 0 ? 'Balance ${money(w.balance)} · add ${money(short)} to pay' : 'Balance ${money(w.balance)} · instant · refunded to wallet if cancelled',
                  short > 0 && !w.canTopUp
                      ? null
                      : () {
                          Navigator.pop(sheet);
                          _payWallet(context, d, w);
                        },
                  highlight: true,
                );
              },
            ),
          if (razorpayKey != null && !kIsWeb)
            option(Icons.lock_outline, 'Pay online', 'UPI, cards, netbanking · secured by Razorpay · refunded if cancelled', () {
              Navigator.pop(sheet);
              _payOnline(context, d);
            }),
          if (upi != null) ...[
            option(Icons.account_balance_wallet_outlined, 'Pay by UPI app', 'Opens GPay, PhonePe or Paytm · $upi', () async {
              Navigator.pop(sheet);
              final launched = await launchUrl(Uri.parse(upiLink(upi, d.driver.name, b.fare, 'RideSync ride ${b.id}')), mode: LaunchMode.externalApplication).catchError((_) => false);
              if (!context.mounted) return;
              if (!launched) toast(context, 'No UPI app found. Pay $upi from any UPI app, then come back.');
              await afterUpi();
            }),
            option(Icons.qr_code_2, 'Show UPI QR code', 'Scan from another phone', () {
              Navigator.pop(sheet);
              showModalBottomSheet<void>(
                context: context,
                builder: (qr) => SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text('Scan to pay ${money(b.fare)}', style: RS.heading(20)),
                      const SizedBox(height: 4),
                      Text('to ${d.driver.name} · $upi', style: const TextStyle(color: RS.ink500)),
                      const SizedBox(height: 16),
                      QrImageView(data: upiLink(upi, d.driver.name, b.fare, 'RideSync ride ${b.id}'), size: 220, eyeStyle: const QrEyeStyle(color: RS.ink900, eyeShape: QrEyeShape.square), dataModuleStyle: const QrDataModuleStyle(color: RS.ink900)),
                      const SizedBox(height: 16),
                      LoadingButton(
                        label: 'I’ve paid',
                        onPressed: () {
                          Navigator.pop(qr);
                          afterUpi();
                        },
                      ),
                    ]),
                  ),
                ),
              );
            }),
          ],
          if (upi == null)
            option(Icons.account_balance_wallet_outlined, 'Pay by UPI', '${d.driver.firstName} hasn’t added a UPI ID yet — message them to add it in Profile → Payment methods', null),
          option(Icons.payments_outlined, 'Cash at pickup', 'Hand the exact amount to the driver', () async {
            Navigator.pop(sheet);
            if (await attempt(context, () => api.pay(b.id, 'cash')) && context.mounted) {
              await showSuccess(context, 'Seat confirmed', subtitle: 'Pay ${money(b.fare)} in cash at pickup.');
            }
          }),
          const SizedBox(height: 4),
          const Row(children: [
            Icon(Icons.shield_outlined, size: 16, color: RS.ink500),
            SizedBox(width: 6),
            Expanded(child: Text('RideSync never asks for your UPI PIN.', style: TextStyle(color: RS.ink500, fontSize: 12.5))),
          ]),
        ]),
      ),
    ),
  );
}

/// Razorpay checkout: the server creates the order and verifies the signature.
Future<void> _payOnline(BuildContext context, BookingDetail d) async {
  final api = context.read<Session>().api;
  Map<String, dynamic> order;
  try {
    order = await api.onlineOrder(d.booking.id);
  } catch (e) {
    if (context.mounted) toast(context, errorText(e));
    return;
  }
  if (!context.mounted) return;
  final r = await razorpayCheckout(context, order, fallbackDescription: 'Ride with ${d.driver.name}');
  if (r == null || !context.mounted) return;
  if (await attempt(context, () => api.verifyOnline(d.booking.id, r.orderId, r.paymentId, r.signature)) && context.mounted) {
    await showSuccess(context, 'Paid ${money(d.booking.fare)}', subtitle: 'Your seat is confirmed. Refunded automatically if the ride is cancelled.');
  }
}

/// Pays from the RideSync Wallet, topping up the missing amount through Razorpay first if needed.
Future<void> _payWallet(BuildContext context, BookingDetail d, WalletInfo w) async {
  final api = context.read<Session>().api;
  final fare = d.booking.fare;
  if (w.balance < fare) {
    final short = fare - w.balance;
    final added = await addMoney(context, suggested: short < 10 ? 10 : short, testMode: w.testMode);
    if (!added || !context.mounted) return;
  }
  if (await attempt(context, () => api.payFromWallet(d.booking.id)) && context.mounted) {
    await showSuccess(context, 'Paid ${money(fare)} from wallet', subtitle: 'Your seat is confirmed. Refunded to your wallet if the ride is cancelled.');
  }
}

/* ---- Rating ---- */

const ratingTags = ['Safe driving', 'Friendly', 'On time', 'Clean vehicle', 'Smooth ride'];
const riderRatingTags = ['On time', 'Friendly', 'Easy pickup', 'Respectful', 'Paid promptly'];

void showRateSheet(BuildContext context, String bookingId, String name, {String? photo, bool ratingDriver = true}) {
  var stars = 5;
  final tags = <String>{};
  final api = context.read<Session>().api;
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheet) => StatefulBuilder(
      builder: (sheet, setState) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Avatar(name: name, photo: photo, size: 64),
            const SizedBox(height: 12),
            Text('How was your ride with $name?', style: RS.heading(20), textAlign: TextAlign.center),
            const SizedBox(height: 12),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 1; i <= 5; i++)
                AnimatedScale(
                  scale: i <= stars ? 1.15 : 1,
                  duration: const Duration(milliseconds: 180),
                  child: IconButton(
                    iconSize: 40,
                    onPressed: () => setState(() => stars = i),
                    icon: Icon(i <= stars ? Icons.star_rounded : Icons.star_outline_rounded, color: const Color(0xFFF5A524)),
                  ),
                ),
            ]),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.center, children: [
              for (final t in ratingDriver ? ratingTags : riderRatingTags)
                FilterChip(label: Text(t), selected: tags.contains(t), showCheckmark: false, onSelected: (on) => setState(() => on ? tags.add(t) : tags.remove(t))),
            ]),
            const SizedBox(height: 18),
            LoadingButton(
              label: 'Submit rating',
              onPressed: () async {
                Navigator.pop(sheet);
                if (await attempt(context, () => api.rate(bookingId, stars, tags.toList())) && context.mounted) {
                  await showSuccess(context, 'Thanks for rating!', subtitle: 'Ratings keep RideSync safe and reliable.');
                }
              },
            ),
          ]),
        ),
      ),
    ),
  );
}
