import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/motion.dart';
import 'assistant.dart';
import 'find.dart';
import 'home.dart';
import 'inbox.dart';
import 'profile.dart';
import 'rides.dart';
import 'trip.dart';
import 'drive.dart';

/// Bottom tabs: Home · Find · My Rides · Inbox · Profile. Shows live notifications as banners.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;
  int _unread = 0;
  int _requests = 0;
  StreamSubscription<AppNotification>? _notes;
  StreamSubscription<void>? _sync;

  /// The assistant conversation, kept while the app is open.
  final List<AssistantMsg> _assistant = [];

  @override
  void initState() {
    super.initState();
    final s = context.read<Session>();
    _notes = s.events?.onNotification.listen(_showBanner);
    _sync = s.events?.onSync.listen((_) => _loadBadges());
    _loadBadges();
  }

  Future<void> _loadBadges() async {
    try {
      final b = await context.read<Session>().api.badges();
      if (mounted) setState(() => (_unread = b.unread, _requests = b.requests));
    } catch (_) {}
  }

  void _showBanner(AppNotification n) {
    if (!mounted) return;
    // Big moments for the replies people wait for; a banner for everything else.
    final moment = switch (n.kind) {
      'accepted' => (Moment.accepted, 'Ride accepted!', 'Confirm your seat'),
      'request' => (Moment.sent, 'New ride request', 'View request'),
      'rejected' => (Moment.declined, 'Request declined', 'Find another ride'),
      'cancelled' => (Moment.cancelled, n.title, 'View details'),
      _ => null,
    };
    if (moment != null) {
      final link = n.link;
      showMoment(context, moment.$1, moment.$2,
          subtitle: n.kind == 'cancelled' ? n.body : '${n.title}. ${n.body}',
          actionLabel: link == null && n.kind != 'rejected' ? null : moment.$3,
          onAction: () => n.kind == 'rejected' || link == null ? goTo(1) : openLink(context, link));
      _loadBadges();
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        duration: const Duration(seconds: 5),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(n.title, style: const TextStyle(fontWeight: FontWeight.w700)),
          if (n.body.isNotEmpty) Text(n.body, maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
        action: n.link == null ? null : SnackBarAction(label: 'Open', textColor: const Color(0xFFB7A9FC), onPressed: () => openLink(context, n.link!)),
      ));
  }

  @override
  void dispose() {
    _notes?.cancel();
    _sync?.cancel();
    super.dispose();
  }

  void goTo(int tab) => setState(() => _tab = tab);

  @override
  Widget build(BuildContext context) {
    final pages = [HomeTab(onFind: () => goTo(1)), const FindTab(), const RidesTab(), const InboxTab(), const ProfileTab()];
    final student = context.select<Session, bool>((s) => s.user != null && !s.user!.adminOnly);
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      floatingActionButton: !student
          ? null
          : AnimatedPadding(
              // Above the "Find a ride" button pinned to the bottom of the Find tab.
              padding: EdgeInsets.only(bottom: _tab == 1 ? 76 : 0),
              duration: const Duration(milliseconds: 200),
              child: FloatingActionButton(
                heroTag: 'assistant',
                tooltip: 'RideSync Assistant',
                backgroundColor: RS.primary,
                foregroundColor: Colors.white,
                shape: const CircleBorder(),
                onPressed: () => showAssistant(context, history: _assistant, onTab: goTo),
                child: const Icon(Icons.smart_toy_outlined, size: 26),
              ),
            ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: RS.line))),
        child: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: goTo,
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded, color: RS.primary), label: 'Home'),
          const NavigationDestination(icon: Icon(Icons.search), selectedIcon: Icon(Icons.search, color: RS.primary), label: 'Find ride'),
          NavigationDestination(
            icon: Badge(isLabelVisible: _requests > 0, label: Text('$_requests'), child: const Icon(Icons.route_outlined)),
            selectedIcon: Badge(isLabelVisible: _requests > 0, label: Text('$_requests'), child: const Icon(Icons.route, color: RS.primary)),
            label: 'My rides',
          ),
          NavigationDestination(
            icon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.chat_bubble_outline)),
            selectedIcon: Badge(isLabelVisible: _unread > 0, label: Text('$_unread'), child: const Icon(Icons.chat_bubble, color: RS.primary)),
            label: 'Inbox',
          ),
          const NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person, color: RS.primary), label: 'Profile'),
        ],
      ),
      ),
    );
  }
}

/// Opens a server notification link like /trip/b_123 or /drive/r_456.
void openLink(BuildContext context, String link) {
  final parts = link.split('?').first.split('/').where((p) => p.isNotEmpty).toList();
  if (parts.length == 1 && parts[0] == 'wallet') {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaymentsScreen()));
    return;
  }
  if (parts.length < 2) return;
  final id = parts[1];
  final page = switch (parts[0]) {
    'trip' || 'live' || 'pay' || 'chat' => TripScreen(bookingId: id),
    'drive' => DriveScreen(rideId: id),
    'ride' => RideDetailsScreen(rideId: id),
    _ => null,
  };
  if (page != null) Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
}
