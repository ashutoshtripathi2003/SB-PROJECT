import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'chat.dart';
import 'notifications.dart';

const _ended = {'completed', 'cancelled', 'rejected'};

/// Inbox, Uber / Rapido style: Messages and Notifications behind one pill switch.
class InboxTab extends StatefulWidget {
  const InboxTab({super.key});
  @override
  State<InboxTab> createState() => _InboxTabState();
}

class _InboxTabState extends State<InboxTab> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: RS.canvas,
        appBar: AppBar(title: const Text('Inbox'), backgroundColor: RS.canvas, surfaceTintColor: RS.canvas),
        body: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(color: RS.sunken, borderRadius: BorderRadius.circular(999)),
              child: Row(children: [
                for (final (i, label) in const ['Messages', 'Notifications'].indexed)
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _tab = i),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        height: 40,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: _tab == i ? RS.surface : Colors.transparent,
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: _tab == i ? const [BoxShadow(color: Color(0x1415182E), blurRadius: 6, offset: Offset(0, 1))] : null,
                        ),
                        child: Text(label, style: TextStyle(fontWeight: FontWeight.w600, color: _tab == i ? RS.ink900 : RS.ink500)),
                      ),
                    ),
                  ),
              ]),
            ),
          ),
          Expanded(child: _tab == 0 ? const _Messages() : const NotificationsList()),
        ]),
      );
}

class _Messages extends StatelessWidget {
  const _Messages();

  @override
  Widget build(BuildContext context) => LiveLoader<List<Thread>>(
        load: (api) => api.threads(),
        builder: (context, threads, reload) {
          if (threads.isEmpty) {
            return ListView(children: const [
              EmptyState(icon: Icons.forum_outlined, title: 'No messages yet', body: 'When a driver accepts your request — or you accept a rider — you can chat about the pickup here.'),
            ]);
          }
          final active = threads.where((t) => !_ended.contains(t.status)).toList();
          final past = threads.where((t) => _ended.contains(t.status)).toList();
          return ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
            for (final (label, items) in [('UPCOMING RIDES', active), ('PAST RIDES', past)])
              if (items.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
                  child: Text(label, style: const TextStyle(color: RS.ink500, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
                ),
                for (final t in items) _ThreadCard(t),
              ],
          ]);
        },
      );
}

class _ThreadCard extends StatelessWidget {
  const _ThreadCard(this.t);
  final Thread t;

  @override
  Widget build(BuildContext context) {
    final unread = t.unread > 0;
    final preview = t.last == null ? 'Say hi to ${t.other.firstName} about the pickup' : t.last!.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: RS.surface,
        borderRadius: BorderRadius.circular(RS.radiusLg),
        child: InkWell(
          borderRadius: BorderRadius.circular(RS.radiusLg),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(bookingId: t.bookingId, other: t.other))),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(RS.radiusLg), border: Border.all(color: unread ? RS.primary : RS.line, width: unread ? 1.5 : 1)),
            child: Row(children: [
              Avatar(name: t.other.name, photo: t.other.photo, size: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: NameWithBadge(t.other, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: RS.ink900))),
                    if (t.last != null) Text(ago(t.last!.createdAt), style: const TextStyle(color: RS.ink400, fontSize: 12)),
                  ]),
                  const SizedBox(height: 2),
                  Text('${t.role == 'driver' ? 'Your rider' : 'Your driver'} · ${t.ride.origin.name} → ${t.ride.destination.name} · ${when(t.ride.departAt)}',
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: RS.ink500, fontSize: 12)),
                  const SizedBox(height: 4),
                  Row(children: [
                    Expanded(
                      child: Text(preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 14, color: unread ? RS.ink900 : (t.last == null ? RS.ink400 : RS.ink700), fontWeight: unread ? FontWeight.w600 : FontWeight.w400)),
                    ),
                    const SizedBox(width: 8),
                    if (unread)
                      CountBadge(t.unread)
                    else if (!_ended.contains(t.status))
                      Pill.status(t.status, bookingStatusLabel[t.status] ?? t.status),
                  ]),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// A small round count, e.g. unread messages.
class CountBadge extends StatelessWidget {
  const CountBadge(this.count, {super.key});
  final int count;
  @override
  Widget build(BuildContext context) => Container(
        constraints: const BoxConstraints(minWidth: 20),
        height: 20,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: RS.primary, borderRadius: BorderRadius.circular(999)),
        child: Text(count > 9 ? '9+' : '$count', style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
      );
}
