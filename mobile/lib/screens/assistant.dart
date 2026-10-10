import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'drive.dart';
import 'find.dart';
import 'profile.dart';
import 'trip.dart';

/// One line in the assistant chat.
class AssistantMsg {
  final bool mine;
  final String text;
  final List<AssistantAction> actions;
  final List<String> suggestions;
  final String? intent;
  final double confidence;
  const AssistantMsg({required this.mine, required this.text, this.actions = const [], this.suggestions = const [], this.intent, this.confidence = 0});
}

const assistantHello = AssistantMsg(
  mine: false,
  text: 'Hi! I’m the RideSync Assistant. Ask me in English or Hinglish — I can find rides, check your trips and answer questions.',
  suggestions: ['Ride to Andheri tomorrow 8 am', 'When is my next ride?', 'How are prices calculated?', 'kal subah Dadar jaana hai'],
);

/// Opens the RideSync Assistant (the server's own NLP: intent classifier + entity extraction)
/// as a full-height sheet. [history] keeps the conversation while the app is open;
/// [onTab] switches the main tabs for links like /rides or /find.
Future<void> showAssistant(BuildContext context, {required List<AssistantMsg> history, required void Function(int tab) onTab}) async {
  final action = await showModalBottomSheet<AssistantAction>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: RS.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(RS.radiusXl))),
    builder: (_) => AssistantSheet(history: history),
  );
  if (action != null && context.mounted) runAssistantAction(context, action, onTab: onTab);
}

/// Carries out a reply's button after the sheet closes.
void runAssistantAction(BuildContext context, AssistantAction a, {required void Function(int tab) onTab}) {
  void push(Widget page) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  switch (a.type) {
    case 'call':
      if (a.tel != null) openUrl(context, 'tel:${a.tel}');
    case 'search':
      final q = a.query(defaultDeparture());
      if (q == null) return;
      context.read<Session>().lastQuery = q;
      push(ResultsScreen(query: q));
    case 'link':
      final parts = (a.to ?? '').split('?').first.split('/').where((p) => p.isNotEmpty).toList();
      final id = parts.length > 1 ? parts[1] : null;
      switch (parts.firstOrNull) {
        case null || 'home':
          onTab(0);
        case 'find':
          onTab(1);
        case 'rides':
          onTab(2);
        case 'inbox':
          onTab(3);
        case 'profile':
          onTab(4);
        case 'wallet':
          push(const PaymentsScreen());
        case 'offer':
          final user = context.read<Session>().user;
          push(user?.canDrive == true ? const OfferRideScreen() : const VehicleScreen(offerAfter: true));
        case 'trip' || 'live' || 'pay' || 'chat' when id != null:
          push(TripScreen(bookingId: id));
        case 'drive' when id != null:
          push(DriveScreen(rideId: id));
        case 'ride' when id != null:
          push(RideDetailsScreen(rideId: id));
      }
  }
}

class AssistantSheet extends StatefulWidget {
  const AssistantSheet({super.key, required this.history});
  final List<AssistantMsg> history;
  @override
  State<AssistantSheet> createState() => _AssistantSheetState();
}

class _AssistantSheetState extends State<AssistantSheet> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  bool _busy = false;

  List<AssistantMsg> get _msgs => widget.history;

  @override
  void initState() {
    super.initState();
    if (_msgs.isEmpty) _msgs.add(assistantHello);
    _text.addListener(() => setState(() {}));
    WidgetsBinding.instance.addPostFrameCallback((_) => _toBottom(animate: false));
  }

  @override
  void dispose() {
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toBottom({bool animate = true}) {
    if (!_scroll.hasClients) return;
    final end = _scroll.position.maxScrollExtent;
    animate ? _scroll.animateTo(end, duration: const Duration(milliseconds: 250), curve: Curves.easeOut) : _scroll.jumpTo(end);
  }

  Future<void> _send(String raw) async {
    final t = raw.trim();
    if (t.isEmpty || _busy) return;
    _text.clear();
    setState(() {
      _msgs.add(AssistantMsg(mine: true, text: t));
      _busy = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _toBottom());
    AssistantMsg reply;
    try {
      final r = await context.read<Session>().api.assistant(t);
      reply = AssistantMsg(mine: false, text: r.reply, actions: r.actions, suggestions: r.suggestions, intent: r.intent, confidence: r.confidence);
    } catch (e) {
      reply = AssistantMsg(mine: false, text: errorText(e));
    }
    if (!mounted) {
      _msgs.add(reply);
      return;
    }
    setState(() {
      _msgs.add(reply);
      _busy = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _toBottom());
  }

  Widget _bubble(AssistantMsg m, bool last) {
    final small = ButtonStyle(minimumSize: const WidgetStatePropertyAll(Size(0, 38)), padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 14)), visualDensity: VisualDensity.compact);
    return Align(
      alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
        child: Column(crossAxisAlignment: m.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: m.mine ? RS.primary : RS.surface,
              border: m.mine ? null : Border.all(color: RS.line),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(18),
                topRight: const Radius.circular(18),
                bottomLeft: Radius.circular(m.mine ? 18 : 4),
                bottomRight: Radius.circular(m.mine ? 4 : 18),
              ),
            ),
            child: Text(m.text, style: TextStyle(color: m.mine ? Colors.white : RS.ink900, height: 1.4)),
          ),
          if (m.actions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final (k, a) in m.actions.indexed)
                a.type == 'call'
                    ? FilledButton.icon(
                        style: small.merge(FilledButton.styleFrom(backgroundColor: RS.danger)),
                        onPressed: () => Navigator.pop(context, a),
                        icon: const Icon(Icons.call, size: 18),
                        label: Text(a.label),
                      )
                    : k == 0
                        ? FilledButton(style: small, onPressed: () => Navigator.pop(context, a), child: Text(a.label))
                        : OutlinedButton(style: small, onPressed: () => Navigator.pop(context, a), child: Text(a.label)),
            ]),
          ],
          if (last && m.suggestions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final s in m.suggestions)
                ActionChip(
                  label: Text(s, style: const TextStyle(fontSize: 13, color: RS.primary700)),
                  backgroundColor: RS.primary50,
                  side: const BorderSide(color: RS.primary100),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                  visualDensity: VisualDensity.compact,
                  onPressed: _busy ? null : () => _send(s),
                ),
            ]),
          ],
          if (!m.mine && m.intent != null && m.intent != 'unknown') ...[
            const SizedBox(height: 4),
            Text('✨ ${m.intent!.replaceAll('_', ' ')} · ${(m.confidence * 100).round()}%', style: const TextStyle(color: RS.ink400, fontSize: 11.5)),
          ],
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.of(context).viewInsets.bottom;
    return SizedBox(
      height: double.infinity,
      child: Padding(
        padding: EdgeInsets.only(bottom: inset),
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 8, 12),
            child: Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [RS.primary, RS.route], begin: Alignment.topLeft, end: Alignment.bottomRight)),
                child: const Icon(Icons.smart_toy_outlined, color: Colors.white, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('RideSync Assistant', style: RS.heading(17)),
                  const Text('AI · understands English & Hinglish', style: TextStyle(color: RS.ink500, fontSize: 12.5)),
                ]),
              ),
              IconButton(tooltip: 'Close assistant', onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
            ]),
          ),
          const Divider(height: 1),
          Expanded(
            child: ColoredBox(
              color: RS.canvas,
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
                children: [
                  for (final (i, m) in _msgs.indexed) Padding(padding: const EdgeInsets.only(bottom: 12), child: _bubble(m, i == _msgs.length - 1 && !_busy)),
                  if (_busy) const Align(alignment: Alignment.centerLeft, child: _Typing()),
                ],
              ),
            ),
          ),
          const Divider(height: 1),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    maxLength: 300,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _send,
                    decoration: const InputDecoration(hintText: 'Ask anything… e.g. ride to Dadar 6 pm', counterText: '', isDense: true),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  tooltip: 'Send',
                  onPressed: _text.text.trim().isEmpty || _busy ? null : () => _send(_text.text),
                  style: IconButton.styleFrom(backgroundColor: RS.primary, foregroundColor: Colors.white),
                  icon: const Icon(Icons.send_rounded),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Three bouncing dots while the assistant thinks.
class _Typing extends StatefulWidget {
  const _Typing();
  @override
  State<_Typing> createState() => _TypingState();
}

class _TypingState extends State<_Typing> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
        label: 'Assistant is typing',
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(color: RS.surface, border: Border.all(color: RS.line), borderRadius: BorderRadius.circular(18)),
          child: AnimatedBuilder(
            animation: _c,
            builder: (_, _) => Row(mainAxisSize: MainAxisSize.min, children: [
              for (var i = 0; i < 3; i++) ...[
                if (i > 0) const SizedBox(width: 5),
                Transform.translate(
                  offset: Offset(0, -4 * math.max(0, math.sin(((_c.value - i * 0.18) % 1.0) * 2 * math.pi))),
                  child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: RS.ink400, shape: BoxShape.circle)),
                ),
              ],
            ]),
          ),
        ),
      );
}
