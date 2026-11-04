import 'package:flutter/material.dart';

import '../core/failure.dart';

/// What the user sees when something goes wrong.
///
/// This is the screen ARCHITECTURE §23 is about. It is reached when the
/// service cannot be contacted, when a request times out, when the backend
/// returns an error, and when a document does not exist — and it looks
/// identical in all of those cases.
///
/// There is no "retrying" state, no diagnostic text, no error code shown to
/// the user, and no indication of whether waiting would help. The person
/// holding the phone cannot tell a deployment problem from a typo in a
/// document id, which is the intended outcome.
class UnavailableView extends StatelessWidget {
  const UnavailableView({
    super.key,
    this.failure = Failure.unavailable,
    this.onRetry,
  });

  final Failure failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              failure.title,
              style: theme.textTheme.displaySmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colorScheme.outline,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              failure.detail,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 28),
              OutlinedButton(
                onPressed: onRetry,
                child: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Turns any thrown object into the generic view.
///
/// The `error` parameter is accepted and then deliberately ignored for
/// anything that is not a [VaultException] — an unexpected exception must not
/// become a more informative screen than an expected one.
class FailureView extends StatelessWidget {
  const FailureView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final failure =
        error is VaultException ? (error as VaultException).failure : Failure.unavailable;
    return UnavailableView(failure: failure, onRetry: onRetry);
  }
}
