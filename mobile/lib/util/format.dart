import '../api/models.dart';
import 'package:intl/intl.dart';

final _time = DateFormat('h:mm a');
final _day = DateFormat('EEE, d MMM');

String money(num v) => '₹${NumberFormat.decimalPattern('en_IN').format(v.round())}';

String timeOf(DateTime t) => _time.format(t);

bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

/// "Today", "Tomorrow" or "Mon, 14 Oct".
String dayOf(DateTime t) {
  final now = DateTime.now();
  if (_sameDay(t, now)) return 'Today';
  if (_sameDay(t, now.add(const Duration(days: 1)))) return 'Tomorrow';
  if (_sameDay(t, now.subtract(const Duration(days: 1)))) return 'Yesterday';
  return _day.format(t);
}

String when(DateTime t) => '${dayOf(t)}, ${timeOf(t)}';

String km(double v) => v < 1 ? '${(v * 1000).round()} m' : '${v.toStringAsFixed(v < 10 ? 1 : 0)} km';

String minutes(int m) => m < 60 ? '$m min' : '${m ~/ 60} h ${m % 60} min';

String ago(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  return dayOf(t);
}

/// "Just now" for under 45 s, else like [ago].
String seen(DateTime t) => DateTime.now().difference(t).inSeconds < 45 ? 'just now' : ago(t);

/// 5:07
String mmss(int s) => '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';

/// Riders get 5 minutes after the driver arrives; then the driver may mark a no-show.
const freeWaitSeconds = 5 * 60;

const preferenceLabel = {
  'quiet': 'Quiet ride',
  'female_friendly': 'Female-friendly',
  'no_smoking': 'No smoking',
  'no_pets': 'No pets',
  'minimal_detour': 'Minimal detour',
  'music_ok': 'Music on',
  'ac': 'AC',
};

const bookingStatusLabel = {
  'pending': 'Waiting for driver',
  'accepted': 'Accepted — choose payment',
  'rejected': 'Declined',
  'confirmed': 'Seat confirmed',
  'driver_arriving': 'Driver on the way',
  'driver_arrived': 'Driver has arrived',
  'in_progress': 'On the ride',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
};

String paymentLabel(String? method, String status) {
  final m = switch (method) { 'upi' => 'UPI', 'cash' => 'Cash', 'online' => 'Online', 'wallet' => 'Wallet', _ => '' };
  return switch (status) {
    'paid_online' when method == 'wallet' => 'Paid from wallet',
    'marked_paid' => '$m · paid, waiting for driver',
    'received' => '$m · received',
    'paid_online' => 'Paid online',
    'refunded' => 'Refunded',
    _ => method == 'cash' ? 'Cash at pickup' : 'Not paid yet',
  };
}

/// Suggested cost-sharing contribution per seat (same formula as the server).
int suggestFarePerSeat(double distanceKm, int seats, String fuel) {
  final perKm = const {'petrol': 11, 'diesel': 10, 'cng': 7, 'ev': 5}[fuel] ?? 11;
  final raw = distanceKm * perKm / (seats + 1);
  final v = (raw / 10).round() * 10;
  return v < 40 ? 40 : v;
}

int maxFareFor(int suggested) => ((suggested * 1.5) / 10).round() * 10;

/// " · +8 min traffic" when the route has live traffic, else "".
String trafficNote(RouteInfo r) => switch (r.traffic) {
      'heavy' || 'moderate' => ' · +${r.trafficDelayMin} min traffic',
      'light' => ' · light traffic',
      _ => '',
    };
