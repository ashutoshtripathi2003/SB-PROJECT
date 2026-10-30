import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../data/places.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import '../widgets/map_sheet.dart';
import '../widgets/motion.dart';
import '../widgets/ride_card.dart';
import '../widgets/ride_map.dart';
import 'drive.dart';
import 'find.dart';
import 'notifications.dart';
import 'profile.dart';
import 'trip.dart';

/// Home: the map of rides leaving soon, with "Where to?" on a sheet — like a ride app.
class HomeTab extends StatelessWidget {
  const HomeTab({super.key, required this.onFind, this.onAssistant});
  final VoidCallback onFind;

  /// Opens the RideSync Assistant (its button lives in the top bar here, not over the sheet).
  final VoidCallback? onAssistant;

  String _greeting() {
    final h = DateTime.now().hour;
    return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<Session>().user!;
    return LiveLoader<(List<FeedItem>, Trips)>(
      refreshable: false,
      load: (api) async => (await api.feed(), await api.trips()),
      loading: MapSheetScaffold(map: (pad) => RideMap(padding: pad, pins: const [MapPin(LatLngPoint(19.0222, 72.8711), 'pickup')]), children: const [SizedBox(height: 220, child: SkeletonList(count: 1))]),
      builder: (context, data, reload) {
        final (feed, trips) = data;
        final active = trips.bookings.where((b) => b.booking.isActive).toList();
        final driving = trips.rides.where((r) => r.ride.status == 'scheduled' || r.ride.status == 'in_progress').toList();
        final focus = active.isNotEmpty ? active.first.ride.route : (driving.isNotEmpty ? driving.first.ride.route : const <LatLngPoint>[]);
        return MapSheetScaffold(
          initialSize: 0.52,
          minSize: 0.3,
          showBack: false,
          title: Image.asset('assets/ridesync-logo.png', height: 22),
          topActions: [
            if (onAssistant != null) FloatingMapButton(icon: Icons.smart_toy_outlined, onTap: onAssistant!),
            FloatingMapButton(icon: Icons.notifications_none_rounded, onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()))),
          ],
          map: (pad) => RideMap(
            padding: pad,
            route: focus,
            altRoutes: [for (final f in feed.take(6)) f.ride.route],
            pins: [
              if (active.isNotEmpty) ...[
                MapPin(active.first.booking.pickup.point, 'pickup', label: active.first.booking.pickup.name),
                MapPin(active.first.booking.drop.point, 'drop', label: active.first.booking.drop.name),
              ] else if (driving.isNotEmpty) ...[
                MapPin(driving.first.ride.origin.point, 'pickup', label: driving.first.ride.origin.name),
                MapPin(driving.first.ride.destination.point, 'drop', label: driving.first.ride.destination.name),
              ] else
                MapPin(campus.point, 'pickup', label: campus.name),
              for (final f in feed.take(6)) MapPin(f.ride.destination.point, 'drop', label: f.ride.destination.name),
            ],
          ),
          children: [
            Text('${_greeting()}, ${user.firstName}.', style: const TextStyle(color: RS.ink500, fontSize: 15)),
            const SizedBox(height: 2),
            Text('Where are you heading?', style: RS.heading(24)),
            const SizedBox(height: 14),
            PressScale(
              onTap: onFind,
              child: Material(
                color: RS.sunken,
                borderRadius: BorderRadius.circular(RS.radiusMd),
                child: InkWell(
                  borderRadius: BorderRadius.circular(RS.radiusMd),
                  onTap: onFind,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    child: Row(children: [
                      Icon(Icons.search, color: RS.ink900),
                      SizedBox(width: 12),
                      Expanded(child: Text('Where to?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
                      Icon(Icons.schedule, size: 18, color: RS.ink500),
                      SizedBox(width: 4),
                      Text('Now', style: TextStyle(color: RS.ink500, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // One tap to see rides: to campus in the morning, home from campus later in the day.
            _Shortcuts(user: user),
            const SizedBox(height: 12),
            // One primary action (where to?) and the driver's option right under it.
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => user.canDrive ? const OfferRideScreen() : const VehicleScreen(offerAfter: true))),
                icon: const Icon(Icons.directions_car_rounded, size: 20),
                label: Text(user.canDrive ? 'Offer a ride' : 'Have a car? Offer rides'),
                style: OutlinedButton.styleFrom(minimumSize: const Size(64, 50)),
              ),
            ),
            if (active.isNotEmpty || driving.isNotEmpty) const SectionTitle('Your upcoming rides'),
            for (final (i, t) in active.indexed)
              FadeSlideIn(
                index: i,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Panel(
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(bookingId: t.booking.id))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        if (const ['driver_arriving', 'driver_arrived', 'in_progress'].contains(t.booking.status)) const LiveDot(),
                        Text(when(t.ride.departAt), style: RS.heading(15)),
                        const Spacer(),
                        Pill.status(t.booking.status, bookingStatusLabel[t.booking.status] ?? t.booking.status),
                      ]),
                      const SizedBox(height: 10),
                      RouteLine(from: t.booking.pickup, to: t.booking.drop, dense: true),
                      const SizedBox(height: 8),
                      Text('With ${t.driver.name}', style: const TextStyle(color: RS.ink500, fontSize: 13)),
                    ]),
                  ),
                ),
              ),
            for (final (i, r) in driving.indexed)
              FadeSlideIn(
                index: i,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Panel(
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => DriveScreen(rideId: r.ride.id))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        if (r.ride.status == 'in_progress') const LiveDot(),
                        Text(when(r.ride.departAt), style: RS.heading(15)),
                        const Spacer(),
                        if (r.pending > 0) Pill('${r.pending} request${r.pending == 1 ? '' : 's'}', color: RS.warning, background: RS.warning50) else const Pill('You’re driving'),
                      ]),
                      const SizedBox(height: 10),
                      RouteLine(from: r.ride.origin, to: r.ride.destination, dense: true),
                      const SizedBox(height: 8),
                      Text('${r.ride.seatsBooked}/${r.ride.seatsTotal} seats booked', style: const TextStyle(color: RS.ink500, fontSize: 13)),
                    ]),
                  ),
                ),
              ),
            SectionTitle('Leaving soon', trailing: feed.isEmpty ? null : Row(children: [const LiveDot(size: 7), Text('Live', style: TextStyle(color: RS.success, fontSize: 12, fontWeight: FontWeight.w700))])),
            if (feed.isEmpty)
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('No rides offered yet', style: RS.heading(16)),
                  const SizedBox(height: 4),
                  const Text('When a VIT student offers a ride, it appears here instantly. Driving somewhere? Offer your empty seats.', style: TextStyle(color: RS.ink500, height: 1.4)),
                ]),
              ),
            for (final (i, f) in feed.indexed)
              FadeSlideIn(
                index: i,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: RideCard(
                    ride: f.ride,
                    driver: f.driver,
                    vehicle: f.vehicle,
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => RideDetailsScreen(rideId: f.ride.id))),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

const _shortcutIds = ['thane', 'dadar', 'kurla', 'ghatkopar', 'vashi', 'andheri'];

class _Shortcuts extends StatelessWidget {
  const _Shortcuts({required this.user});
  final User user;

  @override
  Widget build(BuildContext context) {
    final toCampus = DateTime.now().hour < 12;
    final places = [for (final id in _shortcutIds) popularPlaces.firstWhere((p) => p.id == id)];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 3.1,
      padding: EdgeInsets.zero,
      children: [
        for (final p in places)
          Material(
            color: RS.surface,
            borderRadius: BorderRadius.circular(RS.radiusLg),
            child: InkWell(
              borderRadius: BorderRadius.circular(RS.radiusLg),
              onTap: () {
                final q = SearchQuery(
                  pickup: toCampus ? p : campus,
                  drop: toCampus ? campus : p,
                  at: DateTime.now().add(const Duration(minutes: 15)),
                  preferences: user.preferences.where((x) => x != 'music_ok' && x != 'ac').toList(),
                );
                Navigator.push(context, MaterialPageRoute(builder: (_) => ResultsScreen(query: q)));
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(RS.radiusLg), border: Border.all(color: RS.line)),
                child: Row(children: [
                  const CircleAvatar(radius: 15, backgroundColor: RS.sunken, child: Icon(Icons.place_outlined, size: 16, color: RS.ink700)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                      Text(toCampus ? '→ ${campus.name}' : 'from ${campus.name}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: RS.ink500, fontSize: 11.5)),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
      ],
    );
  }
}
