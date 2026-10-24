import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';
import '../theme.dart';
import '../util/legal.dart';
import '../api/api.dart';
import '../widgets/common.dart';
import '../widgets/motion.dart';
import '../widgets/route_art.dart';

/// Build stamp (commit), shown small on the sign-in screens so it's easy to tell which app is installed.
const appBuild = String.fromEnvironment('RIDESYNC_BUILD', defaultValue: 'dev');

/// Opening animation: the R mark fades in, a route draws with a dot travelling along it,
/// then the logo and tagline appear. Fast and quiet — no particles, no spinning.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300))..forward();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  double _seg(double a, double b) => Curves.easeOutCubic.transform(((_c.value - a) / (b - a)).clamp(0.0, 1.0));

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: RS.surface,
        body: Center(
          child: AnimatedBuilder(
            animation: _c,
            builder: (_, _) => Column(mainAxisSize: MainAxisSize.min, children: [
              SizedBox(width: 220, height: 56, child: CustomPaint(painter: _SplashRoute(_seg(0.1, 0.65)))),
              const SizedBox(height: 18),
              Opacity(
                opacity: _seg(0.45, 0.8),
                child: Transform.translate(offset: Offset(0, 8 * (1 - _seg(0.45, 0.8))), child: Image.asset('assets/ridesync-logo.png', width: 210)),
              ),
              const SizedBox(height: 14),
              Opacity(opacity: _seg(0.7, 1), child: Text('Smart rides. Shared journeys.', style: TextStyle(color: RS.ink500, fontSize: 14, fontWeight: FontWeight.w500))),
            ]),
          ),
        ),
      );
}

class _SplashRoute extends CustomPainter {
  _SplashRoute(this.t);
  final double t;
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final path = Path()
      ..moveTo(8, h * .78)
      ..cubicTo(w * .3, h * .78, w * .32, h * .2, w * .55, h * .24)
      ..cubicTo(w * .76, h * .28, w * .8, h * .62, w - 8, h * .4);
    final m = path.computeMetrics().first;
    canvas.drawPath(path, Paint()
      ..color = RS.sunken
      ..strokeWidth = 5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round);
    canvas.drawPath(m.extractPath(0, m.length * t), Paint()
      ..color = RS.primary
      ..strokeWidth = 5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round);
    final p = m.getTangentForOffset(m.length * t)!.position;
    canvas.drawCircle(p, 8, Paint()..color = Colors.white);
    canvas.drawCircle(p, 8, Paint()
      ..color = RS.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3);
  }

  @override
  bool shouldRepaint(_SplashRoute old) => old.t != t;
}

/// Shared frame for the sign-in screens: small logo, overline, title, subtitle, content.
class _AuthFrame extends StatelessWidget {
  const _AuthFrame({required this.title, required this.subtitle, required this.children, this.onBack, this.overline});
  final String title;
  final String subtitle;
  final String? overline;
  final List<Widget> children;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: RS.surface,
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 28), children: [
            SizedBox(
              height: 48,
              child: Stack(alignment: Alignment.center, children: [
                if (onBack != null) Align(alignment: Alignment.centerLeft, child: IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back), tooltip: 'Back')),
                Image.asset('assets/ridesync-logo.png', height: 24),
              ]),
            ),
            const SizedBox(height: 28),
            if (overline != null) ...[
              Text(overline!.toUpperCase(), style: const TextStyle(color: RS.primary, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1)),
              const SizedBox(height: 6),
            ],
            Text(title, style: RS.heading(26)),
            const SizedBox(height: 6),
            Text(subtitle, style: const TextStyle(color: RS.ink500, fontSize: 15, height: 1.45)),
            const SizedBox(height: 24),
            ...children,
            const SizedBox(height: 24),
            const Center(child: Text('Build $appBuild', style: TextStyle(color: RS.ink400, fontSize: 11))),
          ]),
        ),
      );
}

/// First launch of a test build: connect to a RideSync server (e.g. the laptop's share.bat link).
class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _link = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _connect() async {
    setState(() => (_busy = true, _error = null));
    try {
      await context.read<Session>().connect(_link.text);
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _busy = false));
    }
  }

  @override
  Widget build(BuildContext context) => _AuthFrame(
        title: 'Connect to RideSync',
        subtitle: 'Paste the server link. For testing, it’s the https link shown by share.bat on the laptop running RideSync.',
        children: [
          if (_error != null) ...[Notice(_error!, tone: 'error'), const SizedBox(height: 16)],
          TextField(
            controller: _link,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Server link', hintText: 'https://something.trycloudflare.com', prefixIcon: Icon(Icons.dns_outlined)),
            onSubmitted: (_) => _connect(),
          ),
          const SizedBox(height: 20),
          LoadingButton(label: 'Connect', icon: Icons.arrow_forward, loading: _busy, onPressed: _connect),
        ],
      );
}

/// Sign in or create an account with a 6-digit code sent to the college email.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  bool _landing = true;
  bool _signup = false;
  /// Admin sign-in: any email (e.g. a Gmail listed in ADMIN_EMAILS), same code flow.
  bool _admin = false;
  void _openLogin() => setState(() => (_landing = false, _signup = false));
  void _setAdmin(bool on) => setState(() => (_admin = on, _landing = false, _signup = false, _error = null));
  void _openSignup() => setState(() => (_landing = false, _signup = true));
  bool _codeStep = false;
  bool _busy = false;
  String? _error;

  /// Sign in with Microsoft in the phone's browser, then swap the one-time code for a login.
  Future<void> _microsoft() async {
    setState(() => (_busy = true, _error = null));
    final session = context.read<Session>();
    try {
      final result = await FlutterWebAuth2.authenticate(url: session.api.microsoftStartUrl, callbackUrlScheme: 'ridesync');
      final uri = Uri.parse(result);
      final err = uri.queryParameters['error'];
      if (err != null) throw ApiError(err);
      final code = uri.queryParameters['code'];
      if (code == null) throw const ApiError('Microsoft sign-in didn’t finish. Please try again.');
      final (user, token) = await session.api.appExchange(code);
      await session.signedIn(user, token);
    } on PlatformException catch (e) {
      if (mounted) setState(() => (_busy = false, _error = e.code == 'CANCELED' ? null : 'Couldn’t open Microsoft sign-in. Use the email code instead.'));
    } catch (e) {
      if (mounted) setState(() => (_busy = false, _error = errorText(e)));
    }
  }

  String get _domain => context.read<Session>().config?.allowedDomain ?? 'vit.edu.in';
  String get _cleanEmail => _email.text.trim().toLowerCase();

  String? _validateEmail() {
    final e = _cleanEmail;
    if (e.isEmpty) return _admin ? 'Enter your admin email.' : 'Enter your college email.';
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e)) return 'Enter a valid email address.';
    if (_admin) return null;
    if (!e.endsWith('@$_domain')) return 'Use your @$_domain college email. RideSync is only for VIT students.';
    return null;
  }

  Future<void> _sendCode() async {
    final err = _validateEmail();
    if (err != null) return setState(() => _error = err);
    setState(() => (_busy = true, _error = null));
    final session = context.read<Session>();
    try {
      await session.api.requestCode(_cleanEmail);
      await session.reloadConfig();
      if (mounted) {
        _code.clear();
        setState(() => (_codeStep = true, _busy = false));
      }
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _busy = false));
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) return setState(() => _error = 'Enter the 6-digit code.');
    setState(() => (_busy = true, _error = null));
    final session = context.read<Session>();
    try {
      final (user, token) = await session.api.verifyCode(_cleanEmail, code);
      await session.signedIn(user, token);
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _busy = false));
    }
  }

  Future<void> _devLogin() async {
    final err = _validateEmail();
    if (err != null) return setState(() => _error = err);
    setState(() => (_busy = true, _error = null));
    final session = context.read<Session>();
    try {
      final (user, token) = await session.api.devLogin(_cleanEmail);
      await session.signedIn(user, token);
    } catch (e) {
      if (mounted) setState(() => (_error = errorText(e), _busy = false));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final cfg = session.config;
    if (_landing && !_codeStep) return _landingView(session);
    if (_codeStep) {
      return _AuthFrame(
        overline: 'Almost there',
        title: _admin ? 'Check your inbox' : 'Check your VIT inbox',
        subtitle: cfg?.codesInTerminal == true
            ? 'Email isn’t set up on this server yet, so the 6-digit code for $_cleanEmail is shown in the black RideSync window on the laptop.'
            : 'We sent a 6-digit code to $_cleanEmail. It can take a minute — check Junk too.',
        onBack: () => setState(() => (_codeStep = false, _error = null)),
        children: [
          if (_error != null) ...[Notice(_error!, tone: 'error'), const SizedBox(height: 16)],
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: RS.heading(26).copyWith(letterSpacing: 10),
            textAlign: TextAlign.center,
            decoration: const InputDecoration(counterText: '', hintText: '••••••'),
            onChanged: (v) => v.length == 6 && !_busy ? _verify() : null,
          ),
          const SizedBox(height: 20),
          LoadingButton(label: 'Verify and continue', loading: _busy, onPressed: _verify),
          const SizedBox(height: 8),
          TextButton(onPressed: _busy ? null : _sendCode, child: const Text('Send a new code')),
        ],
      );
    }
    return _AuthFrame(
      overline: _admin ? 'RideSync admin' : (_signup ? 'Join RideSync' : 'Welcome back'),
      title: _admin ? 'Admin sign in' : (_signup ? 'Create your account' : 'Log in to RideSync'),
      subtitle: _admin ? 'See rides, bookings and students, and check ID cards. We’ll email a 6-digit code.' : 'Your campus. Your route. Your ride.',
      onBack: () => setState(() => (_landing = true, _admin = false, _error = null)),
      children: [
        if (session.startupError != null) ...[
          Notice('Can’t reach the RideSync server: ${session.startupError}', tone: 'error'),
          const SizedBox(height: 8),
          TextButton.icon(onPressed: session.refresh, icon: const Icon(Icons.refresh), label: const Text('Try again')),
          const SizedBox(height: 8),
        ],
        if (_error != null) ...[Notice(_error!, tone: 'error'), const SizedBox(height: 16)],
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textInputAction: TextInputAction.go,
          decoration: _admin
              ? const InputDecoration(labelText: 'Admin email', hintText: 'admin@example.com', prefixIcon: Icon(Icons.admin_panel_settings_outlined))
              : InputDecoration(labelText: 'VIT email', hintText: 'firstname.lastname@$_domain', prefixIcon: const Icon(Icons.mail_outline)),
          onSubmitted: (_) => _sendCode(),
        ),
        const SizedBox(height: 12),
        LoadingButton(label: _signup && !_admin ? 'Create account' : 'Continue', icon: Icons.arrow_forward, loading: _busy, onPressed: cfg?.emailLogin == false ? null : _sendCode),
        const SizedBox(height: 10),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.verified_user_outlined, size: 16, color: RS.ink500),
          const SizedBox(width: 8),
          Expanded(child: Text(_admin ? 'No password to remember. We email a 6-digit code to your admin inbox each time you sign in.' : 'No password to remember. We email a 6-digit code to your @$_domain inbox each time you sign in.', style: const TextStyle(color: RS.ink500, fontSize: 12.5, height: 1.4))),
        ]),
        if (cfg?.microsoftLogin == true && !_admin) ...[
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 18),
            child: Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: RS.ink500, fontSize: 13))), Expanded(child: Divider())]),
          ),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _busy ? null : _microsoft,
              style: OutlinedButton.styleFrom(minimumSize: const Size(64, 52)),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                SizedBox(
                  width: 18,
                  height: 18,
                  child: GridView.count(crossAxisCount: 2, mainAxisSpacing: 2, crossAxisSpacing: 2, physics: const NeverScrollableScrollPhysics(), children: [
                    for (final c in const [Color(0xFFF25022), Color(0xFF7FBA00), Color(0xFF00A4EF), Color(0xFFFFB900)]) ColoredBox(color: c),
                  ]),
                ),
                const SizedBox(width: 10),
                const Text('Continue with Microsoft (VIT Outlook)'),
              ]),
            ),
          ),
        ],
        if (cfg?.devLogin == true) ...[
          const SizedBox(height: 24),
          const Notice('Testing server: you can sign in without a code.', tone: 'warning'),
          const SizedBox(height: 12),
          LoadingButton(label: 'Test sign-in (no code)', secondary: true, loading: _busy, onPressed: _devLogin),
        ],
        const SizedBox(height: 28),
        if (!_admin)
          Center(
            child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text(_signup ? 'Already on RideSync? ' : 'New to RideSync? ', style: const TextStyle(color: RS.ink500)),
              GestureDetector(
                onTap: () => setState(() => _signup = !_signup),
                child: Text(_signup ? 'Log in' : 'Create account', style: const TextStyle(color: RS.primary, fontWeight: FontWeight.w700)),
              ),
            ]),
          ),
        const SizedBox(height: 12),
        Center(
          child: Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('By continuing, you agree to our ', style: TextStyle(color: RS.ink500, fontSize: 12)),
            GestureDetector(onTap: () => openLegal(context, '/terms'), child: const Text('Terms of Use', style: TextStyle(color: RS.primary, fontSize: 12, fontWeight: FontWeight.w600))),
            const Text(' and ', style: TextStyle(color: RS.ink500, fontSize: 12)),
            GestureDetector(onTap: () => openLegal(context, '/privacy'), child: const Text('Privacy Policy', style: TextStyle(color: RS.primary, fontSize: 12, fontWeight: FontWeight.w600))),
          ]),
        ),
        const SizedBox(height: 8),
        Center(
          child: _admin
              ? TextButton.icon(onPressed: _busy ? null : () => _setAdmin(false), icon: const Icon(Icons.school_outlined, size: 18), label: const Text('Student sign in'))
              : TextButton(
                  onPressed: _busy ? null : () => _setAdmin(true),
                  style: TextButton.styleFrom(foregroundColor: RS.ink500, textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                  child: const Text('RideSync admin? Sign in here'),
                ),
        ),
        if (!session.hasBuiltInServer) ...[
          const SizedBox(height: 12),
          Center(child: TextButton(onPressed: session.changeServer, child: Text('Server: ${session.server} · Change'))),
        ],
      ],
    );
  }
}

extension on _LoginScreenState {
  Widget _landingView(Session session) => Scaffold(
        backgroundColor: RS.surface,
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.fromLTRB(24, 16, 24, 28), children: [
            Image.asset('assets/ridesync-logo.png', height: 32, alignment: Alignment.centerLeft),
            const SizedBox(height: 22),
            const FadeSlideIn(child: RouteArt(height: 260)),
            const SizedBox(height: 22),
            FadeSlideIn(index: 1, child: Align(alignment: Alignment.centerLeft, child: Pill('Exclusively for Vidyalankar Institute of Technology', icon: Icons.verified, color: RS.primary, background: RS.primary50))),
            const SizedBox(height: 12),
            FadeSlideIn(index: 2, child: Text('Smart rides.\nShared journeys.', style: RS.heading(34))),
            const SizedBox(height: 8),
            const FadeSlideIn(index: 3, child: Text('Your campus carpool. Every driver and rider is a verified Vidyalankarite.', style: TextStyle(color: RS.ink500, fontSize: 16, height: 1.4))),
            const SizedBox(height: 16),
            FadeSlideIn(
              index: 4,
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                for (final (icon, label) in const [(Icons.directions_car_rounded, 'Offer a ride'), (Icons.search_rounded, 'Find a ride'), (Icons.currency_rupee_rounded, 'Split the cost')])
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: RS.sunken, borderRadius: BorderRadius.circular(999)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(icon, size: 16, color: RS.primary),
                      const SizedBox(width: 6),
                      Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                    ]),
                  ),
              ]),
            ),
            const SizedBox(height: 22),
            if (session.startupError != null) ...[Notice('Can’t reach the RideSync server: ${session.startupError}', tone: 'error'), const SizedBox(height: 12)],
            LoadingButton(label: 'Create account', onPressed: _openSignup),
            const SizedBox(height: 10),
            LoadingButton(label: 'Log in', secondary: true, onPressed: _openLogin),
            const SizedBox(height: 10),
            Text('Sign in with your @$_domain email.', textAlign: TextAlign.center, style: const TextStyle(color: RS.ink500, fontSize: 12.5)),
            const SizedBox(height: 4),
            Center(
              child: TextButton(
                onPressed: () => _setAdmin(true),
                style: TextButton.styleFrom(foregroundColor: RS.ink500, textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                child: const Text('RideSync admin? Sign in here'),
              ),
            ),
          ]),
        ),
      );
}
