import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import '../util/format.dart';
import 'common.dart';

/// From → to with a dot and square, like the website's route summary.
class RouteLine extends StatelessWidget {
  const RouteLine({super.key, required this.from, required this.to, this.fromTime, this.toTime, this.dense = false});
  final Place from;
  final Place to;
  final String? fromTime;
  final String? toTime;
  final bool dense;

  Widget _stop(Place p, String? time, bool end) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: end ? RS.primary : RS.ink900, shape: end ? BoxShape.rectangle : BoxShape.circle, borderRadius: end ? BorderRadius.circular(2) : null),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(p.name, style: TextStyle(fontWeight: FontWeight.w600, fontSize: dense ? 14 : 15), maxLines: 1, overflow: TextOverflow.ellipsis),
            if (!dense && p.area.isNotEmpty) Text(p.area, style: const TextStyle(color: RS.ink500, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        if (time != null) Text(time, style: const TextStyle(color: RS.ink700, fontWeight: FontWeight.w600, fontSize: 13)),
      ]);

  @override
  Widget build(BuildContext context) => Column(children: [
        _stop(from, fromTime, false),
        Padding(
          padding: const EdgeInsets.only(left: 4.5),
          child: Align(alignment: Alignment.centerLeft, child: Container(width: 1.5, height: dense ? 12 : 16, color: RS.ink200)),
        ),
        _stop(to, toTime, true),
      ]);
}

class DriverRow extends StatelessWidget {
  const DriverRow({super.key, required this.driver, this.vehicle, this.trailing});
  final PublicUser driver;
  final Vehicle? vehicle;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(children: [
        Avatar(name: driver.name, photo: driver.photo, size: 42),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(driver.name, style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
              if (driver.verified) ...[const SizedBox(width: 4), const VerifiedBadge()],
              const SizedBox(width: 6),
              RatingText(driver),
            ]),
            if (vehicle != null) Text('${vehicle!.title} · ${vehicle!.plate}', style: const TextStyle(color: RS.ink500, fontSize: 12.5), overflow: TextOverflow.ellipsis),
          ]),
        ),
        ?trailing,
      ]);
}

/// A ride offer in lists (Home feed, search results).
class RideCard extends StatelessWidget {
  const RideCard({super.key, required this.ride, required this.driver, required this.vehicle, this.fare, this.score, this.tier, this.aiChance, this.onTap});
  final Ride ride;
  final PublicUser driver;
  final Vehicle vehicle;
  final int? fare;
  final int? score;
  final String? tier;

  /// ML chance the driver accepts; "✨ AI pick" from 75%.
  final double? aiChance;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final arrive = ride.departAt.add(Duration(minutes: ride.durationMin));
    return Panel(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(when(ride.departAt), style: RS.heading(15)),
          const Spacer(),
          if (score != null) ...[MatchBadge(score: score!, tier: tier), const SizedBox(width: 8)],
          Text(money(fare ?? ride.farePerSeat), style: RS.heading(18, color: RS.primary)),
        ]),
        if (ride.womenOnly || (aiChance ?? 0) >= 0.75) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [if (ride.womenOnly) const WomenOnlyPill(), if ((aiChance ?? 0) >= 0.75) const AiPill('AI pick')]),
        ],
        const SizedBox(height: 12),
        RouteLine(from: ride.origin, to: ride.destination, fromTime: timeOf(ride.departAt), toTime: timeOf(arrive), dense: true),
        const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Divider()),
        DriverRow(
          driver: driver,
          vehicle: vehicle,
          trailing: Pill('${ride.seatsLeft} seat${ride.seatsLeft == 1 ? '' : 's'} left', icon: Icons.event_seat_outlined),
        ),
      ]),
    );
  }
}

class MatchBadge extends StatelessWidget {
  const MatchBadge({super.key, required this.score, this.tier});
  final int score;
  final String? tier;
  @override
  Widget build(BuildContext context) {
    final (fg, bg) = switch (tier) {
      'excellent' => (RS.success, RS.success50),
      'good' => (RS.primary, RS.primary50),
      'fair' => (RS.warning, RS.warning50),
      _ => (RS.ink700, RS.sunken),
    };
    return Pill('$score% match', color: fg, background: bg, icon: Icons.auto_awesome);
  }
}

/// Purple gradient pill for hints from RideSync's ML models ("✨ AI pick").
class AiPill extends StatelessWidget {
  const AiPill(this.label, {super.key, this.tooltip});
  final String label;
  final String? tooltip;
  static const fg = Color(0xFF4A2FC4);
  @override
  Widget build(BuildContext context) {
    final pill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFFEFE9FF), Color(0xFFE3EDFF)]), borderRadius: BorderRadius.circular(999)),
      child: Text('✨ $label', style: const TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
    );
    return tooltip == null ? pill : Tooltip(message: tooltip!, child: pill);
  }
}

/// "✨ AI: 82% likely to accept" — the match model's prediction for this request.
class AiChancePill extends StatelessWidget {
  const AiChancePill(this.chance, {super.key});
  final double chance;
  @override
  Widget build(BuildContext context) => AiPill('AI: ${(chance * 100).round()}% likely to accept', tooltip: 'Predicted by RideSync’s matching model from past requests');
}

/// Rider reliability from the no-show/cancellation model.
class ReliabilityPill extends StatelessWidget {
  const ReliabilityPill(this.risk, {super.key});
  final double risk;
  @override
  Widget build(BuildContext context) => risk < 0.25
      ? const Pill('Usually shows up', color: RS.success, background: RS.success50)
      : risk < 0.5
          ? const Pill('Sometimes cancels', color: RS.warning, background: RS.warning50)
          : const Pill('Often cancels', color: RS.danger, background: RS.danger50);
}
