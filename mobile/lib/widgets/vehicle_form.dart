import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../util/validation.dart';

/// Car details for drivers. Call [VehicleFormState.value] to validate and read them.
class VehicleForm extends StatefulWidget {
  const VehicleForm({super.key, this.initial});
  final Vehicle? initial;
  @override
  State<VehicleForm> createState() => VehicleFormState();
}

class VehicleFormState extends State<VehicleForm> {
  late final _make = TextEditingController(text: widget.initial?.make);
  late final _model = TextEditingController(text: widget.initial?.model);
  late final _color = TextEditingController(text: widget.initial?.color);
  late final _plate = TextEditingController(text: widget.initial?.plate);
  late int _seats = widget.initial?.seats ?? 3;
  late String _fuel = widget.initial?.fuel ?? 'petrol';
  // The car's own mileage per condition (optional): makes the trip cost, and so everyone's share, exact.
  late final _smooth = TextEditingController(text: _num(widget.initial?.mileageSmooth));
  late final _city = TextEditingController(text: _num(widget.initial?.mileageCity));
  late final _traffic = TextEditingController(text: _num(widget.initial?.mileageTraffic));
  Map<String, String?> _errors = {};

  // RideSync knows the mileage of popular models; typing your own is optional.
  late bool _ownOpen = widget.initial?.hasMileage ?? false;
  (String?, List<num>)? _known;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _make.addListener(_lookup);
    _model.addListener(_lookup);
    WidgetsBinding.instance.addPostFrameCallback((_) => _lookup());
  }

  void _lookup() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      try {
        final r = await context.read<Session>().api.carMileage(_make.text.trim(), _model.text.trim(), _fuel);
        if (mounted) setState(() => _known = r);
      } catch (_) {}
    });
  }

  static String _num(double? v) => v == null ? '' : (v == v.roundToDouble() ? v.toInt().toString() : v.toString());

  /// Typical mileage when a box is left blank (same as the server's DEFAULT_MILEAGE).
  static const typical = {
    'petrol': [18, 14, 7],
    'diesel': [20, 16, 8],
    'cng': [26, 22, 11],
    'ev': [6, 7, 7],
  };

  String? _mileageError(String t) {
    if (t.trim().isEmpty) return null;
    final v = double.tryParse(t.trim());
    return v == null || v < 1 || v > 60 ? '1 to 60' : null;
  }

  /// Validated JSON for PUT /me/vehicle, or null (errors are shown).
  Map<String, dynamic>? value() {
    final e = {
      'make': requiredField(_make.text, 'make'),
      'model': requiredField(_model.text, 'model'),
      'color': requiredField(_color.text, 'colour'),
      'plate': validatePlate(_plate.text),
      'm_smooth': _ownOpen ? _mileageError(_smooth.text) : null,
      'm_city': _ownOpen ? _mileageError(_city.text) : null,
      'm_traffic': _ownOpen ? _mileageError(_traffic.text) : null,
    };
    setState(() => _errors = e);
    if (e.values.any((v) => v != null)) return null;
    final m = {'smooth': double.tryParse(_smooth.text.trim()), 'city': double.tryParse(_city.text.trim()), 'traffic': double.tryParse(_traffic.text.trim())};
    return {
      'make': _make.text.trim(),
      'model': _model.text.trim(),
      'color': _color.text.trim(),
      'plate': _plate.text.trim().toUpperCase(),
      'seats': _seats,
      'fuel': _fuel,
      if (_ownOpen && m.values.any((v) => v != null)) 'mileage': m,
    };
  }

  void showServerError(String? field, String message) => setState(() => _errors = {...{}, field ?? 'plate': message});

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_make, _model, _color, _plate, _smooth, _city, _traffic]) {
      c.dispose();
    }
    super.dispose();
  }

  Widget _field(TextEditingController c, String key, String label, String hint, {TextCapitalization caps = TextCapitalization.words}) => TextField(
    controller: c,
    textCapitalization: caps,
    decoration: InputDecoration(labelText: label, hintText: hint, errorText: _errors[key]),
  );

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          Expanded(child: _field(_make, 'make', 'Make', 'Honda')),
          const SizedBox(width: 12),
          Expanded(child: _field(_model, 'model', 'Model', 'City')),
        ],
      ),
      const SizedBox(height: 14),
      Row(
        children: [
          Expanded(child: _field(_color, 'color', 'Colour', 'White')),
          const SizedBox(width: 12),
          Expanded(child: _field(_plate, 'plate', 'Registration number', 'MH 01 AB 1234', caps: TextCapitalization.characters)),
        ],
      ),
      const SizedBox(height: 18),
      Row(
        children: [
          const Expanded(
            child: Text('Passenger seats', style: TextStyle(fontWeight: FontWeight.w600)),
          ),
          IconButton.outlined(onPressed: _seats > 1 ? () => setState(() => _seats--) : null, icon: const Icon(Icons.remove)),
          SizedBox(
            width: 36,
            child: Text('$_seats', textAlign: TextAlign.center, style: RS.heading(18)),
          ),
          IconButton.outlined(onPressed: _seats < 7 ? () => setState(() => _seats++) : null, icon: const Icon(Icons.add)),
        ],
      ),
      const SizedBox(height: 14),
      const Text('Fuel', style: TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(value: 'petrol', label: Text('Petrol')),
          ButtonSegment(value: 'diesel', label: Text('Diesel')),
          ButtonSegment(value: 'cng', label: Text('CNG')),
          ButtonSegment(value: 'ev', label: Text('EV')),
        ],
        selected: {_fuel},
        showSelectedIcon: false,
        onSelectionChanged: (s) {
          setState(() => _fuel = s.first);
          _lookup();
        },
      ),
      const SizedBox(height: 18),
      const Text('Mileage', style: TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 4),
      if (_known != null)
        Text(
          '${_known!.$1 != null ? 'RideSync uses typical ${_known!.$1} ($_fuel) figures' : 'Typical ${_fuel == 'ev' ? 'electric' : _fuel} car figures'}: ${_known!.$2[0]} open roads · ${_known!.$2[1]} city · ${_known!.$2[2]} heavy traffic ($_unit). Nothing to type.',
          style: const TextStyle(color: RS.ink700, fontSize: 13),
        ),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          style: TextButton.styleFrom(padding: EdgeInsets.zero),
          onPressed: () => setState(() => _ownOpen = !_ownOpen),
          child: Text(_ownOpen ? 'Use the typical figures instead' : 'My car differs — enter my own (optional)'),
        ),
      ),
      if (_ownOpen) ...[
        const Text(
          'Fuel burns faster in traffic, so the trip cost uses the right one for each part of the route. Blank boxes use the typical figures.',
          style: TextStyle(color: RS.ink500, fontSize: 12.5),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final (i, c, key, label) in [(0, _smooth, 'm_smooth', 'Open roads'), (1, _city, 'm_city', 'City'), (2, _traffic, 'm_traffic', 'Traffic')]) ...[
              if (i > 0) const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: c,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(labelText: label, hintText: '${_known?.$2[i] ?? typical[_fuel]![i]}', suffixText: _unit, errorText: _errors[key]),
                ),
              ),
            ],
          ],
        ),
      ],
    ],
  );

  String get _unit => _fuel == 'ev'
      ? 'km/kWh'
      : _fuel == 'cng'
      ? 'km/kg'
      : 'km/L';
}
