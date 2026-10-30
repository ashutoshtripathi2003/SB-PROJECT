import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:provider/provider.dart';

import '../api/admin_models.dart';
import '../api/api.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';

/// How often every admin screen refreshes while it's on screen.
const adminRefreshEvery = Duration(seconds: 20);

/// RideSync Admin: Overview · Rides · Students · ID checks (mirrors /admin on the website).
///
/// Admin-only accounts (not @vit.edu.in) land here instead of the student app and get a
/// sign-out button. VIT students who are also admins open it from Profile ([embedded]) and get a back button.
class AdminShell extends StatefulWidget {
  const AdminShell({super.key, this.embedded = false});
  final bool embedded;
  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> with WidgetsBindingObserver {
  int _tab = 0;
  AdminStats? _stats;
  Object? _statsError;
  Timer? _timer;
  bool _foreground = true;

  /// One "refresh now" signal per list tab (Rides, Students, ID checks).
  final _pulses = [_Pulse(), _Pulse(), _Pulse()];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadStats();
    _timer = Timer.periodic(adminRefreshEvery, (_) => _tick());
  }

  /// Only refresh while this screen is what the admin is looking at.
  bool get _visible => mounted && _foreground && (ModalRoute.of(context)?.isCurrent ?? true);

  void _tick() {
    if (!_visible) return;
    _loadStats();
    if (_tab > 0) _pulses[_tab - 1].fire();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) _tick();
  }

  Future<void> _loadStats() async {
    try {
      final s = await context.read<Session>().api.adminStats();
      if (mounted) setState(() => (_stats = s, _statsError = null));
    } catch (e) {
      if (mounted) setState(() => _statsError = e);
    }
  }

  void _goTo(int tab) {
    if (tab == _tab) return;
    setState(() => _tab = tab);
    if (tab > 0) _pulses[tab - 1].fire();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    for (final p in _pulses) {
      p.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pending = _stats?.users.pendingIds ?? 0;
    Widget idIcon(IconData icon, {Color? color}) => Badge(
          isLabelVisible: pending > 0,
          backgroundColor: RS.danger,
          label: Text('$pending'),
          child: Icon(icon, color: color),
        );
    return Scaffold(
      appBar: AppBar(
        title: Row(mainAxisSize: MainAxisSize.min, children: [
          const Flexible(child: Text('RideSync Admin', overflow: TextOverflow.ellipsis)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: RS.ink900, borderRadius: BorderRadius.circular(999)),
            child: const Text('Admin', style: TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
          ),
        ]),
        actions: [
          if (!widget.embedded)
            IconButton(
              tooltip: 'Sign out',
              icon: const Icon(Icons.logout),
              onPressed: () => context.read<Session>().signOut(),
            ),
        ],
        bottom: const PreferredSize(preferredSize: Size.fromHeight(1), child: Divider(height: 1)),
      ),
      body: IndexedStack(index: _tab, children: [
        _OverviewTab(stats: _stats, error: _statsError, onRefresh: _loadStats),
        _RidesTab(pulse: _pulses[0]),
        _StudentsTab(pulse: _pulses[1]),
        _IdChecksTab(pulse: _pulses[2], onChanged: _loadStats),
      ]),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: RS.line))),
        child: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: _goTo,
          destinations: [
            const NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart_rounded, color: RS.primary), label: 'Overview'),
            const NavigationDestination(icon: Icon(Icons.directions_car_outlined), selectedIcon: Icon(Icons.directions_car, color: RS.primary), label: 'Rides'),
            const NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people, color: RS.primary), label: 'Students'),
            NavigationDestination(icon: idIcon(Icons.badge_outlined), selectedIcon: idIcon(Icons.badge, color: RS.primary), label: 'ID checks'),
          ],
        ),
      ),
    );
  }
}

/// "Refresh now" from the shell's timer to the tab that's on screen.
class _Pulse extends ChangeNotifier {
  void fire() => notifyListeners();
}

/// Loading / error / data for one admin list, with stale responses ignored
/// (so a slow search or old filter never overwrites a newer one).
mixin _AdminLoad<W extends StatefulWidget, T> on State<W> {
  T? data;
  Object? error;
  bool loading = true;
  int _seq = 0;

  Future<T> fetch(Api api);

  Future<void> reload({bool quiet = false}) async {
    final seq = ++_seq;
    if (!quiet) setState(() => (loading = true, error = null));
    try {
      final d = await fetch(context.read<Session>().api);
      if (mounted && seq == _seq) setState(() => (data = merge(d), error = null, loading = false));
    } catch (e) {
      if (mounted && seq == _seq) setState(() => (error = e, loading = false));
    }
  }

  /// Lets a tab keep objects it already has (e.g. decoded photos).
  T merge(T fresh) => fresh;

  /// Pull-to-refresh list with the header widgets on top, then the loading / error / empty / data body.
  Widget scroller({required List<Widget> header, required List<Widget> Function(T data) items, required Widget empty, required bool Function(T data) isEmpty}) {
    final d = data;
    final List<Widget> body;
    if (d == null && loading) {
      body = const [Busy()];
    } else if (d == null) {
      body = [ErrorRetry(error: error ?? 'error', onRetry: reload)];
    } else if (isEmpty(d)) {
      body = [if (loading) const LinearProgressIndicator(minHeight: 2, color: RS.primary), empty];
    } else {
      body = [
        if (error != null) ...[Notice('Couldn’t refresh: ${errorText(error!)}', tone: 'warning'), const SizedBox(height: 10)],
        ...items(d),
      ];
    }
    return RefreshIndicator(
      color: RS.primary,
      onRefresh: reload,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [...header, ...body],
      ),
    );
  }
}

/* ---- Overview ------------------------------------------------------------ */

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({required this.stats, required this.error, required this.onRefresh});
  final AdminStats? stats;
  final Object? error;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final s = stats;
    final List<Widget> children;
    if (s == null && error == null) {
      children = const [Busy()];
    } else if (s == null) {
      children = [ErrorRetry(error: error!, onRetry: onRefresh)];
    } else {
      final rate = s.bookings.completionRate;
      children = [
        Text('Overview', style: RS.heading(22)),
        const SizedBox(height: 2),
        const Text('Live · updates every 20 seconds', style: TextStyle(color: RS.ink500, fontSize: 13)),
        if (error != null) ...[const SizedBox(height: 10), Notice('Couldn’t refresh: ${errorText(error!)}', tone: 'warning')],
        const SizedBox(height: 14),
        _tileRow(
          _Tile(label: 'Rides completed', value: '${s.rides.completed}'),
          _Tile(label: 'Seats booked', value: '${s.bookings.total}', sub: '${s.bookings.completed} completed trips'),
        ),
        const SizedBox(height: 10),
        _tileRow(
          _Tile(label: 'Cancelled', value: '${s.bookings.cancelled}', sub: '${s.bookings.cancelledByRider} by riders · ${s.bookings.cancelledByDriver} by drivers'),
          _Tile(label: 'Live right now', value: '${s.rides.live}', sub: '${s.bookings.live} riders on the way', live: s.rides.live > 0),
        ),
        const SizedBox(height: 12),
        AdminActivityChart(daily: s.daily),
        const SizedBox(height: 12),
        _StatGroup('Rides offered', [
          ('Total offered', '${s.rides.total}', false),
          ('Upcoming', '${s.rides.scheduled}', false),
          ('Live now', '${s.rides.live}', false),
          ('Completed', '${s.rides.completed}', false),
          ('Cancelled by driver', '${s.rides.cancelled}', false),
          ('Women-only rides', '${s.rides.womenOnly}', false),
        ]),
        const SizedBox(height: 12),
        _StatGroup('Bookings', [
          ('Waiting for driver', '${s.bookings.pending}', false),
          ('Confirmed, upcoming', '${s.bookings.upcoming}', false),
          ('Completed', '${s.bookings.completed}', false),
          ('Cancelled', '${s.bookings.cancelled}', false),
          ('Declined by driver', '${s.bookings.declined}', false),
          ('Expired (no reply)', '${s.bookings.expired}', false),
          if (rate != null) ('Completion rate', '$rate%', false),
        ]),
        const SizedBox(height: 12),
        _StatGroup('Students & safety', [
          ('Students signed up', '${s.users.total}', false),
          ('Finished onboarding', '${s.users.onboarded}', false),
          ('Drivers (with a car)', '${s.users.drivers}', false),
          ('New this week', '${s.users.newThisWeek}', false),
          ('ID verified', '${s.users.verified}', false),
          ('ID cards waiting', '${s.users.pendingIds}', s.users.pendingIds > 0),
          ('Trips shared with family', '${s.bookings.sharedTrips}', false),
        ]),
        const SizedBox(height: 12),
        _StatGroup('Money & impact', [
          ('Fares on completed trips', money(s.money.fares), false),
          ('Paid online', money(s.money.online), false),
          ('Wallet top-ups', money(s.money.walletTopups), false),
          ('Refunds', '${s.money.refunds}', false),
          ('CO₂ saved', '${s.money.co2Kg} kg', false),
        ]),
        const SizedBox(height: 12),
        const _FareRates(),
      ];
    }
    return RefreshIndicator(
      color: RS.primary,
      onRefresh: onRefresh,
      child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 16, 16, 32), children: children),
    );
  }

  Widget _tileRow(Widget a, Widget b) => IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]),
      );
}

/// Fare rate: ₹ per km per seat (suggested price = route km × it). Automatic by default: it follows
/// each car's fuel price (÷ its km per litre / kg / kWh in city traffic ÷ 4 people); the admin can type their own
/// instead, and switch back. CNG and electricity prices are set on the website's admin page.
class _FareRates extends StatefulWidget {
  const _FareRates();
  @override
  State<_FareRates> createState() => _FareRatesState();
}

class _FareRatesState extends State<_FareRates> {
  final _own = TextEditingController();
  Map<String, dynamic>? _r;
  String? _busy, _msg;

  @override
  void initState() {
    super.initState();
    context.read<Session>().api.adminFareRates().then(_show).catchError((_) {
      if (mounted) setState(() => _msg = 'Couldn’t load the fare rate.');
    });
  }

  void _show(Map<String, dynamic> r) {
    if (!mounted) return;
    setState(() => _r = r);
    _own.text = '${(r['rates'] as Map)['perSeatKm']}';
  }

  @override
  void dispose() {
    _own.dispose();
    super.dispose();
  }

  Future<void> _act(String kind) async {
    final api = context.read<Session>().api;
    final limit = ((_r!['limits'] as Map)['perSeatKm'] as Map).cast<String, num>();
    final value = num.tryParse(_own.text.trim()) ?? -1;
    if (kind == 'save' && (value < limit['min']! || value > limit['max']!)) {
      return setState(() => _msg = 'The rate must be between ₹${limit['min']} and ₹${limit['max']}.');
    }
    setState(() => (_busy = kind, _msg = null));
    try {
      if (kind == 'refresh') {
        final r = await api.refreshFuelPrice();
        _show(r);
        final petrol = (r['fuel'] as Map)['petrol'];
        if (mounted) setState(() => _msg = r['refreshed'] == true ? 'Read today’s petrol price: ₹$petrol a litre.' : 'Couldn’t reach the fuel-price websites; still using the last price.');
      } else {
        _show(await api.setFareRates(kind == 'save' ? {'perSeatKm': value} : {'auto': true}));
        if (mounted) setState(() => _msg = kind == 'save' ? 'Saved. New rides use your rate until you switch back to automatic.' : 'Automatic again: new rides follow each car’s fuel price.');
      }
    } catch (e) {
      if (mounted) setState(() => _msg = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final fuel = r == null ? null : (r['fuel'] as Map).cast<String, dynamic>();
    final rate = r == null ? 0 : ((r['rates'] as Map)['perSeatKm'] as num);
    final example = math.max(30, ((25 * rate) / 5).round() * 5);
    final at = fuel?['at'] == null ? '' : ', ${DateFormat('d MMM, h:mm a').format(DateTime.parse(fuel!['at'] as String).toLocal())}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Fare rate', style: RS.heading(16)),
          const SizedBox(height: 4),
          const Text('Like BlaBlaCar: each ride’s suggested price per seat is its distance × this rate, and the driver can set half to one and a half times it (never below ₹30).', style: TextStyle(color: RS.ink500, fontSize: 13)),
          if (r != null && fuel != null) ...[
            const SizedBox(height: 10),
            Row(children: [
              const Expanded(child: Text('Price per km per seat (typical petrol car)', style: TextStyle(color: RS.ink700))),
              Pill(r['auto'] == true ? 'Automatic' : 'Set by admin'),
              const SizedBox(width: 8),
              Text('₹$rate', style: const TextStyle(fontWeight: FontWeight.w600)),
            ]),
            const SizedBox(height: 6),
            Text(
              'Each car is priced from its own fuel: price ÷ km per unit in city traffic (the driver’s own figure if given) ÷ ${fuel['people']} people. Petrol and diesel are read every 6 hours (${fuel['source']}$at); CNG and electricity are set on the website.',
              style: const TextStyle(color: RS.ink500, fontSize: 12.5, height: 1.35),
            ),
            const SizedBox(height: 6),
            for (final f in ((r['fuels'] as List?) ?? const []).cast<Map>())
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  Expanded(child: Text('${f['label']}  ₹${f['price']}/${f['unit']} ÷ ${f['kmPerUnit']} km', style: const TextStyle(color: RS.ink700, fontSize: 13))),
                  Text('₹${f['perSeatKm']}/km · ${f['co2KgPerKm']} kg CO₂', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                ]),
              ),
            const SizedBox(height: 4),
            Text('Example: a 25 km ride is suggested at ₹$example a seat.', style: const TextStyle(color: RS.ink500, fontSize: 12.5)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 4, children: [
              OutlinedButton(onPressed: _busy == null ? () => _act('refresh') : null, child: Text(_busy == 'refresh' ? 'Reading…' : 'Read petrol & diesel prices')),
              if (r['auto'] != true) OutlinedButton(onPressed: _busy == null ? () => _act('auto') : null, child: Text(_busy == 'auto' ? 'Saving…' : 'Use automatic rate')),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              const Expanded(child: Text('Or set your own  ·  ₹/km\nUsed for every car until you switch back', style: TextStyle(color: RS.ink700, fontSize: 13))),
              SizedBox(width: 90, child: TextField(controller: _own, textAlign: TextAlign.right, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(isDense: true))),
            ]),
            const SizedBox(height: 12),
            LoadingButton(label: 'Save my rate', loading: _busy == 'save', onPressed: () => _act('save')),
          ],
          if (_msg != null) ...[const SizedBox(height: 8), Text(_msg!, style: const TextStyle(color: RS.ink500, fontSize: 13))],
        ]),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, this.sub, this.live = false});
  final String label;
  final String value;
  final String? sub;
  final bool live;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (live) ...[
                Container(width: 8, height: 8, decoration: const BoxDecoration(color: RS.success, shape: BoxShape.circle)),
                const SizedBox(width: 6),
              ],
              Flexible(child: Text(label, style: const TextStyle(color: RS.ink500, fontSize: 13, fontWeight: FontWeight.w500))),
            ]),
            const SizedBox(height: 6),
            Text(value, style: RS.heading(28).copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
            if (sub != null) ...[const SizedBox(height: 4), Text(sub!, style: const TextStyle(color: RS.ink500, fontSize: 12, height: 1.3))],
          ]),
        ),
      );
}

class _StatGroup extends StatelessWidget {
  const _StatGroup(this.title, this.rows);
  final String title;

  /// (label, value, highlight)
  final List<(String, String, bool)> rows;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: RS.heading(16)),
            const SizedBox(height: 6),
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const Divider(),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 9),
                child: Row(children: [
                  Expanded(child: Text(rows[i].$1, style: const TextStyle(color: RS.ink700, fontSize: 14))),
                  rows[i].$3
                      ? Pill(rows[i].$2, color: RS.warning, background: RS.warning50)
                      : Text(rows[i].$2, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, fontFeatures: [FontFeature.tabularFigures()])),
                ]),
              ),
            ],
          ]),
        ),
      );
}

/* ---- 14-day activity chart ------------------------------------------------ */

/// Booked, Completed, Cancelled — in this order, everywhere.
const adminSeries = [('Booked', Color(0xFF2A78D6)), ('Completed', Color(0xFF1BAF7A)), ('Cancelled', Color(0xFFEB6834))];

int _seriesValue(AdminDay d, int k) => switch (k) { 0 => d.booked, 1 => d.completed, _ => d.cancelled };

final _dayLabel = DateFormat('d MMM');
String adminDayLabel(AdminDay d) => _dayLabel.format(d.date);

/// Geometry shared by the painter and tap handling, so a tap always lands on the day it hits.
class AdminChartLayout {
  AdminChartLayout(this.size, this.daily);
  final Size size;
  final List<AdminDay> daily;

  static const padL = 30.0, padR = 6.0, padT = 8.0, padB = 22.0, gap = 2.0;

  int get count => daily.length;
  double get plotBottom => size.height - padB;
  double get plotHeight => math.max(1, size.height - padT - padB);
  double get columnWidth => count == 0 ? 0 : math.max(0, size.width - padL - padR) / count;

  /// Thin bars: at most 10 px, leaving room between days.
  double get barWidth => count == 0 ? 0 : ((columnWidth - 8 - gap * 2) / 3).clamp(1.5, 10.0);

  /// Rounded-up axis top (multiple of 4, at least 4) so gridlines land on whole numbers.
  late final int top = () {
    var max = 0;
    for (final d in daily) {
      for (var k = 0; k < 3; k++) {
        max = math.max(max, _seriesValue(d, k));
      }
    }
    return (math.max(4, max) / 4).ceil() * 4;
  }();

  double y(num v) => padT + plotHeight * (1 - v / top);
  double columnLeft(int i) => padL + i * columnWidth;
  double columnCenter(int i) => columnLeft(i) + columnWidth / 2;
  double barLeft(int i, int k) => columnLeft(i) + (columnWidth - (barWidth * 3 + gap * 2)) / 2 + k * (barWidth + gap);

  int? indexAt(double dx) {
    if (count == 0 || columnWidth <= 0) return null;
    return ((dx - padL) / columnWidth).floor().clamp(0, count - 1);
  }
}

class AdminChartPainter extends CustomPainter {
  AdminChartPainter(this.daily, {this.selected});
  final List<AdminDay> daily;
  final int? selected;

  static const _tick = TextStyle(color: RS.ink400, fontSize: 10, fontWeight: FontWeight.w500);

  void _text(Canvas canvas, String s, Offset at, {TextAlign align = TextAlign.left}) {
    final tp = TextPainter(text: TextSpan(text: s, style: _tick), textDirection: TextDirection.ltr)..layout();
    final dx = switch (align) { TextAlign.right => at.dx - tp.width, TextAlign.center => at.dx - tp.width / 2, _ => at.dx };
    tp.paint(canvas, Offset(dx, at.dy - tp.height / 2));
  }

  @override
  void paint(Canvas canvas, Size size) {
    final l = AdminChartLayout(size, daily);
    final grid = Paint()
      ..color = RS.line
      ..strokeWidth = 1;
    final base = Paint()
      ..color = RS.ink200
      ..strokeWidth = 1;
    final sel = selected;
    if (sel != null && sel >= 0 && sel < l.count) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(l.columnLeft(sel), AdminChartLayout.padT, l.columnWidth, l.plotHeight), const Radius.circular(4)),
        Paint()..color = RS.sunken,
      );
    }
    for (final f in const [0.0, 0.25, 0.5, 0.75, 1.0]) {
      final v = l.top * f;
      final yy = l.y(v);
      canvas.drawLine(Offset(AdminChartLayout.padL, yy), Offset(size.width - AdminChartLayout.padR, yy), f == 0 ? base : grid);
      _text(canvas, '${v.round()}', Offset(AdminChartLayout.padL - 6, yy), align: TextAlign.right);
    }
    for (var i = 0; i < l.count; i++) {
      for (var k = 0; k < 3; k++) {
        final v = _seriesValue(daily[i], k);
        if (v <= 0) continue;
        final top = l.y(v);
        final h = l.plotBottom - top;
        if (h <= 0) continue;
        final r = Radius.circular(math.min(4, math.min(h, l.barWidth / 2)));
        final x = l.barLeft(i, k);
        canvas.drawRRect(RRect.fromLTRBAndCorners(x, top, x + l.barWidth, l.plotBottom, topLeft: r, topRight: r), Paint()..color = adminSeries[k].$2);
      }
      // A date under every third day, ending on today.
      if ((l.count - 1 - i) % 3 == 0) _text(canvas, adminDayLabel(daily[i]), Offset(l.columnCenter(i), size.height - AdminChartLayout.padB / 2 + 2), align: TextAlign.center);
    }
  }

  @override
  bool shouldRepaint(AdminChartPainter old) => old.daily != daily || old.selected != selected;
}

class AdminActivityChart extends StatefulWidget {
  const AdminActivityChart({super.key, required this.daily});
  final List<AdminDay> daily;
  @override
  State<AdminActivityChart> createState() => _AdminActivityChartState();
}

class _AdminActivityChartState extends State<AdminActivityChart> {
  int? _selected;
  bool _table = false;

  @override
  void didUpdateWidget(AdminActivityChart old) {
    super.didUpdateWidget(old);
    if (_selected != null && _selected! >= widget.daily.length) _selected = null;
  }

  @override
  Widget build(BuildContext context) {
    final daily = widget.daily;
    final totals = [for (var k = 0; k < 3; k++) daily.fold<int>(0, (a, d) => a + _seriesValue(d, k))];
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Bookings, last 14 days', style: RS.heading(16))),
            FilterChip(
              label: const Text('Table view'),
              selected: _table,
              showCheckmark: false,
              visualDensity: VisualDensity.compact,
              onSelected: (v) => setState(() => (_table = v, _selected = null)),
            ),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 14, runSpacing: 6, children: [
            for (var k = 0; k < 3; k++)
              Row(mainAxisSize: MainAxisSize.min, children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: adminSeries[k].$2, borderRadius: BorderRadius.circular(2))),
                const SizedBox(width: 6),
                Text(adminSeries[k].$1, style: const TextStyle(fontSize: 13, color: RS.ink700)),
                const SizedBox(width: 4),
                Text('${totals[k]}', style: const TextStyle(fontSize: 13, color: RS.ink500, fontWeight: FontWeight.w600)),
              ]),
          ]),
          const SizedBox(height: 12),
          if (_table) _tableView(daily) else _chart(daily),
        ]),
      ),
    );
  }

  Widget _chart(List<AdminDay> daily) => SizedBox(
        height: 210,
        child: LayoutBuilder(builder: (context, box) {
          final size = Size(box.maxWidth, 210);
          final layout = AdminChartLayout(size, daily);
          final sel = _selected;
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: (e) {
              final i = layout.indexAt(e.localPosition.dx);
              setState(() => _selected = i == _selected ? null : i);
            },
            child: Stack(clipBehavior: Clip.none, children: [
              Positioned.fill(
                child: Semantics(
                  label: 'Bookings, completed and cancelled trips per day for the last 14 days',
                  child: CustomPaint(painter: AdminChartPainter(daily, selected: sel)),
                ),
              ),
              if (sel != null && sel < daily.length)
                Positioned(
                  top: 0,
                  left: sel < daily.length / 2 ? layout.columnCenter(sel) + 10 : null,
                  right: sel < daily.length / 2 ? null : size.width - layout.columnCenter(sel) + 10,
                  child: _tooltip(daily[sel]),
                ),
            ]),
          );
        }),
      );

  Widget _tooltip(AdminDay d) => IgnorePointer(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: RS.surface,
            borderRadius: BorderRadius.circular(RS.radiusSm),
            border: Border.all(color: RS.line),
            boxShadow: const [BoxShadow(color: Color(0x1A15182E), blurRadius: 12, offset: Offset(0, 4))],
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(adminDayLabel(d), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            Text('${d.offered} ${d.offered == 1 ? 'ride' : 'rides'} offered', style: const TextStyle(color: RS.ink500, fontSize: 12)),
            const SizedBox(height: 4),
            for (var k = 0; k < 3; k++)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Container(width: 8, height: 8, decoration: BoxDecoration(color: adminSeries[k].$2, borderRadius: BorderRadius.circular(2))),
                  const SizedBox(width: 6),
                  Text(adminSeries[k].$1, style: const TextStyle(fontSize: 12, color: RS.ink700)),
                  const SizedBox(width: 10),
                  Text('${_seriesValue(d, k)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ]),
              ),
          ]),
        ),
      );

  Widget _tableView(List<AdminDay> daily) {
    const head = TextStyle(color: RS.ink500, fontSize: 12, fontWeight: FontWeight.w600);
    const cell = TextStyle(fontSize: 13, fontFeatures: [FontFeature.tabularFigures()]);
    Widget c(String s, TextStyle st, {bool first = false}) =>
        Padding(padding: const EdgeInsets.symmetric(vertical: 7), child: Text(s, style: st, textAlign: first ? TextAlign.left : TextAlign.right));
    return Table(
      columnWidths: const {0: FlexColumnWidth(1.3)},
      defaultVerticalAlignment: TableCellVerticalAlignment.middle,
      children: [
        TableRow(
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: RS.line))),
          children: [c('Day', head, first: true), c('Offered', head), for (final s in adminSeries) c(s.$1, head)],
        ),
        for (final d in daily.reversed)
          TableRow(
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: RS.sunken))),
            children: [c(adminDayLabel(d), cell, first: true), c('${d.offered}', cell), for (var k = 0; k < 3; k++) c('${_seriesValue(d, k)}', cell)],
          ),
      ],
    );
  }
}

/* ---- Rides ---------------------------------------------------------------- */

const _rideFilters = [('', 'All'), ('in_progress', 'Live'), ('scheduled', 'Upcoming'), ('completed', 'Completed'), ('cancelled', 'Cancelled')];

const _riderLabel = {
  'pending': 'requested',
  'accepted': 'accepted',
  'confirmed': 'confirmed',
  'driver_arriving': 'waiting for pickup',
  'driver_arrived': 'driver arrived',
  'in_progress': 'in the car',
  'completed': 'completed',
  'cancelled': 'cancelled',
  'rejected': 'declined',
  'expired': 'expired',
};

/// A rider's booking status in words, e.g. "cancelled by driver · car broke down".
String adminRiderStatus(AdminRider r) {
  final b = StringBuffer(_riderLabel[r.status] ?? r.status.replaceAll('_', ' '));
  if (r.status == 'cancelled' && r.cancelledBy != null) b.write(' by ${r.cancelledBy}');
  if (r.reason != null) b.write(' · ${r.reason}');
  return b.toString();
}

Widget _rideStatusPill(String status) => switch (status) {
      'scheduled' => const Pill('Upcoming', color: RS.route, background: Color(0xFFE8F0FE)),
      'in_progress' => const Pill('● Live', color: RS.success, background: RS.success50),
      'completed' => const Pill('Completed', color: RS.ink700, background: RS.sunken),
      'cancelled' => const Pill('Cancelled', color: RS.danger, background: RS.danger50),
      _ => Pill(status, color: RS.ink700, background: RS.sunken),
    };

class _RidesTab extends StatefulWidget {
  const _RidesTab({required this.pulse});
  final _Pulse pulse;
  @override
  State<_RidesTab> createState() => _RidesTabState();
}

class _RidesTabState extends State<_RidesTab> with _AdminLoad<_RidesTab, List<AdminRide>> {
  String _status = '';

  @override
  void initState() {
    super.initState();
    widget.pulse.addListener(_onPulse);
    reload();
  }

  void _onPulse() => reload(quiet: true);

  @override
  void dispose() {
    widget.pulse.removeListener(_onPulse);
    super.dispose();
  }

  @override
  Future<List<AdminRide>> fetch(Api api) => api.adminRides(_status);

  @override
  Widget build(BuildContext context) => scroller(
        header: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final (v, label) in _rideFilters)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(label),
                    selected: _status == v,
                    showCheckmark: false,
                    onSelected: (_) {
                      if (_status == v) return;
                      setState(() => (_status = v, data = null));
                      reload();
                    },
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 12),
        ],
        isEmpty: (d) => d.isEmpty,
        empty: const EmptyState(icon: Icons.directions_car_outlined, title: 'No rides here yet', body: 'Rides appear here the moment a student offers one.'),
        items: (d) => [
          for (final r in d) ...[_RideCard(r), const SizedBox(height: 10)],
        ],
      );
}

class _RideCard extends StatelessWidget {
  const _RideCard(this.r);
  final AdminRide r;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${r.from} → ${r.to}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15), maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Text('${r.driver} · ${when(r.departAt)} · ${money(r.farePerSeat)}/seat', style: const TextStyle(color: RS.ink500, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [_rideStatusPill(r.status), if (r.womenOnly) const WomenOnlyPill()]),
            const SizedBox(height: 10),
            const Divider(),
            const SizedBox(height: 6),
            if (r.riders.isEmpty)
              Text('No riders yet · ${r.seatsTotal} ${r.seatsTotal == 1 ? 'seat' : 'seats'} · offered ${_relative(r.createdAt)}', style: const TextStyle(color: RS.ink500, fontSize: 13))
            else
              for (final b in r.riders)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.person_outline, size: 16, color: RS.ink400)),
                    const SizedBox(width: 6),
                    Expanded(flex: 2, child: Text(b.seats > 1 ? '${b.name} (${b.seats} seats)' : b.name, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis)),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 3,
                      child: Text(
                        adminRiderStatus(b),
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          fontSize: 13,
                          color: b.status == 'cancelled' || b.status == 'rejected'
                              ? RS.danger
                              : b.status == 'completed'
                                  ? RS.success
                                  : RS.ink500,
                        ),
                      ),
                    ),
                  ]),
                ),
          ]),
        ),
      );
}

/// "just now", "5 min ago", "today"-style relative time, lower-cased for mid-sentence use.
String _relative(DateTime t) {
  final s = ago(t);
  if (s == 'now') return 'just now';
  if (s == 'Today' || s == 'Yesterday' || s == 'Tomorrow') return s.toLowerCase();
  return s;
}

/* ---- Students ------------------------------------------------------------- */

class _StudentsTab extends StatefulWidget {
  const _StudentsTab({required this.pulse});
  final _Pulse pulse;
  @override
  State<_StudentsTab> createState() => _StudentsTabState();
}

class _StudentsTabState extends State<_StudentsTab> with _AdminLoad<_StudentsTab, List<AdminUser>> {
  final _search = TextEditingController();
  String _term = '';
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    widget.pulse.addListener(_onPulse);
    reload();
  }

  void _onPulse() => reload(quiet: true);

  void _onType(String v) {
    setState(() {}); // show / hide the clear button
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final t = v.trim();
      if (t == _term || !mounted) return;
      _term = t;
      reload(quiet: data != null);
    });
  }

  @override
  void dispose() {
    widget.pulse.removeListener(_onPulse);
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  Future<List<AdminUser>> fetch(Api api) => api.adminUsers(_term);

  @override
  Widget build(BuildContext context) => scroller(
        header: [
          TextField(
            controller: _search,
            onChanged: _onType,
            textInputAction: TextInputAction.search,
            autocorrect: false,
            decoration: InputDecoration(
              hintText: 'Search name, email or student ID',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _search.clear();
                        _onType('');
                      },
                    ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        isEmpty: (d) => d.isEmpty,
        empty: EmptyState(icon: Icons.people_outline, title: 'No students found', body: _term.isNotEmpty ? 'Try another name or email.' : 'Students appear here after they sign in.'),
        items: (d) => [
          for (final u in d) ...[_StudentCard(u), const SizedBox(height: 10)],
        ],
      );
}

class _StudentCard extends StatelessWidget {
  const _StudentCard(this.u);
  final AdminUser u;

  Widget get _idPill => switch (u.idStatus) {
        'verified' => const Pill('Verified', color: RS.success, background: RS.success50),
        'pending' => const Pill('Waiting', color: RS.warning, background: RS.warning50),
        'rejected' => const Pill('Rejected', color: RS.danger, background: RS.danger50),
        _ => const Pill('Not sent', color: RS.ink500, background: RS.sunken),
      };

  @override
  Widget build(BuildContext context) {
    final notes = [if (u.hasCar) 'has a car', if (!u.onboarded) 'not finished sign-up'];
    const muted = TextStyle(color: RS.ink500, fontSize: 13);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Row(children: [
                Flexible(child: Text(u.name.isEmpty ? 'New student' : u.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15), overflow: TextOverflow.ellipsis)),
                if (u.idStatus == 'verified') ...[const SizedBox(width: 4), const VerifiedBadge()],
              ]),
            ),
            const SizedBox(width: 8),
            _idPill,
          ]),
          const SizedBox(height: 2),
          Text(u.email, style: muted, overflow: TextOverflow.ellipsis),
          Text('${u.studentId.isEmpty ? '—' : u.studentId} · ${u.phone.isEmpty ? 'no phone' : '+91 ${u.phone}'}', style: muted),
          if (notes.isNotEmpty) Text(notes.join(' · '), style: const TextStyle(color: RS.ink400, fontSize: 12.5)),
          const SizedBox(height: 6),
          Text.rich(
            TextSpan(style: const TextStyle(fontSize: 13, color: RS.ink700), children: [
              TextSpan(text: 'Offered ${u.offered} · Taken ${u.taken} · '),
              TextSpan(
                text: 'Cancels ${u.cancels}',
                style: u.cancels >= 3 ? const TextStyle(color: RS.danger, fontWeight: FontWeight.w700) : null,
              ),
              TextSpan(text: ' · joined ${_relative(u.createdAt)}', style: const TextStyle(color: RS.ink400)),
            ]),
          ),
        ]),
      ),
    );
  }
}

/* ---- ID checks ------------------------------------------------------------ */

const _rejectReasons = ['Photo not clear', 'Name doesn’t match profile', 'Not a VIT ID card', 'Student ID doesn’t match'];

class _IdChecksTab extends StatefulWidget {
  const _IdChecksTab({required this.pulse, required this.onChanged});
  final _Pulse pulse;

  /// After a decision, so the shell's waiting-count badge updates.
  final VoidCallback onChanged;
  @override
  State<_IdChecksTab> createState() => _IdChecksTabState();
}

class _IdChecksTabState extends State<_IdChecksTab> with _AdminLoad<_IdChecksTab, List<IdCardReview>> {
  @override
  void initState() {
    super.initState();
    widget.pulse.addListener(_onPulse);
    reload();
  }

  void _onPulse() => reload(quiet: true);

  @override
  void dispose() {
    widget.pulse.removeListener(_onPulse);
    super.dispose();
  }

  @override
  Future<List<IdCardReview>> fetch(Api api) => api.adminIdCards();

  /// Keep cards we already have so their photos aren't decoded again on every refresh.
  @override
  List<IdCardReview> merge(List<IdCardReview> fresh) {
    final old = {for (final c in data ?? const <IdCardReview>[]) c.userId: c};
    return [
      for (final c in fresh)
        if (old[c.userId] case final o? when o.submittedAt == c.submittedAt) o else c,
    ];
  }

  void _done(String userId) {
    setState(() => data = data?.where((c) => c.userId != userId).toList());
    widget.onChanged();
    reload(quiet: true);
  }

  @override
  Widget build(BuildContext context) => scroller(
        header: const [
          Text(
            'Check that the name and student ID on the card match the profile. Approving gives the student the blue Verified tick; the photo is deleted either way.',
            style: TextStyle(color: RS.ink500, height: 1.4),
          ),
          SizedBox(height: 12),
        ],
        isEmpty: (d) => d.isEmpty,
        empty: const EmptyState(icon: Icons.verified_outlined, title: 'All caught up', body: 'New ID cards will appear here, and you’ll get a notification.'),
        items: (d) => [
          for (final c in d) ...[_IdReviewCard(key: ValueKey(c.userId), c: c, onDone: () => _done(c.userId)), const SizedBox(height: 12)],
        ],
      );
}

class _IdReviewCard extends StatefulWidget {
  const _IdReviewCard({super.key, required this.c, required this.onDone});
  final IdCardReview c;
  final VoidCallback onDone;
  @override
  State<_IdReviewCard> createState() => _IdReviewCardState();
}

class _IdReviewCardState extends State<_IdReviewCard> {
  String _reason = _rejectReasons.first;

  /// 'yes' while approving, 'no' while rejecting.
  String? _busy;

  Future<void> _decide(bool approve) async {
    final c = widget.c;
    setState(() => _busy = approve ? 'yes' : 'no');
    try {
      await context.read<Session>().api.reviewIdCard(c.userId, approve, approve ? null : _reason);
      if (!mounted) return;
      toast(context, approve ? '${c.name} is now verified' : '${c.name} asked to upload again');
      widget.onDone();
    } catch (e) {
      if (mounted) {
        toast(context, errorText(e));
        setState(() => _busy = null);
      }
    }
  }

  void _openFull(Uint8List bytes) => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(widget.c.name, style: const TextStyle(color: Colors.white))),
          body: Center(child: InteractiveViewer(minScale: 1, maxScale: 6, child: Image.memory(bytes, fit: BoxFit.contain, gaplessPlayback: true))),
        ),
      ));

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final bytes = c.bytes;
    final busy = _busy != null;
    const spinner = SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 2),
          Text(
            [c.studentId.isEmpty ? 'No student ID' : c.studentId, c.email, ?c.programme, 'sent ${_relative(c.submittedAt)}'].join(' · '),
            style: const TextStyle(color: RS.ink500, fontSize: 13),
          ),
          const SizedBox(height: 10),
          if (bytes == null)
            Container(
              height: 120,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: RS.sunken, borderRadius: BorderRadius.circular(RS.radiusMd)),
              child: const Text('Couldn’t show this photo', style: TextStyle(color: RS.ink500)),
            )
          else
            GestureDetector(
              onTap: () => _openFull(bytes),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(RS.radiusMd),
                child: Container(
                  width: double.infinity,
                  color: RS.sunken,
                  constraints: const BoxConstraints(maxHeight: 360),
                  child: Image.memory(
                    bytes,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    semanticLabel: 'ID card uploaded by ${c.name}',
                    errorBuilder: (_, _, _) => const Padding(padding: EdgeInsets.all(24), child: Text('Couldn’t show this photo', style: TextStyle(color: RS.ink500))),
                  ),
                ),
              ),
            ),
          const SizedBox(height: 6),
          const Text('Tap the photo to zoom. Check the name, photo and student ID match the profile.', style: TextStyle(color: RS.ink500, fontSize: 12.5)),
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final r in _rejectReasons)
              ChoiceChip(
                label: Text(r),
                selected: _reason == r,
                showCheckmark: false,
                visualDensity: VisualDensity.compact,
                onSelected: busy ? null : (_) => setState(() => _reason = r),
              ),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: busy ? null : () => _decide(false),
                style: OutlinedButton.styleFrom(foregroundColor: RS.danger, side: const BorderSide(color: RS.danger)),
                icon: _busy == 'no' ? spinner : const Icon(Icons.close, size: 20),
                label: const Text('Reject'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                onPressed: busy ? null : () => _decide(true),
                style: FilledButton.styleFrom(minimumSize: const Size(64, 48)),
                icon: _busy == 'yes' ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white)) : const Icon(Icons.verified_outlined, size: 20),
                label: const Text('Approve'),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}
