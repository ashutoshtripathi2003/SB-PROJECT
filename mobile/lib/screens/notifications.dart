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

class NotificationsList extends StatefulWidget {
  const NotificationsList({super.key});
  @override
  State<NotificationsList> createState() => _NotificationsListState();
}

class _NotificationsListState extends State<NotificationsList> {
  bool _seen = false;

  /// Looking at the list counts as reading it (like Uber / Instagram): the Inbox badge clears.
  void _markSeen(List<AppNotification> list) {
    if (_seen || list.every((n) => n.read)) return;
    _seen = true;
    final api = context.read<Session>().api;
    WidgetsBinding.instance.addPostFrameCallback((_) => api.readAllNotifications().catchError((_) {}));
  }

  @override
  Widget build(BuildContext context) => LiveLoader<List<AppNotification>>(
        load: (api) => api.notifications(),
        builder: (context, list, reload) {
          _markSeen(list);
          if (list.isEmpty) {
            return ListView(children: const [EmptyState(icon: Icons.notifications_none, title: 'You’re all caught up', body: 'Ride requests, acceptances and payments show up here.')]);
          }
          final unread = list.where((n) => !n.read).length;
          return ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: list.length + 1,
            separatorBuilder: (_, i) => i == 0 ? const SizedBox() : const Divider(indent: 72),
            itemBuilder: (context, index) {
              if (index == 0) {
                return Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 8, 4),
                  child: Row(children: [
                    Text(unread == 0 ? 'All caught up' : '$unread unread', style: const TextStyle(color: RS.ink500, fontWeight: FontWeight.w600)),
                    const Spacer(),
                    if (unread > 0)
                      TextButton(
                        onPressed: () async {
                          await attempt(context, () => context.read<Session>().api.readAllNotifications());
                          await reload();
                        },
                        child: const Text('Mark all read'),
                      ),
                  ]),
                );
              }
              final n = list[index - 1];
              return ListTile(
                tileColor: n.read ? null : RS.primary50,
                leading: CircleAvatar(backgroundColor: n.read ? RS.sunken : RS.primary100, child: Icon(_icon(n.kind), color: RS.primary, size: 20)),
                title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700)),
                subtitle: Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: Text(ago(n.createdAt), style: const TextStyle(color: RS.ink500, fontSize: 12)),
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
              );
            },
          );
        },
      );
}

/// Notifications without a linked ride (welcome, system messages) open as a sheet.
void _showDetail(BuildContext context, AppNotification n) => showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(backgroundColor: RS.primary100, child: Icon(_icon(n.kind), color: RS.primary, size: 20)),
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
