import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'drive.dart';
import 'trip.dart';

const _quick = {
  'rider': ['I’m at the pickup point', 'Running 2 min late', 'Where are you?', 'I have a bag', 'Thank you!'],
  'driver': ['I’ve arrived', 'Leaving now', 'Stuck in traffic, 5 min', 'Which exit are you at?', 'Thank you!'],
};

/// Chat for one booking, Uber / Rapido style: who you're talking to, the trip, quick replies. New messages arrive live.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.bookingId, required this.other});
  final String bookingId;
  final PublicUser other;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _text = TextEditingController();
  bool _sending = false;
  BookingDetail? _detail;

  @override
  void initState() {
    super.initState();
    context.read<Session>().api.booking(widget.bookingId).then((d) {
      if (mounted) setState(() => _detail = d);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send(String text, Future<void> Function() reload) async {
    final t = text.trim();
    if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    final ok = await attempt(context, () => context.read<Session>().api.sendMessage(widget.bookingId, t));
    if (ok) {
      if (text == _text.text) _text.clear();
      await reload();
    }
    if (mounted) setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    final me = context.read<Session>().user!.id;
    final d = _detail;
    final role = d?.role ?? 'rider';
    final phone = d == null ? null : (role == 'rider' ? d.driverPhone : d.riderPhone);
    final closed = d != null && ({'cancelled', 'rejected', 'pending'}.contains(d.booking.status));
    return Scaffold(
      backgroundColor: RS.canvas,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(children: [
          Avatar(name: widget.other.name, photo: widget.other.photo, size: 38),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              NameWithBadge(widget.other, style: RS.heading(16)),
              if (d != null)
                Text(
                  role == 'rider' ? 'Your driver · ${d.vehicle.title} · ${d.vehicle.plate}' : 'Your rider · pickup at ${d.booking.pickup.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: RS.ink500, fontSize: 12, fontWeight: FontWeight.w400),
                ),
            ]),
          ),
        ]),
        actions: [
          if (phone != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: IconButton.filledTonal(
                onPressed: () => openUrl(context, 'tel:+91$phone'),
                icon: const Icon(Icons.call_rounded, color: RS.success),
                style: IconButton.styleFrom(backgroundColor: RS.success50),
                tooltip: 'Call ${widget.other.firstName}',
              ),
            ),
        ],
      ),
      body: Column(children: [
        if (d != null) _TripCard(d),
        Expanded(
          child: LiveLoader<List<Message>>(
            load: (api) => api.messages(widget.bookingId),
            builder: (context, msgs, reload) => Column(children: [
              Expanded(
                child: msgs.isEmpty
                    ? ListView(children: [
                        const _Privacy(),
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Column(children: [
                            Avatar(name: widget.other.name, photo: widget.other.photo, size: 64),
                            const SizedBox(height: 10),
                            Text('Say hi to ${widget.other.firstName}', style: RS.heading(17)),
                            const SizedBox(height: 4),
                            const Text('Sort out the pickup spot or tell them you’re running late.', style: TextStyle(color: RS.ink500)),
                          ]),
                        ),
                      ])
                    : ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        itemCount: msgs.length + 1,
                        itemBuilder: (context, i) {
                          if (i == msgs.length) return const _Privacy();
                          final idx = msgs.length - 1 - i;
                          final m = msgs[idx];
                          final prev = idx > 0 ? msgs[idx - 1] : null;
                          final next = idx < msgs.length - 1 ? msgs[idx + 1] : null;
                          final newDay = prev == null || dayOf(prev.createdAt) != dayOf(m.createdAt);
                          final day = newDay ? _DayChip(dayOf(m.createdAt)) : null;
                          if (m.system) {
                            return Column(children: [
                              ?day,
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 6),
                                child: Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(color: RS.sunken, borderRadius: BorderRadius.circular(999)),
                                    child: Text(m.text, textAlign: TextAlign.center, style: const TextStyle(color: RS.ink500, fontSize: 12.5)),
                                  ),
                                ),
                              ),
                            ]);
                          }
                          final mine = m.senderId == me;
                          final groupEnd = next == null || next.system || next.senderId != m.senderId || next.createdAt.difference(m.createdAt).inMinutes > 5;
                          return Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
                            ?day,
                            Container(
                              margin: EdgeInsets.only(top: 2, bottom: groupEnd ? 2 : 0),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                              decoration: BoxDecoration(
                                color: mine ? RS.primary : RS.surface,
                                border: mine ? null : Border.all(color: RS.line),
                                borderRadius: BorderRadius.only(
                                  topLeft: const Radius.circular(18),
                                  topRight: const Radius.circular(18),
                                  bottomLeft: Radius.circular(mine || !groupEnd ? 18 : 6),
                                  bottomRight: Radius.circular(!mine || !groupEnd ? 18 : 6),
                                ),
                              ),
                              child: Text(m.text, style: TextStyle(color: mine ? Colors.white : RS.ink900, fontSize: 15, height: 1.35)),
                            ),
                            if (groupEnd)
                              Padding(
                                padding: const EdgeInsets.fromLTRB(6, 2, 6, 8),
                                child: Text(timeOf(m.createdAt), style: const TextStyle(color: RS.ink400, fontSize: 11)),
                              ),
                          ]);
                        },
                      ),
              ),
              if (closed)
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(d.booking.status == 'pending' ? 'Chat opens once the driver accepts.' : 'This ride has ended. Chat is closed.', style: const TextStyle(color: RS.ink500)),
                  ),
                )
              else
                SafeArea(
                  top: false,
                  child: Container(
                    decoration: const BoxDecoration(color: RS.surface, border: Border(top: BorderSide(color: RS.line))),
                    child: Column(children: [
                      SizedBox(
                        height: 44,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                          children: [
                            for (final q in _quick[role]!)
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ActionChip(label: Text(q), onPressed: _sending ? null : () => _send(q, reload), visualDensity: VisualDensity.compact),
                              ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                        child: Row(children: [
                          Expanded(
                            child: TextField(
                              controller: _text,
                              minLines: 1,
                              maxLines: 4,
                              maxLength: 1000,
                              textCapitalization: TextCapitalization.sentences,
                              onChanged: (_) => setState(() {}),
                              decoration: InputDecoration(
                                hintText: 'Message ${widget.other.firstName}…',
                                counterText: '',
                                filled: true,
                                fillColor: RS.sunken,
                                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: RS.primary)),
                              ),
                              onSubmitted: (_) => _send(_text.text, reload),
                            ),
                          ),
                          const SizedBox(width: 6),
                          IconButton.filled(
                            onPressed: _sending || _text.text.trim().isEmpty ? null : () => _send(_text.text, reload),
                            icon: const Icon(Icons.send_rounded),
                            style: IconButton.styleFrom(backgroundColor: RS.primary, disabledBackgroundColor: RS.sunken),
                          ),
                        ]),
                      ),
                    ]),
                  ),
                ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// The trip this chat is about: tap to open it.
class _TripCard extends StatelessWidget {
  const _TripCard(this.d);
  final BookingDetail d;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: Material(
          color: RS.surface,
          borderRadius: BorderRadius.circular(RS.radiusLg),
          child: InkWell(
            borderRadius: BorderRadius.circular(RS.radiusLg),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => d.role == 'rider' ? TripScreen(bookingId: d.booking.id) : DriveScreen(rideId: d.ride.id))),
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(RS.radiusLg), border: Border.all(color: RS.line)),
              child: Row(children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(color: RS.primary50, borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.directions_car_rounded, color: RS.primary, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${d.booking.pickup.name} → ${d.booking.drop.name}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    Text(when(d.ride.departAt), style: const TextStyle(color: RS.ink500, fontSize: 12)),
                  ]),
                ),
                Pill.status(d.booking.status, bookingStatusLabel[d.booking.status] ?? d.booking.status),
                const Icon(Icons.chevron_right_rounded, color: RS.ink400),
              ]),
            ),
          ),
        ),
      );
}

class _Privacy extends StatelessWidget {
  const _Privacy();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.fromLTRB(24, 12, 24, 8),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.lock_outline_rounded, size: 13, color: RS.ink400),
          SizedBox(width: 6),
          Flexible(child: Text('Only the two of you can see these messages.', textAlign: TextAlign.center, style: TextStyle(color: RS.ink500, fontSize: 12))),
        ]),
      );
}

class _DayChip extends StatelessWidget {
  const _DayChip(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(color: RS.surface, border: Border.all(color: RS.line), borderRadius: BorderRadius.circular(999)),
          child: Text(label, style: const TextStyle(color: RS.ink500, fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      );
}
