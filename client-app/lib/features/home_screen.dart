import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../providers.dart';
import '../ui/unavailable_view.dart';
import 'document_detail_screen.dart';
import 'settings_screen.dart';

/// Browse and search. Metadata only — nothing on this screen has touched a
/// document's contents, and nothing here needs the master password.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(documentQueryProvider);
    final documents = ref.watch(documentsProvider);
    final categories = ref.watch(categoriesProvider);
    final grants = ref.watch(grantHolderProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Private Vault'),
        actions: [
          if (grants.isUnlocked)
            IconButton(
              tooltip: 'Lock',
              icon: const Icon(Icons.lock_open_outlined),
              onPressed: () => ref.read(vaultRepositoryProvider).lock(),
            ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(documentsProvider);
          ref.invalidate(categoriesProvider);
        },
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: TextField(
                  controller: _search,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search documents...',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: query.search.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _search.clear();
                              ref.read(documentQueryProvider.notifier).state =
                                  query.copyWith(search: '');
                            },
                          ),
                  ),
                  onSubmitted: (value) =>
                      ref.read(documentQueryProvider.notifier).state =
                          query.copyWith(search: value.trim()),
                ),
              ),
            ),

            SliverToBoxAdapter(
              child: SizedBox(
                height: 48,
                child: categories.maybeWhen(
                  data: (list) => ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      _Chip(
                        label: 'Favourites',
                        icon: Icons.star_outline,
                        selected: query.favouritesOnly,
                        onTap: () => ref.read(documentQueryProvider.notifier).state =
                            query.copyWith(favouritesOnly: !query.favouritesOnly),
                      ),
                      for (final category in list)
                        _Chip(
                          label: '${category.name} (${category.documentCount})',
                          selected: query.category == category.slug,
                          onTap: () =>
                              ref.read(documentQueryProvider.notifier).state =
                                  query.category == category.slug
                                      ? query.copyWith(clearCategory: true)
                                      : query.copyWith(category: category.slug),
                        ),
                    ],
                  ),
                  orElse: () => const SizedBox.shrink(),
                ),
              ),
            ),

            if (grants.isUnlocked)
              SliverToBoxAdapter(
                child: _UnlockedBanner(remaining: grants.remaining),
              ),

            documents.when(
              loading: () => const SliverFillRemaining(
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => SliverFillRemaining(
                child: FailureView(
                  error: error,
                  onRetry: () => ref.invalidate(documentsProvider),
                ),
              ),
              data: (page) {
                if (page.items.isEmpty) {
                  return SliverFillRemaining(
                    child: Center(
                      child: Text(
                        'No documents.',
                        style: theme.textTheme.bodyLarge
                            ?.copyWith(color: theme.colorScheme.outline),
                      ),
                    ),
                  );
                }
                return SliverList.builder(
                  itemCount: page.items.length,
                  itemBuilder: (context, index) =>
                      _DocumentTile(document: page.items[index]),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        avatar: icon == null ? null : Icon(icon, size: 18),
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
      ),
    );
  }
}

class _UnlockedBanner extends StatelessWidget {
  const _UnlockedBanner({required this.remaining});

  final Duration remaining;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final minutes = remaining.inMinutes;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_open, size: 18),
          const SizedBox(width: 10),
          Text(
            minutes >= 1
                ? 'Access expires in $minutes minute${minutes == 1 ? '' : 's'}.'
                : 'Access expires shortly.',
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({required this.document});

  final DocumentMeta document;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
      child: Card(
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          leading: Container(
            width: 42,
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              document.shortType,
              style: theme.textTheme.labelSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          title: Text(document.title, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text(
            '${document.categoryName} · ${document.readableSize}',
            style: theme.textTheme.bodySmall,
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => DocumentDetailScreen(document: document),
            ),
          ),
        ),
      ),
    );
  }
}
