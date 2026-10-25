import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/session.dart';

/// Opens the website's Privacy Policy (`/privacy`) or Terms of Use (`/terms`) in the browser.
Future<void> openLegal(BuildContext context, String path) async {
  final messenger = ScaffoldMessenger.of(context);
  final current = context.read<Session>().server;
  final base = current.isNotEmpty ? current : builtInServer;
  final ok = base.isNotEmpty && await launchUrl(Uri.parse('$base$path'), mode: LaunchMode.externalApplication).catchError((_) => false);
  if (!ok) messenger.showSnackBar(const SnackBar(content: Text('Couldn’t open the page. Check your internet connection.')));
}
