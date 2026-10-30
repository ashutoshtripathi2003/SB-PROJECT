import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'shell.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Notifications'),
          actions: [TextButton(onPressed: () => attempt(context, () => context.read<Session>().api.readAllNotifications()), child: const Text('Mark all read'))],
        ),
        body: const NotificationsList(),
      );
}

IconData _icon(String kind) => switch (kind) {
      'request' => Icons.person_add_alt_1_outlined,
      'accepted' => Icons.check_circle_outline,
      'rejected' || 'cancelled' => Icons.cancel_outlined,
      'payment' => Icons.payments_outlined,
      'arriving' => Icons.directions_car_outlined,
      'chat' => Icons.chat_bubble_outline,
      'match' => Icons.auto_awesome,
      _ => Icons.notifications_none,
    };

/// Icon colour and background for each kind (green good news, red cancellations, purple requests).
(Color, Color) _tone(String kind) => switch (kind) {
      'accepted' || 'payment' => (RS.success, RS.success50),
      'rejected' || 'cancelled' => (RS.danger, RS.danger50),
      'request' || 'match' => (RS.primary, RS.primary50),
      'arriving' => (RS.secondary, const Color(0xFFEEF2FF)),
      _ => (RS.ink500, RS.sunken),
    };

/// Filters, like Uber's inbox. Chat messages live in the Messages tab, so they're left out here.
const _filters = [
  ('All', {'request', 'accepted', 'rejected', 'cancelled', 'payment', 'arriving', 'match', 'system'}),
  ('Rides', {'request', 'accepted', 'rejected', 'cancelled', 'arriving', 'match'}),
  ('Payments', {'payment'}),
  ('Updates', {'system'}),
];

class NotificationsList extends StatefulWidget {
  const NotificationsList({super.key});
  @override
  State<NotificationsList> createState() => _NotificationsListState();
}

class _NotificationsListState extends State<NotificationsList> {
  bool _seen = false;
  int _filter = 0;

  /// Looking at the list counts as reading it (like Uber / Instagram): the Inbox badge clears.
  void _markSeen(List<AppNotification> list) {
    if (_seen || list.every((n) => n.read)) return;
    _seen = true;
    final api = context.read<Session>().api;
    Future.delayed(const Duration(milliseconds: 1500), () => api.readAllNotifications().catchError((_) {}));
  }

  @override
  Widget build(BuildContext context) => LiveLoader<List<AppNotification>>(
        load: (api) => api.notifications(),
        builder: (context, all, reload) {
          final list = all.where((n) => n.kind != 'chat').toList();
          _markSeen(list);
          final shown = list.where((n) => _filters[_filter].$2.contains(n.kind)).toList();
          final groups = <String, List<AppNotification>>{};
          for (final n in shown) {
            final d = dayOf(n.createdAt);
            groups.putIfAbsent(d == 'Today' || d == 'Yesterday' ? d : 'Earlier', () => []).add(n);
          }
          return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
            SizedBox(
              height: 40,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final (i, f) in _filters.indexed)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(label: Text(f.$1), selected: _filter == i, showCheckmark: false, onSelected: (_) => setState(() => _filter = i)),
                  ),
              ]),
            ),
            if (shown.isEmpty)
              EmptyState(icon: Icons.notifications_none, title: 'You’re all caught up', body: _filter == 0 ? 'Ride requests, acceptances and payments show up here.' : 'Nothing here yet.'),
            for (final g in groups.entries) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
                child: Text(g.key.toUpperCase(), style: const TextStyle(color: RS.ink500, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
              ),
              for (final n in g.value) _NotificationRow(n, reload),
            ],
          ]);
        },
      );
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow(this.n, this.reload);
  final AppNotification n;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = _tone(n.kind);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: n.read ? Colors.transparent : RS.primary50,
        borderRadius: BorderRadius.circular(RS.radiusMd),
        child: InkWell(
          borderRadius: BorderRadius.circular(RS.radiusMd),
          onTap: () async {
            if (!n.read) {
              await context.read<Session>().api.post('/notifications/${n.id}/read').catchError((_) => null);
              reload();
            }
            if (!context.mounted) return;
            if (n.link != null) {
              openLink(context, n.link!);
            } else {
              _showDetail(context, n);
            }
          },
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              CircleAvatar(radius: 22, backgroundColor: bg, child: Icon(_icon(n.kind), color: fg, size: 20)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w600 : FontWeight.w700, fontSize: 15, color: RS.ink900))),
                    const SizedBox(width: 8),
                    Text(ago(n.createdAt), style: const TextStyle(color: RS.ink400, fontSize: 12)),
                  ]),
                  const SizedBox(height: 2),
                  Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: RS.ink500, fontSize: 13.5, height: 1.35)),
                ]),
              ),
              if (n.link != null) const Padding(padding: EdgeInsets.only(left: 4, top: 10), child: Icon(Icons.chevron_right_rounded, color: RS.ink400, size: 20)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Notifications without a linked ride (welcome, system messages) open as a sheet.
void _showDetail(BuildContext context, AppNotification n) => showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(backgroundColor: _tone(n.kind).$2, child: Icon(_icon(n.kind), color: _tone(n.kind).$1, size: 20)),
              const SizedBox(width: 12),
              Expanded(child: Text(n.title, style: RS.heading(18))),
            ]),
            const SizedBox(height: 12),
            Text(n.body, style: const TextStyle(fontSize: 15, height: 1.45, color: RS.ink700)),
            const SizedBox(height: 8),
            Text(ago(n.createdAt), style: const TextStyle(color: RS.ink500, fontSize: 12)),
            const SizedBox(height: 16),
            LoadingButton(label: 'Close', secondary: true, onPressed: () => Navigator.pop(sheet)),
          ]),
        ),
      ),
    );
