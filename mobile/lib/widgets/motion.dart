import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';
import '../util/sound.dart';

/// A soft moving highlight over grey placeholders while content loads.
class Shimmer extends StatefulWidget {
  const Shimmer({super.key, required this.child});
  final Widget child;
  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        child: widget.child,
        builder: (context, child) => ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (rect) {
            final x = -1.0 + 3 * _c.value;
            return LinearGradient(
              begin: Alignment(x - 1, 0),
              end: Alignment(x, 0),
              colors: const [RS.sunken, Color(0xFFFBFAFF), RS.sunken],
            ).createShader(rect);
          },
          child: child,
        ),
      );
}

class _Bone extends StatelessWidget {
  const _Bone({this.width, required this.height, this.radius = 8});
  final double? width;
  final double height;
  final double radius;
  @override
  Widget build(BuildContext context) => Container(width: width, height: height, decoration: BoxDecoration(color: RS.sunken, borderRadius: BorderRadius.circular(radius)));
}

/// Placeholder ride cards shown while a list loads.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 3});
  final int count;
  @override
  Widget build(BuildContext context) => Shimmer(
        child: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            for (var i = 0; i < count; i++)
              Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: RS.surface, borderRadius: BorderRadius.circular(RS.radiusLg), border: Border.all(color: RS.line)),
                child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [_Bone(width: 120, height: 16), Spacer(), _Bone(width: 48, height: 18)]),
                  SizedBox(height: 14),
                  _Bone(width: 180, height: 12),
                  SizedBox(height: 10),
                  _Bone(width: 150, height: 12),
                  SizedBox(height: 16),
                  Row(children: [_Bone(width: 40, height: 40, radius: 20), SizedBox(width: 12), _Bone(width: 140, height: 14)]),
                ]),
              ),
          ],
        ),
      );
}

/// Fades and slides a child in, staggered by [index] — for lists of cards.
class FadeSlideIn extends StatelessWidget {
  const FadeSlideIn({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Duration(milliseconds: 380 + 60 * math.min(index, 6)),
        curve: Curves.easeOutCubic,
        builder: (context, t, child) => Opacity(opacity: t, child: Transform.translate(offset: Offset(0, 18 * (1 - t)), child: child)),
        child: child,
      );
}

/// Shrinks slightly while pressed, like native ride apps.
class PressScale extends StatefulWidget {
  const PressScale({super.key, required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;
  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _down = false;
  @override
  Widget build(BuildContext context) {
    if (widget.onTap == null) return widget.child;
    return Listener(
      onPointerDown: (_) => setState(() => _down = true),
      onPointerUp: (_) => setState(() => _down = false),
      onPointerCancel: (_) => setState(() => _down = false),
      child: AnimatedScale(scale: _down ? 0.975 : 1, duration: const Duration(milliseconds: 120), child: widget.child),
    );
  }
}

/// Kinds of action moment, each with its own small animated graphic.
enum Moment { done, published, sent, accepted, started, completed, cancelled, declined }

/// Full-screen tick that draws itself, then closes — after booking, paying, publishing.
Future<void> showSuccess(BuildContext context, String title, {String? subtitle}) => showMoment(context, Moment.done, title, subtitle: subtitle);

/// A moment for an action that matters (ride offered, request sent, ride accepted, started,
/// completed, cancelled): animated graphic + title, as a bottom card. Closes by itself unless
/// it has an action button.
Future<void> showMoment(BuildContext context, Moment kind, String title, {String? subtitle, String? actionLabel, VoidCallback? onAction, Sound? sound}) {
  final nav = Navigator.of(context);
  // Each moment's sound (util/sound.dart); a moment can ask for another, e.g. a driver's new request.
  Sounds.play(sound ??
      switch (kind) {
        Moment.done || Moment.accepted || Moment.completed => Sound.success,
        Moment.published || Moment.sent => Sound.sent,
        Moment.started => Sound.start,
        Moment.cancelled || Moment.declined => Sound.cancel,
      });
  var open = true;
  if (actionLabel == null) {
    Future.delayed(Duration(milliseconds: kind == Moment.sent ? 3200 : 2400), () {
      if (open && nav.canPop()) nav.pop();
    });
  }
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: false,
    backgroundColor: RS.surface,
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 1600),
            builder: (_, t, _) => _MomentArt(kind: kind, t: t),
          ),
          const SizedBox(height: 14),
          Text(title, style: RS.heading(20), textAlign: TextAlign.center),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            ConstrainedBox(constraints: const BoxConstraints(maxWidth: 320), child: Text(subtitle, style: const TextStyle(color: RS.ink500, height: 1.4), textAlign: TextAlign.center)),
          ],
          if (kind == Moment.sent) const Padding(padding: EdgeInsets.only(top: 12), child: _WaitingDots()),
          const SizedBox(height: 18),
          if (actionLabel != null)
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  Navigator.pop(sheet);
                  onAction?.call();
                },
                child: Text(actionLabel),
              ),
            ),
          SizedBox(width: double.infinity, child: TextButton(onPressed: () => Navigator.pop(sheet), child: Text(actionLabel == null ? 'Done' : 'Later'))),
        ]),
      ),
    ),
  ).whenComplete(() => open = false);
}

class _WaitingDots extends StatefulWidget {
  const _WaitingDots();
  @override
  State<_WaitingDots> createState() => _WaitingDotsState();
}

class _WaitingDotsState extends State<_WaitingDots> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        builder: (_, _) => Row(mainAxisSize: MainAxisSize.min, children: [
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: Opacity(
                opacity: 0.25 + 0.75 * (0.5 + 0.5 * math.sin((_c.value - i * 0.18) * 2 * math.pi)).clamp(0.0, 1.0),
                child: Container(width: 7, height: 7, decoration: const BoxDecoration(color: RS.primary, shape: BoxShape.circle)),
              ),
            ),
        ]),
      );
}

class _MomentArt extends StatelessWidget {
  const _MomentArt({required this.kind, required this.t});
  final Moment kind;
  final double t;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: 200,
        height: 130,
        child: kind == Moment.sent || kind == Moment.started
            ? _Looping(kind: kind, t: t)
            : CustomPaint(painter: _MomentPainter(kind, t)),
      );
}

/// "Sent" pulses and "started" keeps the car driving — they loop.
class _Looping extends StatefulWidget {
  const _Looping({required this.kind, required this.t});
  final Moment kind;
  final double t;
  @override
  State<_Looping> createState() => _LoopingState();
}

class _LoopingState extends State<_Looping> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: _c, builder: (_, _) => CustomPaint(painter: _MomentPainter(widget.kind, widget.t, loop: _c.value)));
}

class _MomentPainter extends CustomPainter {
  _MomentPainter(this.kind, this.t, {this.loop = 0});
  final Moment kind;
  final double t;
  final double loop;

  double _seg(double a, double b) => Curves.easeOutCubic.transform(((t - a) / (b - a)).clamp(0.0, 1.0));
  Paint _stroke(Color c, double w) => Paint()
    ..color = c
    ..strokeWidth = w
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;

  void _check(Canvas canvas, Offset c, double k, {double r = 16, Color color = RS.success}) {
    if (k <= 0) return;
    canvas.drawCircle(c, r * Curves.easeOutBack.transform(k).clamp(0, 1.2), Paint()..color = color);
    final tick = Path()
      ..moveTo(c.dx - r * .4, c.dy)
      ..lineTo(c.dx - r * .1, c.dy + r * .3)
      ..lineTo(c.dx + r * .45, c.dy - r * .3);
    final m = tick.computeMetrics().first;
    canvas.drawPath(m.extractPath(0, m.length * ((k - .3) / .7).clamp(0, 1)), _stroke(Colors.white, 3.5));
  }

  void _confetti(Canvas canvas, Offset c, double k) {
    if (k <= 0 || k >= 1) return;
    const dots = [(-70.0, -40.0, Color(0xFF1A73E8)), (64.0, 10.0, Color(0xFFF29900)), (-40.0, 46.0, Color(0xFF14A454)), (50.0, -46.0, RS.primary), (-80.0, 6.0, Color(0xFFE3242B)), (72.0, 44.0, RS.primary)];
    for (final (dx, dy, col) in dots) {
      canvas.drawCircle(c + Offset(dx * k, dy * k), 3, Paint()..color = col.withValues(alpha: 1 - k));
    }
  }

  void _person(Canvas canvas, Offset c, Color bg, Color fg, double k) {
    if (k <= 0) return;
    final s = Curves.easeOutBack.transform(k).clamp(0.0, 1.2);
    canvas.drawCircle(c, 22 * s, Paint()..color = bg);
    canvas.drawCircle(c + Offset(0, -6 * s), 7 * s, Paint()..color = fg);
    canvas.drawPath(
      Path()
        ..moveTo(c.dx - 12 * s, c.dy + 14 * s)
        ..quadraticBezierTo(c.dx, c.dy - 2 * s, c.dx + 12 * s, c.dy + 14 * s)
        ..close(),
      Paint()..color = fg,
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    switch (kind) {
      case Moment.published:
      case Moment.started:
        final route = Path()
          ..moveTo(28, size.height - 22)
          ..cubicTo(70, size.height - 22, 66, 60, 104, 54)
          ..cubicTo(142, 48, 140, 26, 172, 22);
        final m = route.computeMetrics().first;
        canvas.drawPath(route, _stroke(RS.sunken, 10));
        canvas.drawPath(m.extractPath(0, m.length * _seg(0, .45)), _stroke(RS.route, 6));
        canvas.drawCircle(Offset(28, size.height - 22), 7, Paint()..color = RS.ink900);
        canvas.drawCircle(Offset(28, size.height - 22), 7, _stroke(Colors.white, 3));
        if (_seg(.4, .5) > 0) canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: const Offset(172, 22), width: 15, height: 15), const Radius.circular(4)), Paint()..color = RS.primary);
        final carT = kind == Moment.started ? loop : _seg(.25, .75);
        final tan = m.getTangentForOffset(m.length * carT)!;
        canvas.save();
        canvas.translate(tan.position.dx, tan.position.dy);
        canvas.rotate(-tan.angle);
        canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(-10, -5.5, 20, 11), const Radius.circular(3.5)), Paint()..color = RS.ink900);
        canvas.drawRRect(RRect.fromRectAndRadius(const Rect.fromLTWH(1.5, -4, 5, 8), const Radius.circular(1.5)), Paint()..color = const Color(0xFF7FB2FF));
        canvas.restore();
        if (kind == Moment.published) {
          _check(canvas, const Offset(150, 92), _seg(.75, .95));
          _confetti(canvas, c, _seg(.75, 1));
        }
      case Moment.sent:
        for (var i = 0; i < 3; i++) {
          final k = (loop + i / 3) % 1;
          canvas.drawCircle(c, 24 + 30 * k, _stroke(RS.primary.withValues(alpha: .5 * (1 - k)), 2));
        }
        canvas.drawCircle(c, 26 * Curves.easeOutBack.transform(_seg(0, .3)).clamp(0, 1.2), Paint()..color = RS.primary);
        final k = _seg(.15, .45);
        canvas.drawPath(
          Path()
            ..moveTo(c.dx - 11 - 12 * (1 - k), c.dy + 1 + 8 * (1 - k))
            ..lineTo(c.dx + 11, c.dy - 10)
            ..lineTo(c.dx + 4, c.dy + 12)
            ..lineTo(c.dx, c.dy + 3)
            ..close(),
          Paint()..color = Colors.white.withValues(alpha: k),
        );
      case Moment.accepted:
        _person(canvas, c - const Offset(46, 0), RS.primary100, RS.primary, _seg(0, .3));
        _person(canvas, c + const Offset(46, 0), const Color(0xFFDFE6FE), RS.secondary, _seg(.08, .38));
        _check(canvas, c, _seg(.35, .6));
        _confetti(canvas, c, _seg(.5, .95));
      case Moment.cancelled:
      case Moment.declined:
        canvas.drawCircle(c, 34 * _seg(0, .3), Paint()..color = RS.danger50);
        final ring = Path()..addOval(Rect.fromCircle(center: c, radius: 25));
        final rm = ring.computeMetrics().first;
        canvas.drawPath(rm.extractPath(0, rm.length * _seg(.1, .45)), _stroke(RS.danger, 4));
        final k = _seg(.45, .7);
        canvas.drawLine(c + const Offset(-9, -9), c + Offset(-9 + 18 * k, -9 + 18 * k), _stroke(RS.danger, 4));
        canvas.drawLine(c + const Offset(9, -9), c + Offset(9 - 18 * k, -9 + 18 * k), _stroke(RS.danger, 4));
      case Moment.done:
      case Moment.completed:
        canvas.drawCircle(c, 36 * Curves.easeOutBack.transform(_seg(0, .3)).clamp(0, 1.2), Paint()..color = RS.success50);
        final ring = Path()..addOval(Rect.fromCircle(center: c, radius: 27));
        final rm = ring.computeMetrics().first;
        canvas.drawPath(rm.extractPath(0, rm.length * _seg(.1, .45)), _stroke(RS.success, 4));
        final tick = Path()
          ..moveTo(c.dx - 12, c.dy + 1)
          ..lineTo(c.dx - 3, c.dy + 10)
          ..lineTo(c.dx + 13, c.dy - 8);
        final tm = tick.computeMetrics().first;
        canvas.drawPath(tm.extractPath(0, tm.length * _seg(.45, .65)), _stroke(RS.success, 5));
        if (kind == Moment.completed && _seg(.6, .75) > 0) {
          canvas.drawLine(c + const Offset(40, 18), c + const Offset(40, -12), _stroke(RS.ink900, 2.5));
          canvas.drawPath(
            Path()
              ..moveTo(c.dx + 40, c.dy - 12)
              ..lineTo(c.dx + 58, c.dy - 7)
              ..lineTo(c.dx + 40, c.dy - 2)
              ..close(),
            Paint()..color = RS.primary,
          );
        }
        _confetti(canvas, c, _seg(.55, 1));
    }
  }

  @override
  bool shouldRepaint(_MomentPainter old) => old.t != t || old.loop != loop;
}


/// Gentle pulsing dot — "live", "searching", "driver on the way".
class LiveDot extends StatefulWidget {
  const LiveDot({super.key, this.color = RS.success, this.size = 10});
  final Color color;
  final double size;
  @override
  State<LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<LiveDot> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        width: widget.size * 2.4,
        height: widget.size * 2.4,
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Stack(alignment: Alignment.center, children: [
            Container(
              width: widget.size * (1 + 1.4 * _c.value),
              height: widget.size * (1 + 1.4 * _c.value),
              decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color.withValues(alpha: 0.35 * (1 - _c.value))),
            ),
            Container(width: widget.size, height: widget.size, decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color)),
          ]),
        ),
      );
}
