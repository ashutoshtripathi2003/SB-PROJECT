import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../data/places.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/format.dart';
import '../util/geo.dart';
import '../widgets/common.dart';
import '../widgets/place_picker.dart';
import '../widgets/ride_card.dart';
import '../widgets/map_sheet.dart';
import '../widgets/motion.dart';
import '../widgets/ride_map.dart';
import '../widgets/safety.dart';
import '../widgets/trip_time.dart';
import 'chat.dart';
import 'find.dart';
import 'trip.dart';

/* ==========================================================================
   Offer a ride
   ========================================================================== */

class OfferRideScreen extends StatefulWidget {
  const OfferRideScreen({super.key});
  @override
  State<OfferRideScreen> createState() => _OfferRideScreenState();
}

class _OfferRideScreenState extends State<OfferRideScreen> {
  Place _from = campus;
  Place? _to;
  DateTime _at = defaultDeparture();
  late int _seats = (context.read<Session>().user!.vehicle?.seats ?? 3).clamp(1, 4);
  double _detour = 2;
  final Set<String> _prefs = {};
  bool _womenOnly = false;
  final _note = TextEditingController();
  RouteInfo? _route;
  bool _routing = false;
  int? _fare;
  bool _publishing = false;
  String? _error;

  String get _fuel => context.read<Session>().user!.vehicle?.fuel ?? 'petrol';
  int? get _suggested => _route == null ? null : suggestFarePerSeat(_route!.distanceKm, _seats, _fuel);
  int get _effectiveFare => _fare ?? _suggested ?? 0;
  bool get _canWomenOnly => context.read<Session>().user?.gender == 'female';

  Future<void> _loadRoute() async {
    if (_to == null) return;
    setState(() => (_routing = true, _route = null, _fare = null));
    try {
      final r = await context.read<Session>().api.route(_from, _to!);
      if (mounted) setState(() => (_route = r, _routing = false));
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _routing = false));
    }
  }

  Future<void> _pickTime() async {
    final date = await showDatePicker(context: context, initialDate: _at, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 30)));
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (time == null) return;
    setState(() => _at = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _publish() async {
    if (_to == null) return setState(() => _error = 'Choose your destination.');
    if (_at.isBefore(DateTime.now().add(const Duration(minutes: 10)))) return setState(() => _error = 'Departure must be at least 10 minutes from now.');
    setState(() => (_publishing = true, _error = null));
    final api = context.read<Session>().api;
    try {
      final ride = await api.offerRide({
        'origin': _from.toJson(),
        'destination': _to!.toJson(),
        'departAt': _at.toUtc().toIso8601String(),
        'seats': _seats,
        'farePerSeat': _effectiveFare,
        'maxDetourKm': _detour,
        'preferences': _prefs.toList(),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (_womenOnly && _canWomenOnly) 'womenOnly': true,
      });
      if (!mounted) return;
      await showMoment(context, Moment.published, 'Ride offered successfully', subtitle: 'Students going your way can see it and book now.');
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => DriveScreen(rideId: ride.id)));
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _publishing = false));
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<Session>().user!;
    final vehicle = user.vehicle!;
    final suggested = _suggested;
    final maxFare = suggested == null ? 0 : maxFareFor(suggested);
    return MapSheetScaffold(
      initialSize: 0.6,
      minSize: 0.35,
      title: const Text('Offer a ride'),
      map: (pad) => RideMap(
        padding: pad,
        route: _route?.coords ?? const [],
        traffic: _route?.segments ?? const [],
        pins: [MapPin(_from.point, 'pickup', label: _from.name), if (_to != null) MapPin(_to!.point, 'drop', label: _to!.name)],
      ),
      footer: LoadingButton(label: _route == null ? 'Choose where you’re going' : 'Publish ride · ${money(_effectiveFare)}/seat', icon: Icons.check, loading: _publishing, onPressed: _route == null ? null : _publish),
      children: [
            Panel(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Column(children: [
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.circle, size: 14, color: RS.ink900),
                  title: Text(_from.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text('Leaving from'),
                  onTap: () async {
                    final p = await pickPlace(context, title: 'Leaving from');
                    if (p != null) {
                      setState(() => _from = p);
                      _loadRoute();
                    }
                  },
                ),
                const Divider(),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.square_rounded, size: 14, color: RS.primary),
                  title: Text(_to?.name ?? 'Where are you driving?', style: TextStyle(fontWeight: FontWeight.w600, color: _to == null ? RS.ink400 : RS.ink900)),
                  subtitle: const Text('Going to'),
                  onTap: () async {
                    final p = await pickPlace(context, title: 'Going to');
                    if (p != null) {
                      setState(() => _to = p);
                      _loadRoute();
                    }
                  },
                ),
              ]),
            ),
            const SizedBox(height: 12),
            Panel(
              onTap: _pickTime,
              child: Row(children: [const Icon(Icons.schedule, color: RS.ink700), const SizedBox(width: 12), Expanded(child: Text(when(_at), style: const TextStyle(fontWeight: FontWeight.w600))), const Icon(Icons.edit_outlined, size: 18, color: RS.ink400)]),
            ),
            const SizedBox(height: 12),
            Panel(
              child: Row(children: [
                const Expanded(child: Text('Seats to offer', style: TextStyle(fontWeight: FontWeight.w600))),
                IconButton.outlined(onPressed: _seats > 1 ? () => setState(() => (_seats--, _fare = null)) : null, icon: const Icon(Icons.remove)),
                SizedBox(width: 36, child: Text('$_seats', textAlign: TextAlign.center, style: RS.heading(18))),
                IconButton.outlined(onPressed: _seats < vehicle.seats ? () => setState(() => (_seats++, _fare = null)) : null, icon: const Icon(Icons.add)),
              ]),
            ),
            if (_routing) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
            if (_route != null && suggested != null) ...[
              const SectionTitle('Cost per seat'),
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text(money(_effectiveFare), style: RS.heading(28, color: RS.primary)),
                    const Spacer(),
                    Text('${km(_route!.distanceKm)} · ${minutes(_route!.durationMin)}${trafficNote(_route!)}', style: const TextStyle(color: RS.ink500)),
                  ]),
                  Slider(
                    value: _effectiveFare.toDouble().clamp(0, maxFare.toDouble()),
                    min: 0,
                    max: maxFare.toDouble(),
                    divisions: (maxFare / 10).round().clamp(1, 1000),
                    activeColor: RS.primary,
                    onChanged: (v) => setState(() => _fare = (v / 10).round() * 10),
                  ),
                  Text('Suggested ${money(suggested)} — fuel shared between you and ${_seats == 1 ? 'your rider' : 'your $_seats riders'}. RideSync caps it at ${money(maxFare)} so it stays cost-sharing.',
                      style: const TextStyle(color: RS.ink500, fontSize: 13, height: 1.4)),
                ]),
              ),
            ],
            const SectionTitle('Pickup flexibility'),
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('I can detour up to ${_detour.toStringAsFixed(_detour % 1 == 0 ? 0 : 1)} km', style: const TextStyle(fontWeight: FontWeight.w600)),
                Slider(value: _detour, min: 0, max: 5, divisions: 10, activeColor: RS.primary, onChanged: (v) => setState(() => _detour = v)),
              ]),
            ),
            const SectionTitle('Ride preferences'),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in preferenceLabel.entries)
                FilterChip(label: Text(e.value), selected: _prefs.contains(e.key), showCheckmark: false, onSelected: (on) => setState(() => on ? _prefs.add(e.key) : _prefs.remove(e.key))),
            ]),
            if (user.gender == 'female') ...[
              const SizedBox(height: 12),
              Panel(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _womenOnly,
                  activeThumbColor: WomenOnlyPill.fg,
                  onChanged: (v) => setState(() => _womenOnly = v),
                  secondary: const Icon(Icons.female_rounded, color: WomenOnlyPill.fg),
                  title: const Text('Women-only ride', style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text('Only female students can see and book'),
                ),
              ),
            ],
            const SizedBox(height: 16),
            TextField(controller: _note, maxLength: 200, decoration: const InputDecoration(labelText: 'Note for riders (optional)', hintText: 'e.g. Leaving from the main gate')),
            const SizedBox(height: 8),
            if (_error != null) ...[Notice(_error!, tone: 'error'), const SizedBox(height: 12)],
      ],
    );
  }
}

/* ==========================================================================
   Drive — the driver's controls for one ride: requests, start, GPS, steps
   ========================================================================== */

class DriveScreen extends StatefulWidget {
  const DriveScreen({super.key, required this.rideId});
  final String rideId;
  @override
  State<DriveScreen> createState() => _DriveScreenState();
}

class _DriveScreenState extends State<DriveScreen> {
  StreamSubscription<Position>? _gps;
  Position? _pos;
  String? _gpsError;
  DateTime _lastSent = DateTime(2000);

  // Riders waiting for pickup share their phone's live location (Uber/Ola style), by booking id.
  final Map<String, RiderLocation> _riderLocs = {};
  StreamSubscription<(String, String, RiderLocation)>? _riderSub;

  @override
  void initState() {
    super.initState();
    _riderSub = context.read<Session>().events?.onRiderLocation.listen((e) {
      if (e.$1 == widget.rideId && mounted) setState(() => _riderLocs[e.$2] = e.$3);
    });
  }

  /// The freshest known location of a rider who hasn't been picked up yet (≤10 min old).
  RiderLocation? _liveAt(RiderBooking r) {
    if (!const ['confirmed', 'driver_arriving', 'driver_arrived'].contains(r.booking.status)) return null;
    final a = r.riderLocation;
    final b = _riderLocs[r.booking.id];
    final l = a == null ? b : (b == null || a.at.isAfter(b.at) ? a : b);
    return l == null || DateTime.now().difference(l.at).inMinutes >= 10 ? null : l;
  }

  Future<void> _startSharing() async {
    if (_gps != null) return;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on Location so riders can see you coming.';
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) throw 'Allow location for RideSync in Settings so riders can track the car.';
      if (!mounted) return;
      final api = context.read<Session>().api;
      _gps = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10)).listen((p) {
        if (mounted) setState(() => (_pos = p, _gpsError = null));
        if (DateTime.now().difference(_lastSent).inSeconds >= 4) {
          _lastSent = DateTime.now();
          api.sendLocation(widget.rideId, p.latitude, p.longitude, p.heading).catchError((_) {});
        }
      }, onError: (_) => mounted ? setState(() => _gpsError = 'GPS signal lost. Riders see your last position.') : null);
    } catch (e) {
      if (mounted) setState(() => _gpsError = e is String ? e : 'Couldn’t start GPS.');
    }
  }

  void _stopSharing() {
    _gps?.cancel();
    _gps = null;
  }

  @override
  void dispose() {
    _stopSharing();
    _riderSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LiveLoader<RideDetail>(
        refreshable: false,
        loading: MapSheetScaffold(map: (pad) => RideMap(padding: pad), children: const [SizedBox(height: 260, child: SkeletonList(count: 1))]),
        load: (api) => api.ride(widget.rideId),
        builder: (context, d, reload) {
          final ride = d.ride;
          if (ride.status == 'in_progress') {
            WidgetsBinding.instance.addPostFrameCallback((_) => _startSharing());
          } else {
            _stopSharing();
          }
          return _body(context, d);
        },
      );

  Widget _body(BuildContext context, RideDetail d) {
    final ride = d.ride;
    final me = _pos == null ? null : LatLngPoint(_pos!.latitude, _pos!.longitude);
    final upcoming = ride.status == 'scheduled' || ride.status == 'in_progress';
    return TripEtaBuilder(
      from: me ?? ride.origin.point,
      to: ride.destination.point,
      departAt: ride.departAt,
      plannedMin: ride.durationMin,
      distanceKm: ride.distanceKm,
      live: ride.status == 'in_progress',
      builder: (context, eta) => _sheet(context, d, me, upcoming ? eta : null),
    );
  }

  Widget _sheet(BuildContext context, RideDetail d, LatLngPoint? me, TripEta? eta) {
    final ride = d.ride;
    final api = context.read<Session>().api;
    final pending = d.bookings.where((b) => b.booking.status == 'pending').toList();
    final riders = d.bookings.where((b) => const ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed'].contains(b.booking.status)).toList();
    // Upcoming or under way: today's live route, coloured by traffic like Google Maps.
    final live = eta != null && eta.coords.length > 1;
    final bubble = eta == null ? null : etaPin(live ? eta.coords : ride.route, eta);
    return MapSheetScaffold(
      initialSize: ride.status == 'in_progress' ? 0.42 : 0.55,
      minSize: 0.28,
      title: const Text('Your ride'),
      topActions: [FloatingMapButton(icon: Icons.ios_share_rounded, onTap: () => shareRide(context, ride, d.driver.name))],
      map: (pad) => RideMap(
        padding: pad,
        route: live ? eta.coords : ride.route,
        traffic: live ? eta.segments : const [],
        follow: ride.status == 'in_progress' ? me : null,
        pins: [
          MapPin(ride.origin.point, 'pickup', label: ride.origin.name, sublabel: 'Leave ${timeOf(ride.departAt)}'),
          MapPin(ride.destination.point, 'drop', label: ride.destination.name, sublabel: eta == null ? null : 'Arrive ~${timeOf(eta.arrive)}'),
          ?bubble,
          for (final r in riders.where((r) => r.booking.isActive))
            if (_liveAt(r) case final at?)
              MapPin(at.point, 'me', label: r.rider.firstName, sublabel: 'Live · ${seen(at.at)}')
            else
              MapPin(r.booking.pickup.point, 'me', label: '${r.rider.firstName}’s pickup'),
          if (me != null) MapPin(me, 'car', heading: _pos!.heading),
        ],
      ),
      children: [
          Row(children: [
            Expanded(child: Text(when(ride.departAt), style: RS.heading(20))),
            Pill.status(ride.status == 'scheduled' ? 'confirmed' : ride.status, switch (ride.status) { 'scheduled' => 'Scheduled', 'in_progress' => 'On the road', 'completed' => 'Completed', _ => 'Cancelled' }),
          ]),
          const SizedBox(height: 12),
          Panel(child: RouteLine(from: ride.origin, to: ride.destination, fromTime: timeOf(ride.departAt), toTime: eta == null ? timeOf(ride.departAt.add(Duration(minutes: ride.durationMin))) : '~${timeOf(eta.arrive)}')),
          const SizedBox(height: 8),
          Text('${ride.seatsBooked}/${ride.seatsTotal} seats booked · ${money(ride.farePerSeat)} per seat', style: const TextStyle(color: RS.ink500)),
          if (ride.status == 'in_progress') ...[
            const SizedBox(height: 12),
            Notice(_gpsError ?? (_pos == null ? 'Starting GPS…' : 'Sharing your live location with riders. Keep RideSync open while driving.'), tone: _gpsError == null ? 'success' : 'warning', icon: Icons.my_location),
          ],
          if (pending.isNotEmpty) ...[
            SectionTitle('Requests (${pending.length})'),
            for (final r in pending)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Panel(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    DriverRow(driver: r.rider, trailing: Text(money(r.booking.fare), style: RS.heading(16, color: RS.primary))),
                    if (r.noShowRisk != null) ...[const SizedBox(height: 8), Align(alignment: Alignment.centerLeft, child: ReliabilityPill(r.noShowRisk!))],
                    const SizedBox(height: 10),
                    RouteLine(from: r.booking.pickup, to: r.booking.drop, dense: true),
                    if (r.booking.message != null) ...[const SizedBox(height: 8), Text('“${r.booking.message}”', style: const TextStyle(fontStyle: FontStyle.italic, color: RS.ink700))],
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(child: OutlinedButton(onPressed: () => _act(context, () => api.respond(r.booking.id, false), Moment.declined, 'Request declined', '${r.rider.firstName} has been told. Your seat is open again.'), child: const Text('Decline'))),
                      const SizedBox(width: 10),
                      Expanded(child: FilledButton(onPressed: () => _act(context, () => api.respond(r.booking.id, true), Moment.accepted, 'Ride accepted', '${r.rider.firstName} has been notified and can now confirm the seat.'), child: const Text('Accept'))),
                    ]),
                  ]),
                ),
              ),
          ],
          SectionTitle('Riders (${riders.length})'),
          if (riders.isEmpty) const Text('No riders yet. Requests appear here instantly with a notification.', style: TextStyle(color: RS.ink500)),
          for (final r in riders) Padding(padding: const EdgeInsets.only(bottom: 10), child: _RiderPanel(r: r, rideStatus: ride.status, liveAt: _liveAt(r))),
          const SizedBox(height: 12),
          if (ride.status == 'scheduled') ...[
            LoadingButton(
              label: 'Start ride',
              icon: Icons.play_arrow_rounded,
              onPressed: riders.isEmpty ? null : () => _act(context, () => api.startRide(ride.id), Moment.started, 'Ride started', 'Riders can now track you live. Drive safe!'),
            ),
            const SizedBox(height: 10),
            LoadingButton(
              label: 'Cancel ride',
              secondary: true,
              danger: true,
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (c) => AlertDialog(
                    title: const Text('Cancel this ride?'),
                    content: const Text('All riders will be notified and any online payments refunded.'),
                    actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep')), TextButton(onPressed: () => Navigator.pop(c, true), style: TextButton.styleFrom(foregroundColor: RS.danger), child: const Text('Cancel ride'))],
                  ),
                );
                if (ok == true && context.mounted) await _act(context, () => api.cancelRide(ride.id), Moment.cancelled, 'Ride cancelled', 'All riders have been notified and online payments refunded.');
              },
            ),
          ],
          if (ride.status == 'in_progress')
            LoadingButton(
              label: 'Complete ride',
              icon: Icons.flag_rounded,
              onPressed: () => _act(context, () async {
                await api.completeRide(ride.id);
                _stopSharing();
              }, Moment.completed, 'Ride completed', 'Thanks for driving! Fares show up under Earnings.'),
            ),
      ],
    );
  }
}

class _RiderPanel extends StatelessWidget {
  const _RiderPanel({required this.r, required this.rideStatus, this.liveAt});
  final RiderBooking r;
  final String rideStatus;

  /// The rider's live phone location before pickup, when they share it.
  final RiderLocation? liveAt;

  @override
  Widget build(BuildContext context) {
    final b = r.booking;
    final api = context.read<Session>().api;
    final next = rideStatus != 'in_progress'
        ? null
        : switch (b.status) {
            'driver_arriving' => ('I’ve arrived at pickup', () => api.arrived(b.id)),
            'driver_arrived' => ('${r.rider.firstName} is in the car', null),
            'in_progress' => ('Dropped off ${r.rider.firstName}', () => api.dropped(b.id)),
            _ => null,
          };
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        DriverRow(driver: r.rider, trailing: Pill.status(b.status, bookingStatusLabel[b.status] ?? b.status)),
        const SizedBox(height: 10),
        RouteLine(from: b.pickup, to: b.drop, dense: true),
        if (r.noShowRisk != null) ...[const SizedBox(height: 8), Align(alignment: Alignment.centerLeft, child: ReliabilityPill(r.noShowRisk!))],
        if (liveAt != null) ...[
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.my_location, size: 15, color: RS.success),
            const SizedBox(width: 6),
            Expanded(
              child: Text('Live location · ${km(haversineKm(liveAt!.point, b.pickup.point))} from pickup · ${seen(liveAt!.at)}', style: const TextStyle(color: RS.success, fontSize: 13, fontWeight: FontWeight.w600)),
            ),
          ]),
        ],
        // Free wait after arriving; then the driver may mark a no-show.
        if (b.status == 'driver_arrived' && b.arrivedAt != null)
          WaitedBuilder(
            since: b.arrivedAt!,
            builder: (context, waited) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const SizedBox(height: 8),
              Text(
                'Waiting ${mmss(waited)}${waited < freeWaitSeconds ? ' · free wait ends in ${mmss(freeWaitSeconds - waited)}' : ' · you can mark them as no-show'}',
                style: TextStyle(color: waited < freeWaitSeconds ? RS.warning : RS.danger, fontSize: 13, fontWeight: FontWeight.w600),
              ),
              if (rideStatus == 'in_progress' && waited >= freeWaitSeconds) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => attempt(context, () => api.noShow(b.id), success: '${r.rider.firstName} marked as no-show'),
                  style: OutlinedButton.styleFrom(foregroundColor: RS.danger, side: const BorderSide(color: RS.danger)),
                  icon: const Icon(Icons.person_off_outlined, size: 18),
                  label: const Text('Didn’t come'),
                ),
              ],
            ]),
          ),
        const SizedBox(height: 8),
        Text('${money(b.fare)} · ${paymentLabel(b.paymentMethod, b.paymentStatus)}', style: const TextStyle(color: RS.ink500, fontSize: 13)),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          OutlinedButton.icon(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(bookingId: b.id, other: r.rider))),
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            label: const Text('Message'),
          ),
          if (r.riderPhone != null) OutlinedButton.icon(onPressed: () => openUrl(context, 'tel:+91${r.riderPhone}'), icon: const Icon(Icons.call_outlined, size: 18), label: const Text('Call')),
          // Turn-by-turn directions in Google Maps: to the pickup until the rider is in the car, then to their drop.
          if (const ['accepted', 'confirmed', 'driver_arriving', 'driver_arrived', 'in_progress'].contains(b.status))
            FilledButton.tonalIcon(
              onPressed: () {
                // To where the rider actually is, when they share their live location.
                final to = b.status == 'in_progress' ? b.drop.point : (liveAt?.point ?? b.pickup.point);
                openUrl(context, 'https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving');
              },
              icon: const Icon(Icons.navigation_outlined, size: 18),
              label: Text(b.status == 'in_progress' ? 'Navigate to drop' : 'Navigate to pickup'),
            ),
          if ((b.paymentStatus == 'marked_paid' || (b.paymentMethod == 'cash' && b.paymentStatus == 'unpaid')) && b.status != 'cancelled')
            OutlinedButton.icon(
              onPressed: () => attempt(context, () => api.paymentReceived(b.id), success: 'Marked as received'),
              icon: const Icon(Icons.check, size: 18),
              label: const Text('Payment received'),
            ),
          if (b.status == 'completed' && b.driverRating == null)
            OutlinedButton.icon(onPressed: () => showRateSheet(context, b.id, r.rider.firstName, photo: r.rider.photo, ratingDriver: false), icon: const Icon(Icons.star_outline, size: 18), label: const Text('Rate')),
        ]),
        if (next != null) ...[
          const SizedBox(height: 10),
          FilledButton(
            // Picking up needs the rider's PIN; the sheet shows the server's answer itself.
            onPressed: () => next.$2 == null ? showPickupPinSheet(context, bookingId: b.id, firstName: r.rider.firstName) : attempt(context, next.$2!),
            child: Text(next.$1),
          ),
        ],
      ]),
    );
  }
}

/// Runs a driver action, then shows its animated moment.
Future<void> _act(BuildContext context, Future<void> Function() action, Moment kind, String title, String subtitle) async {
  if (await attempt(context, action) && context.mounted) await showMoment(context, kind, title, subtitle: subtitle);
}
