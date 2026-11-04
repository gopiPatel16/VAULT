import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../core/failure.dart';
import '../data/models.dart';
import '../providers.dart';
import 'unlock_sheet.dart';

/// Metadata is visible immediately; contents are behind the master password.
///
/// The screen shows the document's title, type, size, category and dates —
/// all of which the client already had from the list. What it does not show,
/// and cannot show, is anything about where the document physically is.
class DocumentDetailScreen extends ConsumerStatefulWidget {
  const DocumentDetailScreen({super.key, required this.document});

  final DocumentMeta document;

  @override
  ConsumerState<DocumentDetailScreen> createState() =>
      _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends ConsumerState<DocumentDetailScreen> {
  bool _busy = false;
  Uint8List? _preview;
  Failure? _failure;
  DocumentMeta? _local;

  DocumentMeta get _document => _local ?? widget.document;

  /// Ensures a live unlock window, prompting for the password if needed.
  Future<bool> _ensureUnlocked() async {
    if (ref.read(grantHolderProvider).isUnlocked) return true;
    if (!mounted) return false;
    return showUnlockSheet(context);
  }

  /// Favouriting is metadata, not contents — it deliberately needs no
  /// document grant, the same as browsing and searching.
  Future<void> _toggleFavourite() async {
    final next = !_document.isFavourite;
    // Optimistic: the star responds immediately and is put back if the
    // request fails, rather than leaving the screen unresponsive.
    setState(() => _local = _document.withFavourite(next));
    try {
      await ref.read(vaultRepositoryProvider).setFavourite(_document.id, next);
      ref.invalidate(documentsProvider);
    } on VaultException {
      if (mounted) setState(() => _local = _document.withFavourite(!next));
    }
  }

  Future<void> _preload() async {
    if (!await _ensureUnlocked()) return;

    setState(() {
      _busy = true;
      _failure = null;
    });

    try {
      final bytes = await ref
          .read(vaultRepositoryProvider)
          .content(_document.id, preview: true);
      if (mounted) setState(() => _preview = bytes);
    } on VaultException catch (e) {
      if (mounted) setState(() => _failure = e.failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() async {
    if (!await _ensureUnlocked()) return;

    setState(() {
      _busy = true;
      _failure = null;
    });

    try {
      final bytes =
          await ref.read(vaultRepositoryProvider).content(_document.id);

      // App-private, OS-encrypted storage. Never the shared Downloads folder:
      // a file there outlives the unlock window and is readable by anything
      // with storage permission.
      final dir = await getApplicationSupportDirectory();
      final file = File('${dir.path}/${_document.filename}');
      await file.writeAsBytes(bytes, flush: true);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Saved to this app.')),
        );
      }
    } on VaultException catch (e) {
      if (mounted) setState(() => _failure = e.failure);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final grants = ref.watch(grantHolderProvider);

    // A grant that expires while this screen is open drops the decrypted
    // preview with it, rather than leaving plaintext on screen past the
    // window it was authorised for.
    if (!grants.isUnlocked && _preview != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _preview = null);
      });
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_document.title),
        actions: [
          IconButton(
            tooltip: _document.isFavourite ? 'Remove favourite' : 'Add favourite',
            icon: Icon(
              _document.isFavourite ? Icons.star : Icons.star_outline,
              color: _document.isFavourite ? Colors.amber.shade700 : null,
            ),
            onPressed: () => unawaited(_toggleFavourite()),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_document.filename,
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 14),
                  _Row(label: 'Type', value: _document.shortType),
                  _Row(label: 'Size', value: _document.readableSize),
                  _Row(label: 'Category', value: _document.categoryName),
                  if (_document.tags.isNotEmpty)
                    _Row(label: 'Tags', value: _document.tags.join(', ')),
                  if (_document.documentDate != null)
                    _Row(
                      label: 'Date',
                      value: _document.documentDate!
                          .toIso8601String()
                          .substring(0, 10),
                    ),
                  _Row(
                    label: 'Added',
                    value:
                        _document.uploadedAt.toIso8601String().substring(0, 10),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 18),

          if (!grants.isUnlocked)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    const Text('🔐', style: TextStyle(fontSize: 28)),
                    const SizedBox(height: 10),
                    Text('Protected Document',
                        style: theme.textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text(
                      'The document master password is required to view or '
                      'download this file.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: _busy ? null : _preload,
                      child: const Text('Unlock Document'),
                    ),
                  ],
                ),
              ),
            )
          else ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _preload,
                    icon: const Icon(Icons.visibility_outlined),
                    label: const Text('Preview'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _download,
                    icon: const Icon(Icons.download_outlined),
                    label: const Text('Download'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Access expires in ${grants.remaining.inMinutes} minutes.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],

          if (_busy) ...[
            const SizedBox(height: 24),
            const Center(child: CircularProgressIndicator()),
          ],

          if (_failure != null) ...[
            const SizedBox(height: 20),
            Text(
              _failure!.detail,
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],

          if (_preview != null && _document.isImage) ...[
            const SizedBox(height: 20),
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.memory(_preview!),
            ),
          ] else if (_preview != null) ...[
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Icon(Icons.description_outlined,
                        size: 40, color: theme.colorScheme.outline),
                    const SizedBox(height: 10),
                    Text(
                      '${_document.shortType} loaded (${_document.readableSize}).',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
