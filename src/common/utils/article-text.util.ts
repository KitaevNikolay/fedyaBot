export interface ArticleMetadata {
  title: string | null;
  description: string | null;
  images: Map<string, string>;
}

export interface ExtractedArticle {
  body: string;
  metadata: ArticleMetadata;
}

/**
 * Strips non-article blocks (SEO meta, image placeholders, alt text, separators,
 * editorial H-markers) for sending to text.ru uniqueness check.
 */
export function extractArticleBody(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('**Title:**') || t.startsWith('**Description:**')) continue;
    if (t.startsWith('[') && t.endsWith(']')) continue;
    if (t.startsWith('Alt:')) continue;
    if (t === '---') continue;
    result.push(line.replace(/\s*\(H[1-6]\)\s*$/, ''));
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strips SEO meta and replaces image blocks with {{IMAGE_N}} markers
 * for sending to LLM uniquification. Returns cleaned body + metadata
 * needed to restore the full article afterwards.
 */
export function extractArticleBodyWithMarkers(content: string): ExtractedArticle {
  const lines = content.split('\n');
  const result: string[] = [];
  const metadata: ArticleMetadata = {
    title: null,
    description: null,
    images: new Map(),
  };

  let imageIndex = 0;
  let pendingImageKey: string | null = null;
  let pendingImageValue = '';

  for (const line of lines) {
    const t = line.trim();

    if (t.startsWith('**Title:**')) {
      metadata.title = line;
      pendingImageKey = null;
      continue;
    }

    if (t.startsWith('**Description:**')) {
      metadata.description = line;
      pendingImageKey = null;
      continue;
    }

    if (t === '---') {
      pendingImageKey = null;
      continue;
    }

    // Image placeholder line: [Иллюстрация: ...] or [ПРОВЕРИТЬ: ...]
    if (t.startsWith('[') && t.endsWith(']')) {
      imageIndex++;
      pendingImageKey = `{{IMAGE_${imageIndex}}}`;
      pendingImageValue = line;
      continue;
    }

    // Alt text immediately follows the image placeholder
    if (pendingImageKey !== null && t.startsWith('Alt:')) {
      metadata.images.set(pendingImageKey, `${pendingImageValue}\n${line}`);
      result.push(pendingImageKey);
      pendingImageKey = null;
      pendingImageValue = '';
      continue;
    }

    // Image placeholder without Alt — flush it
    if (pendingImageKey !== null) {
      metadata.images.set(pendingImageKey, pendingImageValue);
      result.push(pendingImageKey);
      pendingImageKey = null;
      pendingImageValue = '';
    }

    result.push(line.replace(/\s*\(H[1-6]\)\s*$/, ''));
  }

  // Flush any trailing image placeholder
  if (pendingImageKey !== null) {
    metadata.images.set(pendingImageKey, pendingImageValue);
    result.push(pendingImageKey);
  }

  const body = result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, metadata };
}

/**
 * Validates that all IMAGE markers from metadata are present in the rewritten body.
 * Returns missing marker keys, empty array means all OK.
 */
export function findMissingImageMarkers(
  rewrittenBody: string,
  metadata: ArticleMetadata,
): string[] {
  const missing: string[] = [];
  for (const key of metadata.images.keys()) {
    if (!rewrittenBody.includes(key)) {
      missing.push(key);
    }
  }
  return missing;
}

/**
 * Restores Title, Description and image blocks into the rewritten body.
 */
export function restoreArticleMetadata(
  rewrittenBody: string,
  metadata: ArticleMetadata,
): string {
  let text = rewrittenBody;

  // Restore image blocks
  for (const [key, value] of metadata.images.entries()) {
    text = text.split(key).join(value);
  }

  // Prepend Title + Description
  const metaLines: string[] = [];
  if (metadata.title) metaLines.push(metadata.title);
  if (metadata.description) metaLines.push(metadata.description);

  if (metaLines.length > 0) {
    text = metaLines.join('\n') + '\n\n' + text;
  }

  return text;
}
