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
  Map<String, String?> _errors = {};

  /// Validated JSON for PUT /me/vehicle, or null (errors are shown).
  Map<String, dynamic>? value() {
    final e = {
      'make': requiredField(_make.text, 'make'),
      'model': requiredField(_model.text, 'model'),
      'color': requiredField(_color.text, 'colour'),
      'plate': validatePlate(_plate.text),
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
    };
  }

  void showServerError(String? field, String message) => setState(() => _errors = {...{}, field ?? 'plate': message});

  @override
  void dispose() {
    for (final c in [_make, _model, _color, _plate]) {
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
    ],
  );
}
