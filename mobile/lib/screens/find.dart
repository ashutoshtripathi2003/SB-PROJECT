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
import '../widgets/place_picker.dart';
import '../widgets/ride_card.dart';
import '../widgets/ride_map.dart';
import 'trip.dart';

DateTime defaultDeparture() {
  final d = DateTime.now().add(const Duration(minutes: 30));
  final m = ((d.minute / 15).ceil() * 15);
  return DateTime(d.year, d.month, d.day, d.hour).add(Duration(minutes: m));
}

/// Pickup, drop, time, seats and preferences → AI-matched rides. The map previews the trip.
class FindTab extends StatefulWidget {
  const FindTab({super.key});
  @override
  State<FindTab> createState() => _FindTabState();
}

class _FindTabState extends State<FindTab> {
  Place _pickup = campus;
  Place? _drop;
  DateTime _at = defaultDeparture();
  int _seats = 1;
  late final Set<String> _prefs = {...context.read<Session>().user!.preferences};
  String? _error;
  RouteInfo? _preview;

  Future<void> _loadPreview() async {
    if (_drop == null) return;
    try {
      final r = await context.read<Session>().api.route(_pickup, _drop!);
      if (mounted) setState(() => _preview = r);
    } catch (_) {}
  }

  Future<void> _pickTime() async {
    final date = await showDatePicker(context: context, initialDate: _at, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 30)));
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_at));
    if (time == null) return;
    setState(() => _at = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  void _search() {
    if (_drop == null) return setState(() => _error = 'Choose where you’re going.');
    if (_drop!.lat == _pickup.lat && _drop!.lng == _pickup.lng) return setState(() => _error = 'Pickup and destination are the same place.');
    setState(() => _error = null);
    final q = SearchQuery(pickup: _pickup, drop: _drop!, at: _at, seats: _seats, preferences: _prefs.toList());
    context.read<Session>().lastQuery = q;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ResultsScreen(query: q)));
  }

  Widget _placeTile(String label, Place? p, bool end, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(children: [
            Container(width: 10, height: 10, decoration: BoxDecoration(color: end ? RS.primary : RS.ink900, shape: end ? BoxShape.rectangle : BoxShape.circle, borderRadius: end ? BorderRadius.circular(2) : null)),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(color: RS.ink500, fontSize: 12)),
                Text(p?.name ?? 'Where are you going?', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: p == null ? RS.ink400 : RS.ink900), overflow: TextOverflow.ellipsis),
              ]),
            ),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) => MapSheetScaffold(
        showBack: false,
        initialSize: 0.62,
        minSize: 0.4,
        title: const Text('Find a ride'),
        map: (pad) => RideMap(
          padding: pad,
          route: _preview?.coords ?? const [],
          traffic: _preview?.segments ?? const [],
          pins: [MapPin(_pickup.point, 'pickup', label: _pickup.name), if (_drop != null) MapPin(_drop!.point, 'drop', label: _drop!.name)],
        ),
        footer: LoadingButton(label: 'Find a ride', icon: Icons.search, onPressed: _search),
        children: [
          Panel(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(children: [
              Expanded(
                child: Column(children: [
                  _placeTile('From', _pickup, false, () async {
                    final p = await pickPlace(context, title: 'Pickup');
                    if (p != null) {
                      setState(() => (_pickup = p, _preview = null));
                      _loadPreview();
                    }
                  }),
                  const Divider(),
                  _placeTile('To', _drop, true, () async {
                    final p = await pickPlace(context, title: 'Destination');
                    if (p != null) {
                      setState(() => (_drop = p, _preview = null));
                      _loadPreview();
                    }
                  }),
                ]),
              ),
              IconButton(
                tooltip: 'Swap',
                onPressed: _drop == null
                    ? null
                    : () {
                        setState(() {
                          final from = _pickup;
                          _pickup = _drop!;
                          _drop = from;
                          _preview = null;
                        });
                        _loadPreview();
                      },
                icon: const Icon(Icons.swap_vert),
                style: IconButton.styleFrom(backgroundColor: RS.sunken),
              ),
            ]),
          ),
          if (_preview != null)
            FadeSlideIn(
              child: Padding(
                padding: const EdgeInsets.only(top: 8, left: 4),
                child: Text('${km(_preview!.distanceKm)} · about ${minutes(_preview!.durationMin)} by car${trafficNote(_preview!)}', style: const TextStyle(color: RS.ink500, fontSize: 13)),
              ),
            ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: Panel(
                onTap: _pickTime,
                padding: const EdgeInsets.all(14),
                child: Row(children: [
                  const Icon(Icons.schedule, size: 20, color: RS.ink700),
                  const SizedBox(width: 10),
                  Expanded(child: Text(when(_at), style: const TextStyle(fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                ]),
              ),
            ),
            const SizedBox(width: 12),
            Panel(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Row(children: [
                IconButton(onPressed: _seats > 1 ? () => setState(() => _seats--) : null, icon: const Icon(Icons.remove)),
                Text('$_seats', style: RS.heading(16)),
                const Icon(Icons.person_outline, size: 18, color: RS.ink500),
                IconButton(onPressed: _seats < 6 ? () => setState(() => _seats++) : null, icon: const Icon(Icons.add)),
              ]),
            ),
          ]),
          const SectionTitle('Preferences'),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final e in preferenceLabel.entries)
              FilterChip(label: Text(e.value), selected: _prefs.contains(e.key), showCheckmark: false, onSelected: (on) => setState(() => on ? _prefs.add(e.key) : _prefs.remove(e.key))),
          ]),
          const SizedBox(height: 16),
          if (_error != null) ...[Notice(_error!, tone: 'warning'), const SizedBox(height: 12)],
          const Row(children: [
            Icon(Icons.auto_awesome, size: 16, color: RS.primary),
            SizedBox(width: 8),
            Expanded(child: Text('RideSync AI ranks rides by route overlap, pickup distance, timing, your preferences and driver reliability.', style: TextStyle(color: RS.ink500, fontSize: 13, height: 1.4))),
          ]),
        ],
      );
}

class ResultsScreen extends StatefulWidget {
  const ResultsScreen({super.key, required this.query});
  final SearchQuery query;
  @override
  State<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends State<ResultsScreen> {
  String _sort = 'best';
  String? _selected;

  List<MatchResult> _sorted(List<MatchResult> list) {
    final out = [...list];
    if (_sort == 'best') out.sort((a, b) => b.score.compareTo(a.score));
    if (_sort == 'earliest') out.sort((a, b) => a.ride.departAt.compareTo(b.ride.departAt));
    if (_sort == 'fare') out.sort((a, b) => a.fare != b.fare ? a.fare.compareTo(b.fare) : b.score.compareTo(a.score));
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.query;
    final header = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${q.pickup.name} → ${q.drop.name}', style: RS.heading(18), overflow: TextOverflow.ellipsis),
      Text('${when(q.at)} · ${q.seats} seat${q.seats == 1 ? '' : 's'}', style: const TextStyle(fontSize: 13, color: RS.ink500)),
    ]);
    return LiveLoader<(List<MatchResult>, int)>(
      refreshable: false,
      loading: MapSheetScaffold(
        map: (pad) => RideMap(padding: pad, pins: [MapPin(q.pickup.point, 'pickup'), MapPin(q.drop.point, 'drop')]),
        children: [
          header,
          const SizedBox(height: 12),
          const Row(children: [LiveDot(color: RS.primary), SizedBox(width: 6), Text('RideSync AI is finding your best matches…', style: TextStyle(color: RS.primary, fontWeight: FontWeight.w600))]),
          const SizedBox(height: 320, child: SkeletonList(count: 2)),
        ],
      ),
      load: (api) => api.search(q),
      builder: (context, data, reload) {
        final (results, inWindow) = data;
        final list = _sorted(results);
        final focus = list.where((m) => m.ride.id == _selected).firstOrNull ?? list.firstOrNull;
        return MapSheetScaffold(
          initialSize: 0.58,
          map: (pad) => RideMap(
            padding: pad,
            route: focus?.ride.route ?? const [],
            altRoutes: [for (final m in list) if (m != focus) m.ride.route],
            pins: [MapPin(q.pickup.point, 'me', label: 'Your pickup'), MapPin(q.drop.point, 'drop', label: q.drop.name), if (focus != null) MapPin(focus.ride.origin.point, 'pickup', label: focus.ride.origin.name)],
          ),
          children: [
            header,
            const SizedBox(height: 10),
            if (results.isEmpty)
              EmptyState(
                icon: Icons.directions_car_outlined,
                title: 'No matching rides yet',
                body: inWindow > 0
                    ? '$inWindow ride${inWindow == 1 ? '' : 's'} leave around this time, but none go your way. Try a nearby pickup or a different time.'
                    : 'No one has offered a ride around this time yet. New rides appear here automatically — keep this screen open or check back soon.',
              )
            else ...[
              Row(children: [
                const Icon(Icons.auto_awesome, size: 18, color: RS.primary),
                const SizedBox(width: 6),
                Text('${results.length} match${results.length == 1 ? '' : 'es'}', style: RS.heading(16)),
                const Spacer(),
                DropdownButton<String>(
                  value: _sort,
                  underline: const SizedBox(),
                  items: const [
                    DropdownMenuItem(value: 'best', child: Text('Best match')),
                    DropdownMenuItem(value: 'earliest', child: Text('Earliest')),
                    DropdownMenuItem(value: 'fare', child: Text('Lowest fare')),
                  ],
                  onChanged: (v) => setState(() => _sort = v ?? 'best'),
                ),
              ]),
              const SizedBox(height: 6),
              for (final (i, m) in list.indexed)
                FadeSlideIn(
                  index: i,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(RS.radiusLg + 2), border: Border.all(color: m == focus ? RS.primary : Colors.transparent, width: 2)),
                      child: Column(children: [
                        GestureDetector(
                          onLongPress: () => setState(() => _selected = m.ride.id),
                          child: RideCard(
                            ride: m.ride,
                            driver: m.driver,
                            vehicle: m.vehicle,
                            fare: m.fare,
                            score: m.score,
                            tier: m.tier,
                            aiChance: m.aiChance,
                            onTap: () {
                              setState(() => _selected = m.ride.id);
                              Navigator.push(context, MaterialPageRoute(builder: (_) => RideDetailsScreen(rideId: m.ride.id, match: m)));
                            },
                          ),
                        ),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(onPressed: () => showWhyMatch(context, m), icon: const Icon(Icons.auto_awesome, size: 16), label: const Text('Why this match?')),
                        ),
                      ]),
                    ),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }
}

/// The explainable AI breakdown for one match.
void showWhyMatch(BuildContext context, MatchResult m) {
  const labels = {'route': 'Route overlap', 'pickup': 'Pickup distance', 'time': 'Timing', 'preference': 'Preferences', 'reliability': 'Driver reliability'};
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Text('Why this match?', style: RS.heading(20)), const Spacer(), MatchBadge(score: m.score, tier: m.tier)]),
            const SizedBox(height: 16),
            for (final (i, e) in labels.entries.indexed) ...[
              Row(children: [Expanded(child: Text(e.value)), Text('${((m.factors[e.key] ?? 0) * 100).round()}%', style: const TextStyle(fontWeight: FontWeight.w600))]),
              const SizedBox(height: 6),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: (m.factors[e.key] ?? 0).clamp(0, 1)),
                duration: Duration(milliseconds: 600 + i * 120),
                curve: Curves.easeOutCubic,
                builder: (_, v, _) => ClipRRect(borderRadius: BorderRadius.circular(99), child: LinearProgressIndicator(value: v, minHeight: 8, color: RS.primary, backgroundColor: RS.sunken)),
              ),
              const SizedBox(height: 14),
            ],
            const Divider(),
            const SizedBox(height: 12),
            for (final r in m.reasons) Padding(padding: const EdgeInsets.only(bottom: 8), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.check_circle, size: 18, color: RS.success), const SizedBox(width: 8), Expanded(child: Text(r))])),
            for (final c in m.caveats) Padding(padding: const EdgeInsets.only(bottom: 8), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Icon(Icons.info_outline, size: 18, color: RS.warning), const SizedBox(width: 8), Expanded(child: Text(c))])),
            if (m.history != null) Padding(padding: const EdgeInsets.only(top: 4), child: Notice(m.history!, icon: Icons.handshake_outlined)),
            const SizedBox(height: 8),
            Text('Pickup ${km(m.pickupDistanceKm)} away · drop ${km(m.dropDistanceKm)} from your destination · detour ${km(m.detourKm)}', style: const TextStyle(color: RS.ink500, fontSize: 13)),
          ]),
        ),
      ),
    ),
  );
}
