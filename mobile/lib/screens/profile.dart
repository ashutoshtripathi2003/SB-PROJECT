import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/checkout.dart';
import '../util/format.dart';
import '../util/legal.dart';
import '../util/validation.dart';
import '../util/sound.dart';
import '../widgets/common.dart';
import '../widgets/motion.dart';
import '../widgets/photo_picker.dart';
import '../widgets/safety.dart';
import '../widgets/vehicle_form.dart';
import 'admin.dart';
import 'drive.dart';
import 'trip.dart';

class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final u = session.user!;
    void open(Widget page) => Navigator.push(context, MaterialPageRoute(builder: (_) => page));
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: RefreshIndicator(
        onRefresh: session.reloadUser,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: [
          Panel(
            child: Row(children: [
              Avatar(name: u.name, photo: u.photo, size: 64),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  NameWithBadge(u, style: RS.heading(20)),
                  Text(u.email, style: const TextStyle(color: RS.ink500, fontSize: 13)),
                  const SizedBox(height: 6),
                  Row(children: [
                    RatingText(u),
                    const SizedBox(width: 8),
                    u.verified
                        ? const Pill('Verified student', icon: Icons.verified, color: RS.success, background: RS.success50)
                        : const Pill('VIT email', icon: Icons.alternate_email_rounded, color: RS.ink700, background: RS.sunken),
                  ]),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 12),
          Row(children: [
            _stat('${u.ridesOffered}', 'Rides offered'),
            const SizedBox(width: 10),
            _stat('${u.ridesTaken}', 'Rides taken'),
            const SizedBox(width: 10),
            _stat('${u.co2SavedKg.toStringAsFixed(1)} kg', 'CO₂ saved'),
          ]),
          const SectionTitle('Student ID verification'),
          _IdVerificationCard(user: u),
          const SectionTitle('Account'),
          _group([
            _row(Icons.person_outline, 'Personal information', u.phone.isEmpty ? null : '+91 ${u.phone}', () => open(const EditProfileScreen())),
            _row(Icons.directions_car_outlined, 'My car', u.vehicle == null ? 'Add your car to offer rides' : '${u.vehicle!.title} · ${u.vehicle!.plate}', () => open(const VehicleScreen())),
            _row(Icons.tune_rounded, 'Preferences', 'Commute mode and ride preferences', () => open(const PreferencesScreen())),
            _row(Icons.account_balance_wallet_outlined, 'Payment methods', u.upiId ?? 'Add your UPI ID to receive payments', () => open(const PaymentMethodsScreen())),
            _row(Icons.notifications_none_rounded, 'Notifications', 'Ride updates and messages', () => open(const NotificationSettingsScreen())),
            _row(Icons.shield_outlined, 'Safety', u.emergencyContacts.isEmpty ? 'Add emergency contacts' : '${u.emergencyContacts.length} emergency contact${u.emergencyContacts.length == 1 ? '' : 's'}', () => open(const SafetyScreen())),
            _row(Icons.account_balance_wallet_outlined, 'Wallet', 'Money paid, received and to collect', () => open(const PaymentsScreen())),
          ]),
          const SectionTitle('App'),
          _group([
            if (u.isAdmin && !u.adminOnly) _row(Icons.admin_panel_settings_outlined, 'Admin dashboard', 'Rides, students and ID checks', () => open(const AdminShell(embedded: true))),
            _row(Icons.help_outline_rounded, 'Help & support', 'FAQ and how RideSync works', () => open(const HelpScreen())),
            _row(Icons.privacy_tip_outlined, 'Privacy Policy', 'What we collect and your rights', () => openLegal(context, '/privacy')),
            _row(Icons.description_outlined, 'Terms of Use', 'Rules for drivers and riders', () => openLegal(context, '/terms')),
            if (!session.hasBuiltInServer) _row(Icons.dns_outlined, 'Change server', session.server, () => session.changeServer()),
            _row(Icons.logout, 'Log out', null, () => session.signOut()),
            _row(Icons.delete_outline, 'Delete account', 'Permanently remove your account', () => _delete(context), danger: true),
          ]),
          const SizedBox(height: 24),
          Center(child: Image.asset('assets/ridesync-logo.png', height: 22, opacity: const AlwaysStoppedAnimation(0.6))),
          const SizedBox(height: 4),
          const Center(child: Text('Smart rides. Brighter tomorrows.', style: TextStyle(color: RS.ink400, fontSize: 12))),
        ]),
      ),
    );
  }

  Widget _stat(String value, String label) => Expanded(
        child: Panel(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          child: Column(children: [Text(value, style: RS.heading(18)), const SizedBox(height: 2), Text(label, style: const TextStyle(color: RS.ink500, fontSize: 12), textAlign: TextAlign.center)]),
        ),
      );

  Widget _group(List<Widget> rows) => Card(
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var i = 0; i < rows.length; i++) ...[if (i > 0) const Divider(indent: 56), rows[i]],
        ]),
      );

  Widget _row(IconData icon, String title, String? subtitle, VoidCallback onTap, {bool danger = false}) => ListTile(
        leading: Icon(icon, color: danger ? RS.danger : RS.ink700),
        title: Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: danger ? RS.danger : RS.ink900)),
        subtitle: subtitle == null ? null : Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: const Icon(Icons.chevron_right, color: RS.ink400),
        onTap: onTap,
      );

  Future<void> _delete(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text('Your profile, rides and chats will be removed. This can’t be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep account')),
          TextButton(onPressed: () => Navigator.pop(c, true), style: TextButton.styleFrom(foregroundColor: RS.danger), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final session = context.read<Session>();
    if (await attempt(context, session.api.deleteAccount)) await session.signOut(remote: false);
  }
}

/// Upload a photo of the VIT ID card; an admin checks it on the website.
class _IdVerificationCard extends StatefulWidget {
  const _IdVerificationCard({required this.user});
  final User user;
  @override
  State<_IdVerificationCard> createState() => _IdVerificationCardState();
}

class _IdVerificationCardState extends State<_IdVerificationCard> {
  bool _busy = false;

  Future<void> _pick() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 4), child: Text('Photo of your VIT ID card', style: RS.heading(20))),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Lay the card flat in good light so your name, photo and ID number are readable. Only RideSync admins see it, and it’s deleted once checked.', style: TextStyle(color: RS.ink500, height: 1.4)),
          ),
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.pop(sheet, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.pop(sheet, ImageSource.gallery)),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (source == null || !mounted) return;
    setState(() => _busy = true);
    await uploadIdCard(context, source);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    final status = u.verified ? 'verified' : u.idStatus;
    final (IconData icon, Color fg, Color bg, String title, String body) = switch (status) {
      'verified' => (Icons.verified, RS.success, RS.success50, 'Verified student ✓', 'Riders and drivers see the verified badge next to your name.'),
      'pending' => (Icons.hourglass_top_rounded, RS.warning, RS.warning50, 'Under review', 'We’re checking your ID card. You’ll get a notification when it’s done.'),
      'rejected' => (Icons.error_outline, RS.danger, RS.danger50, 'ID card not verified', u.idNote ?? 'We couldn’t read your ID card. Upload a clearer photo.'),
      _ => (Icons.badge_outlined, RS.primary, RS.primary50, 'Get the verified badge', 'Upload a photo of your VIT ID card. Verified students get more ride requests and accepts.'),
    };
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(backgroundColor: bg, child: Icon(icon, color: fg)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: status == 'verified' ? RS.success : RS.ink900)),
              const SizedBox(height: 2),
              Text(body, style: const TextStyle(color: RS.ink500, fontSize: 13, height: 1.35)),
            ]),
          ),
        ]),
        if (status == 'none' || status == 'rejected') ...[
          const SizedBox(height: 14),
          LoadingButton(label: status == 'rejected' ? 'Upload again' : 'Get verified', icon: Icons.upload_rounded, loading: _busy, secondary: status == 'rejected', onPressed: _pick),
        ],
      ]),
    );
  }
}

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});
  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final User _u = context.read<Session>().user!;
  late final _name = TextEditingController(text: _u.name);
  late final _phone = TextEditingController(text: _u.phone);
  late final _upi = TextEditingController(text: _u.upiId);
  late final _programme = TextEditingController(text: _u.programme);
  late String? _photo = _u.photo;
  late String _gender = _u.gender;
  Map<String, String?> _errors = {};
  bool _saving = false;

  Future<void> _save() async {
    final e = {'name': validateName(_name.text), 'phone': validatePhone(_phone.text), 'upi': _upi.text.trim().isEmpty ? null : validateUpiId(_upi.text)};
    setState(() => _errors = e);
    if (e.values.any((v) => v != null)) return;
    setState(() => _saving = true);
    final session = context.read<Session>();
    try {
      final u = await session.api.updateMe({'name': _name.text.trim(), 'phone': _phone.text.trim(), 'gender': _gender, 'upiId': _upi.text.trim(), 'programme': _programme.text.trim(), 'photo': ?_photo});
      session.setUser(u);
      if (mounted) {
        toast(context, 'Profile saved');
        Navigator.pop(context);
      }
    } on ApiError catch (err) {
      if (mounted) setState(() => (_saving = false, _errors = {err.field ?? 'name': err.message}));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Personal information')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Center(child: PhotoPicker(name: _name.text, photo: _photo, onChanged: (p) => setState(() => _photo = p))),
          const SizedBox(height: 24),
          TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: 'Full name', errorText: _errors['name'])),
          const SizedBox(height: 14),
          TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: 'Mobile number', prefixText: '+91 ', errorText: _errors['phone'])),
          const SizedBox(height: 14),
          TextField(controller: _programme, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Programme / branch (optional)', hintText: 'e.g. B.E. Computer Engineering, 3rd year')),
          const SizedBox(height: 14),
          TextField(controller: _upi, autocorrect: false, decoration: InputDecoration(labelText: 'UPI ID (drivers)', hintText: 'yourname@okaxis', errorText: _errors['upi'] ?? _errors['upiId'])),
          const SizedBox(height: 14),
          TextField(enabled: false, controller: TextEditingController(text: '${_u.email} · ${_u.studentId}'), decoration: const InputDecoration(labelText: 'College email · Student ID')),
          const SizedBox(height: 18),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final (v, l) in const [('female', 'Female'), ('male', 'Male'), ('other', 'Other'), ('undisclosed', 'Prefer not to say')])
              ChoiceChip(label: Text(l), selected: _gender == v, onSelected: (_) => setState(() => _gender = v)),
          ]),
          const SizedBox(height: 28),
          LoadingButton(label: 'Save', loading: _saving, onPressed: _save),
        ]),
      );
}

class VehicleScreen extends StatefulWidget {
  const VehicleScreen({super.key, this.offerAfter = false});

  /// Go straight to "Offer a ride" after saving (from the Home screen).
  final bool offerAfter;
  @override
  State<VehicleScreen> createState() => _VehicleScreenState();
}

class _VehicleScreenState extends State<VehicleScreen> {
  final _form = GlobalKey<VehicleFormState>();
  bool _saving = false;

  Future<void> _save() async {
    final v = _form.currentState?.value();
    if (v == null) return;
    setState(() => _saving = true);
    final session = context.read<Session>();
    try {
      session.setUser(await session.api.saveVehicle(v));
      if (!mounted) return;
      toast(context, 'Car saved');
      if (widget.offerAfter) {
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const OfferRideScreen()));
      } else {
        Navigator.pop(context);
      }
    } on ApiError catch (e) {
      _form.currentState?.showServerError(e.field, e.message);
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = context.read<Session>().user!;
    return Scaffold(
      appBar: AppBar(title: Text(u.vehicle == null ? 'Add your car' : 'My car')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        if (u.upiId == null) ...[const Notice('Add your UPI ID in Personal information so riders can pay you directly.'), const SizedBox(height: 16)],
        VehicleForm(key: _form, initial: u.vehicle),
        const SizedBox(height: 28),
        LoadingButton(label: 'Save car', loading: _saving, onPressed: _save),
      ]),
    );
  }
}

class SafetyScreen extends StatefulWidget {
  const SafetyScreen({super.key});
  @override
  State<SafetyScreen> createState() => _SafetyScreenState();
}

class _SafetyScreenState extends State<SafetyScreen> {
  late final List<(TextEditingController, TextEditingController)> _rows = [
    for (final c in context.read<Session>().user!.emergencyContacts) (TextEditingController(text: c.name), TextEditingController(text: c.phone)),
  ];
  String? _error;
  bool _saving = false;

  Future<void> _save() async {
    final contacts = <Map<String, String>>[];
    for (final (n, p) in _rows) {
      if (n.text.trim().isEmpty && p.text.trim().isEmpty) continue;
      if (n.text.trim().isEmpty || validatePhone(p.text) != null) return setState(() => _error = 'Enter a name and a valid 10-digit mobile number for each contact.');
      contacts.add({'name': n.text.trim(), 'phone': p.text.replaceAll(RegExp(r'\D'), '').substring(p.text.replaceAll(RegExp(r'\D'), '').length - 10)});
    }
    setState(() => (_saving = true, _error = null));
    final session = context.read<Session>();
    try {
      session.setUser(await session.api.updateMe({'emergencyContacts': contacts}));
      if (mounted) {
        toast(context, 'Emergency contacts saved');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) setState(() => (_saving = false, _error = errorText(e)));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Safety')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          const Notice('During a ride, the SOS button can call 112 or text these contacts your ride details and location.', icon: Icons.shield_outlined),
          const SizedBox(height: 20),
          for (var i = 0; i < _rows.length; i++) ...[
            Row(children: [
              Expanded(child: TextField(controller: _rows[i].$1, decoration: const InputDecoration(labelText: 'Name'))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _rows[i].$2, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile'))),
              IconButton(onPressed: () => setState(() => _rows.removeAt(i)), icon: const Icon(Icons.close)),
            ]),
            const SizedBox(height: 12),
          ],
          if (_rows.length < 3)
            OutlinedButton.icon(onPressed: () => setState(() => _rows.add((TextEditingController(), TextEditingController()))), icon: const Icon(Icons.add), label: const Text('Add contact')),
          const SizedBox(height: 20),
          if (_error != null) ...[Notice(_error!, tone: 'error'), const SizedBox(height: 12)],
          LoadingButton(label: 'Save', loading: _saving, onPressed: _save),
        ]),
      );
}

class PaymentsScreen extends StatelessWidget {
  const PaymentsScreen({super.key});

  static const _status = {
    'unpaid': ('Cash due', RS.warning, RS.warning50),
    'marked_paid': ('Paid · unconfirmed', RS.primary, RS.primary50),
    'received': ('Received', RS.success, RS.success50),
    'paid_online': ('Paid', RS.success, RS.success50),
    'refunded': ('Refunded', RS.ink700, RS.sunken),
  };

  @override
  Widget build(BuildContext context) {
    final u = context.watch<Session>().user!;
    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: LiveLoader<(List<PaymentRecord>, WalletInfo)>(
        load: (api) async => (await api.payments(), await api.wallet()),
        builder: (context, data, reload) {
          final (list, wallet) = data;
          final now = DateTime.now();
          final month = list.where((p) => p.at.month == now.month && p.at.year == now.year);
          final spent = month.where((p) => p.direction == 'paid' && p.status != 'unpaid' && p.status != 'refunded').fold<int>(0, (s, p) => s + p.amount);
          final received = month.where((p) => p.direction == 'received' && (p.status == 'received' || p.status == 'paid_online')).fold<int>(0, (s, p) => s + p.amount);
          final toCollect = list.where((p) => p.direction == 'received' && (p.status == 'unpaid' || p.status == 'marked_paid')).fold<int>(0, (s, p) => s + p.amount);
          final driver = u.commute != 'rider';
          return ListView(padding: const EdgeInsets.all(16), children: [
            FadeSlideIn(child: _WalletCard(wallet: wallet, onChanged: reload)),
            if (wallet.transactions.isNotEmpty) ...[
              const SectionTitle('Wallet activity'),
              Card(
                clipBehavior: Clip.antiAlias,
                child: Column(children: [
                  for (final (i, t) in wallet.transactions.take(20).indexed) ...[
                    if (i > 0) const Divider(indent: 72),
                    ListTile(
                      onTap: t.bookingId == null ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(bookingId: t.bookingId!))),
                      leading: CircleAvatar(
                        backgroundColor: t.amount > 0 ? RS.success50 : RS.primary50,
                        child: Icon(
                          switch (t.kind) { 'topup' => Icons.add, 'refund' => Icons.replay, _ => t.amount > 0 ? Icons.south_west_rounded : Icons.north_east_rounded },
                          color: t.amount > 0 ? RS.success : RS.primary,
                          size: 20,
                        ),
                      ),
                      title: Text(t.note, style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(ago(t.createdAt)),
                      trailing: Text('${t.amount > 0 ? '+' : '−'}${money(t.amount.abs())}', style: TextStyle(fontWeight: FontWeight.w700, color: t.amount > 0 ? RS.success : RS.ink900)),
                    ),
                  ],
                ]),
              ),
            ],
            const SizedBox(height: 12),
            FadeSlideIn(
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(RS.radiusXl),
                  gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [RS.primary, RS.primary700]),
                  boxShadow: const [BoxShadow(color: Color(0x445038E6), blurRadius: 18, offset: Offset(0, 8))],
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(driver ? 'Cost-share received this month' : 'Spent on rides this month', style: const TextStyle(color: Colors.white70)),
                  const SizedBox(height: 6),
                  TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: (driver ? received : spent).toDouble()),
                    duration: const Duration(milliseconds: 900),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, _) => Text(money(v), style: RS.heading(34, color: Colors.white)),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    driver && toCollect > 0 ? '${money(toCollect)} still to confirm or collect' : (driver ? 'Paid directly to you by UPI or cash' : 'Paid directly to drivers by UPI, cash or online'),
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  if (driver) ...[
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54), minimumSize: const Size(0, 40)),
                      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PaymentMethodsScreen())),
                      icon: const Icon(Icons.alternate_email, size: 18),
                      label: Text(u.upiId ?? 'Add UPI ID'),
                    ),
                  ],
                ]),
              ),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('Spent this month', style: TextStyle(color: RS.ink500)), Text(money(spent), style: RS.heading(20))]))),
              const SizedBox(width: 10),
              Expanded(child: Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('To collect', style: TextStyle(color: RS.ink500)), Text(money(toCollect), style: RS.heading(20))]))),
            ]),
            const SectionTitle('Activity'),
            if (list.isEmpty)
              const EmptyState(icon: Icons.receipt_long_outlined, title: 'No payments yet', body: 'Cost-share you pay or receive for rides appears here.')
            else
              Card(
                clipBehavior: Clip.antiAlias,
                child: Column(children: [
                  for (final (i, p) in list.indexed) ...[
                    if (i > 0) const Divider(indent: 72),
                    ListTile(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(bookingId: p.bookingId))),
                      leading: CircleAvatar(
                        backgroundColor: p.direction == 'received' ? RS.success50 : RS.primary50,
                        child: Icon(p.direction == 'received' ? Icons.south_west_rounded : Icons.north_east_rounded, color: p.direction == 'received' ? RS.success : RS.primary, size: 20),
                      ),
                      title: Text(p.direction == 'received' ? 'From ${p.counterparty}' : 'To ${p.counterparty}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text('${p.route} · ${switch (p.method) { 'upi' => 'UPI', 'online' => 'Online', 'wallet' => 'Wallet', _ => 'Cash' }} · ${ago(p.at)}', maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text('${p.direction == 'received' ? '+' : '−'}${money(p.amount)}', style: TextStyle(fontWeight: FontWeight.w700, color: p.direction == 'received' ? RS.success : RS.ink900)),
                        const SizedBox(height: 2),
                        Pill(_status[p.status]?.$1 ?? p.status, color: _status[p.status]?.$2 ?? RS.ink700, background: _status[p.status]?.$3 ?? RS.sunken),
                      ]),
                    ),
                  ],
                ]),
              ),
            const SizedBox(height: 12),
            const Text('Riders pay from the RideSync Wallet, online through Razorpay, or directly to drivers by UPI or cash. Wallet and online payments for cancelled rides are refunded automatically.', style: TextStyle(color: RS.ink500, fontSize: 12.5)),
          ]);
        },
      ),
    );
  }
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({required this.wallet, required this.onChanged});
  final WalletInfo wallet;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(RS.radiusXl),
          color: RS.ink900,
          boxShadow: const [BoxShadow(color: Color(0x3315182E), blurRadius: 18, offset: Offset(0, 8))],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.account_balance_wallet, color: Colors.white70, size: 18),
            const SizedBox(width: 6),
            const Text('RideSync Wallet', style: TextStyle(color: Colors.white70)),
            const Spacer(),
            if (wallet.testMode) const Pill('TEST MODE', color: RS.ink900, background: Color(0xFFFFD166)),
          ]),
          const SizedBox(height: 6),
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: wallet.balance.toDouble()),
            duration: const Duration(milliseconds: 900),
            curve: Curves.easeOutCubic,
            builder: (_, v, _) => Text(money(v), style: RS.heading(34, color: Colors.white)),
          ),
          const SizedBox(height: 4),
          const Text('Pay for rides in one tap · cancelled rides are refunded here instantly', style: TextStyle(color: Colors.white70, fontSize: 13)),
          const SizedBox(height: 14),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: RS.ink900, minimumSize: const Size(0, 42)),
            onPressed: wallet.canTopUp
                ? () async {
                    if (await addMoney(context, testMode: wallet.testMode) && context.mounted) {
                      await showSuccess(context, 'Money added', subtitle: 'Your wallet is ready for your next ride.');
                      await onChanged();
                    }
                  }
                : () => toast(context, 'Adding money needs Razorpay keys on the server. Run setup and add your Razorpay test keys.'),
            icon: const Icon(Icons.add),
            label: const Text('Add money'),
          ),
        ]),
      );
}

class PreferencesScreen extends StatefulWidget {
  const PreferencesScreen({super.key});
  @override
  State<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends State<PreferencesScreen> {
  Future<void> _set(Map<String, dynamic> patch) async {
    final session = context.read<Session>();
    try {
      session.setUser(await session.api.updateMe(patch));
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = context.watch<Session>().user!;
    return Scaffold(
      appBar: AppBar(title: const Text('Preferences')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text('How you commute', style: RS.heading(17)),
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'driver', label: Text('I have a car')),
            ButtonSegment(value: 'rider', label: Text('I need a ride')),
            ButtonSegment(value: 'both', label: Text('Both')),
          ],
          selected: {u.commute ?? 'both'},
          showSelectedIcon: false,
          onSelectionChanged: (v) => _set({'commute': v.first}),
        ),
        if (u.commute != 'rider' && u.vehicle == null) ...[
          const SizedBox(height: 12),
          Notice('Add your car to start offering rides.', tone: 'warning', icon: Icons.directions_car_outlined),
          TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const VehicleScreen())), child: const Text('Add car')),
        ],
        const SizedBox(height: 28),
        Text('How did you usually get to college?', style: RS.heading(17)),
        const SizedBox(height: 4),
        const Text('Before RideSync. Your CO₂ saved counts only what sharing really replaces: a car, cab, auto or bike trip — not a train or bus.', style: TextStyle(color: RS.ink500)),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (v, l) in const [('car', 'My own car'), ('cab', 'Cab'), ('auto', 'Auto'), ('bike', 'Bike / scooter'), ('train', 'Local train'), ('bus', 'Bus'), ('walk', 'Walk / cycle')])
            ChoiceChip(label: Text(l), selected: u.usualMode == v, onSelected: (_) => _set({'usualMode': v})),
        ]),
        const SizedBox(height: 28),
        Text('Ride preferences', style: RS.heading(17)),
        const SizedBox(height: 4),
        const Text('Applied by default when you search or offer. AI matching scores rides higher when they fit.', style: TextStyle(color: RS.ink500)),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final e in preferenceLabel.entries)
            FilterChip(
              label: Text(e.value),
              selected: u.preferences.contains(e.key),
              showCheckmark: false,
              onSelected: (on) => _set({'preferences': on ? [...u.preferences, e.key] : u.preferences.where((x) => x != e.key).toList()}),
            ),
        ]),
      ]),
    );
  }
}

class PaymentMethodsScreen extends StatefulWidget {
  const PaymentMethodsScreen({super.key});
  @override
  State<PaymentMethodsScreen> createState() => _PaymentMethodsScreenState();
}

class _PaymentMethodsScreenState extends State<PaymentMethodsScreen> {
  late final _upi = TextEditingController(text: context.read<Session>().user!.upiId);
  String? _error;
  bool _saving = false;

  Future<void> _save() async {
    final v = _upi.text.trim();
    if (v.isNotEmpty && validateUpiId(v) != null) return setState(() => _error = validateUpiId(v));
    setState(() => (_saving = true, _error = null));
    final session = context.read<Session>();
    try {
      session.setUser(await session.api.updateMe({'upiId': v}));
      if (mounted) {
        toast(context, v.isEmpty ? 'UPI ID removed' : 'UPI ID saved');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) setState(() => (_saving = false, _error = errorText(e)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = context.read<Session>().config?.razorpayKeyId != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Payment methods')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text('Receive cost-share', style: RS.heading(17)),
        const SizedBox(height: 4),
        const Text('When you drive, riders pay you directly from Google Pay, PhonePe, Paytm or any UPI app using this ID.', style: TextStyle(color: RS.ink500, height: 1.4)),
        const SizedBox(height: 14),
        TextField(controller: _upi, autocorrect: false, decoration: InputDecoration(labelText: 'Your UPI ID', hintText: 'yourname@okaxis', errorText: _error)),
        const SizedBox(height: 24),
        Text('Paying for rides', style: RS.heading(17)),
        const SizedBox(height: 4),
        Text(
          'After a driver accepts, pay them by UPI (we open your UPI app with the amount filled in, or show a QR code), in cash at pickup${online ? ', or online with UPI, cards or netbanking — refunded automatically if the ride is cancelled' : ''}.',
          style: const TextStyle(color: RS.ink500, height: 1.4),
        ),
        const SizedBox(height: 16),
        const Notice('RideSync never asks for your UPI PIN and charges no fees.', icon: Icons.shield_outlined),
        const SizedBox(height: 24),
        LoadingButton(label: 'Save', loading: _saving, onPressed: _save),
      ]),
    );
  }
}

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});
  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  bool _sounds = Sounds.on;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Notifications')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          const Notice('Notifications are on. You get instant alerts for requests, acceptances, arrivals and messages while RideSync is open.', tone: 'success', icon: Icons.notifications_active_outlined),
          const SizedBox(height: 16),
          Card(
            child: Column(children: [
              const ListTile(title: Text('Ride updates'), subtitle: Text('Requests, acceptances, arrivals, cancellations'), trailing: Text('Always on', style: TextStyle(color: RS.ink500))),
              const Divider(indent: 16),
              const ListTile(title: Text('Messages'), subtitle: Text('Chat from drivers and riders'), trailing: Text('Always on', style: TextStyle(color: RS.ink500))),
              const Divider(indent: 16),
              const ListTile(title: Text('Payments'), subtitle: Text('When a rider pays or a driver confirms'), trailing: Text('Always on', style: TextStyle(color: RS.ink500))),
              const Divider(indent: 16),
              SwitchListTile(
                title: const Text('Sounds and vibration'),
                subtitle: const Text('A chime when your seat is confirmed, a ring for new requests, a beep when your driver arrives'),
                value: _sounds,
                onChanged: (on) async {
                  setState(() => _sounds = on);
                  await Sounds.setOn(on);
                  if (on) Sounds.play(Sound.success);
                },
              ),
            ]),
          ),
        ]),
      );
}

const _faq = [
  ('How is the fare decided?', 'RideSync works out what the trip really costs the driver’s car: the fuel it burns at the speed traffic allows for that time (from TomTom’s traffic forecast — cars use more fuel per km in slow traffic, so no fixed mileage figure is used), plus what it burns in jams, plus any tolls or parking. That cost is split equally among everyone in the car, the driver included, by the km each person rides. You book at your share plus a 10% traffic cushion — the most you can ever pay — and it drops as more riders join, and again when the trip starts if traffic is lighter. There is no platform fee and no profit for the driver: it’s cost-sharing, usually a fraction of an auto fare.'),
  ('What does the AI match score mean?', 'It combines how much of your route the driver covers, how close they pass your pickup, timing, your preferences and the driver’s reliability. Tap “Why this match?” on any ride to see the breakdown.'),
  ('What if my driver cancels?', 'You’re notified straight away. If you paid online, the money is refunded automatically; if you paid the driver by UPI, ask them to send it back. Search again to find the next best match.'),
  ('Who can join RideSync?', 'Only VIT students who sign in with their verified @vit.edu.in college email and a valid student ID.'),
  ('How do I pay?', 'After the driver accepts, pay them directly by UPI (we open GPay, PhonePe or Paytm with the amount filled in), in cash at pickup, or online when RideSync has online payments turned on.'),
  ('Is my phone number shared?', 'Only with your driver or riders once a seat is confirmed, and never on your public profile.'),
];

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Help & support')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(children: [
              for (final (i, (q, a)) in _faq.indexed) ...[
                if (i > 0) const Divider(indent: 16),
                ExpansionTile(
                  initiallyExpanded: i == 0,
                  shape: const Border(),
                  leading: const Icon(Icons.help_outline_rounded, color: RS.primary),
                  title: Text(q, style: const TextStyle(fontWeight: FontWeight.w600)),
                  childrenPadding: const EdgeInsets.fromLTRB(56, 0, 16, 16),
                  children: [Text(a, style: const TextStyle(color: RS.ink700, height: 1.45))],
                ),
              ],
            ]),
          ),
          const SizedBox(height: 16),
          const Notice('Need help with a ride? Message your driver or rider from the trip, or use SOS during a ride for emergencies.', icon: Icons.support_agent_rounded),
        ]),
      );
}
