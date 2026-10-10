import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart' as fm;
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gm;
import 'package:latlong2/latlong.dart' as ll;
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../data/places.dart';
import '../state/session.dart';
import '../theme.dart';
import 'common.dart';
import 'ride_map.dart' show useGoogleMaps;

/// Best GPS fix we can get in a few seconds: phones often report a rough
/// position first and sharpen it as satellites lock on.
Future<Position> preciseLocation() async {
  if (!await Geolocator.isLocationServiceEnabled()) throw 'Turn on Location on your phone, then try again.';
  var perm = await Geolocator.checkPermission();
  if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
  if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
    throw 'Location permission is off. Allow it for RideSync in your phone’s Settings, or choose the place on the map.';
  }
  var best = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 15)));
  if (best.accuracy <= 25) return best;
  final done = Completer<void>();
  final sub = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best)).listen((p) {
    if (p.accuracy < best.accuracy) best = p;
    if (best.accuracy <= 20 && !done.isCompleted) done.complete();
  });
  await done.future.timeout(const Duration(seconds: 6), onTimeout: () {});
  await sub.cancel();
  return best;
}

/// Ola/Uber-style "move the map to set your pickup": a fixed pin in the middle,
/// the place name updates when the map stops moving.
Future<Place?> pickOnMap(BuildContext context, {required String title, LatLngPoint? start, double? accuracy}) =>
    Navigator.of(context).push<Place>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => _PinPicker(title: title, start: start ?? campus.point, accuracy: accuracy)));

class _PinPicker extends StatefulWidget {
  const _PinPicker({required this.title, required this.start, this.accuracy});
  final String title;
  final LatLngPoint start;
  final double? accuracy;
  @override
  State<_PinPicker> createState() => _PinPickerState();
}

class _PinPickerState extends State<_PinPicker> {
  late LatLngPoint _center = widget.start;
  late double? _accuracy = widget.accuracy;
  String? _name;
  String _area = '';
  bool _moving = false;
  bool _naming = false;
  bool _locating = false;
  Timer? _debounce;
  int _seq = 0;
  final _osm = fm.MapController();
  gm.GoogleMapController? _g;
  // The student's own name for the spot ("Shanti Niwas, Gate 2") when the map doesn't know it.
  final _custom = TextEditingController();
  bool _editing = false;
  String get _typed => _custom.text.trim();

  /// Under a typed name, show what the map calls the spot so the driver can still find it.
  String get _subtitle => _typed.isEmpty ? _area : [_name, _area].where((x) => x != null && x.isNotEmpty).join(', ');

  @override
  void initState() {
    super.initState();
    _lookup();
  }

  void _onMove(LatLngPoint p) {
    _center = p;
    if (!_moving) setState(() => _moving = true);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 550), () {
      if (!mounted) return;
      setState(() => _moving = false);
      _lookup();
    });
  }

  Future<void> _lookup() async {
    final id = ++_seq;
    setState(() => _naming = true);
    try {
      final r = await context.read<Session>().api.reverse(_center.lat, _center.lng);
      if (mounted && id == _seq) setState(() => (_name = r.name, _area = r.area, _naming = false));
    } catch (_) {
      if (mounted && id == _seq) setState(() => (_name = 'Pinned location', _area = '${_center.lat.toStringAsFixed(5)}, ${_center.lng.toStringAsFixed(5)}', _naming = false));
    }
  }

  Future<void> _myLocation() async {
    setState(() => _locating = true);
    try {
      final p = await preciseLocation();
      _accuracy = p.accuracy;
      final c = LatLngPoint(p.latitude, p.longitude);
      if (useGoogleMaps && !kIsWeb) {
        await _g?.animateCamera(gm.CameraUpdate.newLatLngZoom(gm.LatLng(c.lat, c.lng), 18));
      } else {
        _osm.move(ll.LatLng(c.lat, c.lng), 18);
      }
      _onMove(c);
    } catch (e) {
      if (mounted) toast(context, e is String ? e : 'Couldn’t get your location.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _g?.dispose();
    _custom.dispose();
    super.dispose();
  }

  Widget _map() {
    final s = widget.start;
    if (useGoogleMaps && !kIsWeb) {
      return gm.GoogleMap(
        initialCameraPosition: gm.CameraPosition(target: gm.LatLng(s.lat, s.lng), zoom: 18),
        myLocationEnabled: true,
        myLocationButtonEnabled: false,
        zoomControlsEnabled: false,
        mapToolbarEnabled: false,
        onMapCreated: (c) => _g = c,
        onCameraMove: (p) => _onMove(LatLngPoint(p.target.latitude, p.target.longitude)),
      );
    }
    // Street map from the RideSync server (see ride_map.dart).
    final tiles = context.select<Session, String>((x) => x.api.mapTileUrl);
    return fm.FlutterMap(
      mapController: _osm,
      options: fm.MapOptions(
        initialCenter: ll.LatLng(s.lat, s.lng),
        initialZoom: 18,
        maxZoom: 19,
        interactionOptions: const fm.InteractionOptions(flags: fm.InteractiveFlag.all & ~fm.InteractiveFlag.rotate),
        onPositionChanged: (pos, hasGesture) {
          if (hasGesture) _onMove(LatLngPoint(pos.center.latitude, pos.center.longitude));
        },
      ),
      children: [
        fm.TileLayer(
          urlTemplate: tiles,
          userAgentPackageName: 'com.ridesync.ridesync',
          retinaMode: fm.RetinaMode.isHighDensity(context),
        ),
        if (_accuracy != null && _accuracy! > 15)
          fm.CircleLayer(circles: [
            fm.CircleMarker(point: ll.LatLng(s.lat, s.lng), radius: _accuracy!, useRadiusInMeter: true, color: RS.secondary.withValues(alpha: 0.12), borderColor: RS.secondary.withValues(alpha: 0.4), borderStrokeWidth: 1),
          ]),
        fm.MarkerLayer(markers: [
          fm.Marker(
            point: ll.LatLng(s.lat, s.lng),
            width: 18,
            height: 18,
            child: Container(decoration: BoxDecoration(color: RS.secondary, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3))),
          ),
        ]),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    return Scaffold(
      body: Stack(children: [
        Positioned.fill(child: _map()),
        // The pin: lifts while the map moves, drops when it settles.
        IgnorePointer(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 44),
              child: AnimatedSlide(
                offset: _moving ? const Offset(0, -0.18) : Offset.zero,
                duration: const Duration(milliseconds: 180),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(color: RS.ink900, borderRadius: BorderRadius.circular(8)),
                    child: Text(_moving ? 'Release to set' : widget.title, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ),
                  const SizedBox(height: 4),
                  const Icon(Icons.location_on, color: RS.primary, size: 44, shadows: [Shadow(color: Color(0x5515182E), blurRadius: 6)]),
                ]),
              ),
            ),
          ),
        ),
        Positioned(
          top: top + 8,
          left: 12,
          child: Material(
            color: RS.surface,
            shape: const CircleBorder(),
            elevation: 3,
            child: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.pop(context)),
          ),
        ),
        Positioned(
          right: 16,
          bottom: 210,
          child: FloatingActionButton.small(
            heroTag: 'locate',
            backgroundColor: RS.surface,
            foregroundColor: RS.primary,
            onPressed: _locating ? null : _myLocation,
            child: _locating ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.my_location),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: EdgeInsets.fromLTRB(20, 18, 20, 16 + MediaQuery.of(context).padding.bottom),
            decoration: const BoxDecoration(
              color: RS.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(RS.radiusXl)),
              boxShadow: [BoxShadow(color: Color(0x2215182E), blurRadius: 24, offset: Offset(0, -4))],
            ),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Move the map to put the pin exactly on your building or gate', style: const TextStyle(color: RS.ink500, fontSize: 13)),
              const SizedBox(height: 10),
              Row(children: [
                const Icon(Icons.location_on, color: RS.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: _editing
                        ? TextField(
                            key: const ValueKey('edit'),
                            controller: _custom,
                            autofocus: true,
                            maxLength: 80,
                            textCapitalization: TextCapitalization.words,
                            decoration: const InputDecoration(hintText: 'e.g. Shanti Niwas, Gate 2', counterText: '', isDense: true),
                            onChanged: (_) => setState(() {}),
                            onSubmitted: (_) => setState(() => _editing = false),
                          )
                        : _moving || _naming
                            ? const Align(key: ValueKey('busy'), alignment: Alignment.centerLeft, child: Text('Finding this place…', style: TextStyle(color: RS.ink500)))
                            : Column(
                                key: ValueKey('$_name$_typed'),
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(_typed.isNotEmpty ? _typed : (_name ?? 'Pinned location'), style: RS.heading(17), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  if (_subtitle.isNotEmpty) Text(_subtitle, style: const TextStyle(color: RS.ink500, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                                ],
                              ),
                  ),
                ),
                IconButton(
                  tooltip: _editing ? 'Done' : 'Edit name',
                  icon: Icon(_editing ? Icons.check : Icons.edit_outlined, color: RS.ink700),
                  onPressed: () => setState(() => _editing = !_editing),
                ),
              ]),
              if (!_editing && _typed.isEmpty && !_moving && !_naming)
                const Padding(
                  padding: EdgeInsets.only(left: 34),
                  child: Text('Wrong name? Tap the pencil to type your building or gate.', style: TextStyle(color: RS.ink500, fontSize: 12)),
                ),
              if (_accuracy != null && _accuracy! > 50) ...[
                const SizedBox(height: 10),
                Notice('Your GPS is only accurate to about ${_accuracy!.round()} m here. Drag the map so the pin sits on your exact spot.', tone: 'warning'),
              ],
              const SizedBox(height: 14),
              LoadingButton(
                label: 'Confirm ${widget.title.toLowerCase()}',
                onPressed: _moving || (_naming && _typed.isEmpty) || (_name == null && _typed.isEmpty)
                    ? null
                    : () => Navigator.pop(
                          context,
                          Place(
                            id: 'pin-${_center.lat.toStringAsFixed(5)},${_center.lng.toStringAsFixed(5)}',
                            name: _typed.isNotEmpty ? _typed : _name!,
                            area: _subtitle.length > 200 ? _subtitle.substring(0, 200) : _subtitle,
                            lat: _center.lat,
                            lng: _center.lng,
                            kind: 'custom',
                          ),
                        ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
