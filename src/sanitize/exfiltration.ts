export interface ExfiltrationSanitizeResult {
  text: string;
  stats: {
    exfiltrationUrls: number;
  };
}

const EXFIL_PARAM_NAMES = ['exfil', 'data', 'payload', 'stolen', 'leak', 'extract', 'dump'];

function isSuspiciousUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Check for long query param values (potential encoded data)
    for (const [, value] of parsed.searchParams) {
      if (value.length > 100) return true;
      if (/^[A-Za-z0-9+\/]{20,}={0,2}$/.test(value)) return true;
    }
    // Check for known exfil param names
    for (const name of EXFIL_PARAM_NAMES) {
      if (parsed.searchParams.has(name)) return true;
    }
    // Suspiciously long URL overall
    if (url.length > 500) return true;
    return false;
  } catch {
    return false;
  }
}

// Matches markdown images: ![alt](url)
const MD_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function sanitizeExfiltration(text: string): ExfiltrationSanitizeResult {
  let count = 0;
  const result = text.replace(MD_IMAGE_PATTERN, (match, alt, url) => {
    if (isSuspiciousUrl(url.trim())) {
      count++;
      return alt ? `[image: ${alt}]` : '[image removed]';
    }
    return match;
  });

  return {
    text: result,
    stats: { exfiltrationUrls: count },
  };
}
