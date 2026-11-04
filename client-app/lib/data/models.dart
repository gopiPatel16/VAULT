/// Wire models.
///
/// These mirror exactly what `toDocumentMetadata` on the backend emits. If a
/// field is not here, the client has no way to hold it — which is the point:
/// there is no `storageKey`, no path, and no encryption material anywhere in
/// the client's type system.
class DocumentMeta {
  const DocumentMeta({
    required this.id,
    required this.title,
    required this.filename,
    required this.fileType,
    required this.sizeBytes,
    required this.categorySlug,
    required this.categoryName,
    required this.tags,
    required this.isFavourite,
    required this.documentDate,
    required this.uploadedAt,
  });

  final String id;
  final String title;
  final String filename;
  final String fileType;
  final int sizeBytes;
  final String categorySlug;
  final String categoryName;
  final List<String> tags;
  final bool isFavourite;
  final DateTime? documentDate;
  final DateTime uploadedAt;

  factory DocumentMeta.fromJson(Map<String, dynamic> json) {
    final category = json['category'] as Map<String, dynamic>;
    return DocumentMeta(
      id: json['id'] as String,
      title: json['title'] as String,
      filename: json['filename'] as String,
      fileType: json['fileType'] as String,
      sizeBytes: json['sizeBytes'] as int,
      categorySlug: category['slug'] as String,
      categoryName: category['name'] as String,
      tags: (json['tags'] as List<dynamic>).cast<String>(),
      // Older responses without the field are treated as not favourited
      // rather than throwing: a missing convenience must not break browsing.
      isFavourite: json['isFavourite'] as bool? ?? false,
      documentDate: json['documentDate'] == null
          ? null
          : DateTime.parse(json['documentDate'] as String),
      uploadedAt: DateTime.parse(json['uploadedAt'] as String),
    );
  }

  String get readableSize {
    const units = ['B', 'KB', 'MB', 'GB'];
    var size = sizeBytes.toDouble();
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return '${size.toStringAsFixed(unit == 0 ? 0 : 1)} ${units[unit]}';
  }

  String get shortType => switch (fileType) {
        'application/pdf' => 'PDF',
        'image/png' => 'PNG',
        'image/jpeg' => 'JPG',
        'image/webp' => 'WEBP',
        'image/heic' => 'HEIC',
        'text/plain' => 'TXT',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' =>
          'DOCX',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' =>
          'XLSX',
        _ => 'FILE',
      };

  bool get isImage => fileType.startsWith('image/');

  DocumentMeta withFavourite(bool value) => DocumentMeta(
        id: id,
        title: title,
        filename: filename,
        fileType: fileType,
        sizeBytes: sizeBytes,
        categorySlug: categorySlug,
        categoryName: categoryName,
        tags: tags,
        isFavourite: value,
        documentDate: documentDate,
        uploadedAt: uploadedAt,
      );
}

class CategorySummary {
  const CategorySummary({
    required this.slug,
    required this.name,
    required this.documentCount,
  });

  final String slug;
  final String name;
  final int documentCount;

  factory CategorySummary.fromJson(Map<String, dynamic> json) => CategorySummary(
        slug: json['slug'] as String,
        name: json['name'] as String,
        documentCount: json['documentCount'] as int,
      );
}

class DocumentPage {
  const DocumentPage({
    required this.items,
    required this.total,
    required this.page,
  });

  final List<DocumentMeta> items;
  final int total;
  final int page;

  factory DocumentPage.fromJson(Map<String, dynamic> json) => DocumentPage(
        items: (json['items'] as List<dynamic>)
            .map((e) => DocumentMeta.fromJson(e as Map<String, dynamic>))
            .toList(),
        total: json['total'] as int,
        page: json['page'] as int,
      );
}

class Identity {
  const Identity({required this.displayName, required this.deviceName});

  final String displayName;
  final String deviceName;

  factory Identity.fromJson(Map<String, dynamic> json) => Identity(
        displayName: json['displayName'] as String,
        deviceName: json['deviceName'] as String,
      );
}
