import 'package:flutter/material.dart';

import '../api/models.dart';
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
  late final _mileage = TextEditingController(text: widget.initial?.mileage == null ? '' : _num(widget.initial!.mileage!));
  Map<String, String?> _errors = {};

  static String _num(double n) => n == n.roundToDouble() ? n.toStringAsFixed(0) : n.toString();

  /// Unit, typical km per unit in Mumbai traffic and the believable range (as on the server, src/lib/fuel.ts).
  static const fuels = {
    'petrol': ('L', 10.0, 2.0, 30.0),
    'diesel': ('L', 13.0, 2.0, 35.0),
    'cng': ('kg', 15.0, 4.0, 40.0),
    'ev': ('kWh', 6.0, 3.0, 12.0),
  };

  String? _mileageError() {
    final t = _mileage.text.trim();
    if (t.isEmpty) return null;
    final n = double.tryParse(t);
    final (unit, _, min, max) = fuels[_fuel]!;
    return n != null && n >= min && n <= max ? null : 'Between ${_num(min)} and ${_num(max)} km/$unit, or leave it empty';
  }

  /// Validated JSON for PUT /me/vehicle, or null (errors are shown).
  Map<String, dynamic>? value() {
    final e = {
      'make': requiredField(_make.text, 'make'),
      'model': requiredField(_model.text, 'model'),
      'color': requiredField(_color.text, 'colour'),
      'plate': validatePlate(_plate.text),
      'mileage': _mileageError(),
    };
    setState(() => _errors = e);
    if (e.values.any((v) => v != null)) return null;
    return {
      'make': _make.text.trim(),
      'model': _model.text.trim(),
      'color': _color.text.trim(),
      'plate': _plate.text.trim().toUpperCase(),
      'seats': _seats,
      'fuel': _fuel,
      'mileage': _mileage.text.trim().isEmpty ? null : double.parse(_mileage.text.trim()),
    };
  }

  void showServerError(String? field, String message) => setState(() => _errors = {...{}, field ?? 'plate': message});

  @override
  void dispose() {
    for (final c in [_make, _model, _color, _plate, _mileage]) {
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
          IconButton.outlined(onPressed: _seats < maxSeats ? () => setState(() => _seats++) : null, icon: const Icon(Icons.add)),
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
        onSelectionChanged: (s) => setState(() => _fuel = s.first),
      ),
      const SizedBox(height: 14),
      Builder(builder: (_) {
        final (unit, typical, _, _) = fuels[_fuel]!;
        return TextField(
          controller: _mileage,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: 'Mileage in city traffic (km/$unit) — optional',
            hintText: 'Typical: ${_num(typical)}',
            helperText: 'What your car really gives in Mumbai traffic. It sets your suggested seat price.',
            helperMaxLines: 2,
            errorText: _errors['mileage'],
          ),
        );
      }),
    ],
  );
}
