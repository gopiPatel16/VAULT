/// The complete vocabulary of things that can go wrong, as far as this
/// application is concerned.
///
/// There is deliberately no member for "the service is unreachable", no member
/// for "the connection failed", and no member carrying a diagnostic message.
/// A dropped connection, a DNS failure, a TLS error, a timeout and a 500 all
/// arrive here as the same value, because the person holding the phone is not
/// entitled to learn which — see docs/ARCHITECTURE.md §3 and §23.
enum Failure {
  /// Nothing loaded. Covers every transport-level problem and every server
  /// error, without distinguishing between them.
  unavailable,

  /// This device is not authorised. Shown after revocation, after an expired
  /// session that could not be refreshed, and after a wrong password — the
  /// caller is never told which.
  notAuthorised,

  /// A credential was rejected. Used for the sign-in form and the document
  /// master password prompt.
  invalidCredential,

  /// The document master password is required, or the unlock window elapsed.
  /// The only failure that carries real meaning, and it tells the user
  /// something they already know.
  locked,

  /// Too many attempts. No timing hint is given.
  tooManyAttempts,

  /// Whatever was asked for is not here.
  notFound,
}

extension FailureMessage on Failure {
  /// User-facing text.
  ///
  /// Every string in here is checked by `scripts/check-forbidden-strings.sh`.
  /// The words "server", "offline", "connection" and their relatives must
  /// never appear — not even in a message that feels harmless.
  String get title => switch (this) {
        Failure.unavailable => '404',
        Failure.notAuthorised => 'Not authorised',
        Failure.invalidCredential => 'Incorrect',
        Failure.locked => 'Locked',
        Failure.tooManyAttempts => 'Too many attempts',
        Failure.notFound => '404',
      };

  String get detail => switch (this) {
        Failure.unavailable => 'Unable to load this page.',
        Failure.notAuthorised => 'This device is not authorised.',
        Failure.invalidCredential => 'Please check your details and try again.',
        Failure.locked => 'Enter the document master password to continue.',
        Failure.tooManyAttempts => 'Please try again later.',
        Failure.notFound => 'Page not found.',
      };
}

/// Thrown by the API layer. Carries a [Failure] and nothing else — no status
/// code, no body, no request id. Anything more would be a channel through
/// which a caller could learn about the deployment.
class VaultException implements Exception {
  const VaultException(this.failure);

  final Failure failure;

  @override
  String toString() => 'VaultException(${failure.name})';
}
