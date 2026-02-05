function formatRelativeTime(isoTimestamp) {
  try {
    const dt = new Date(isoTimestamp);
    const now = new Date();
    const seconds = (now.getTime() - dt.getTime()) / 1000;
    const minutes = seconds / 60;
    const hours = seconds / 3600;
    const days = seconds / 86400;

    if (minutes < 30) return 'just now';
    if (minutes < 60) return `${Math.floor(minutes)}mins ago`;
    if (hours < 24) return `${Math.floor(hours)}hrs ago`;
    if (days < 7) return `${Math.floor(days)}d ago`;

    const month = dt.toLocaleString('en', { month: 'short' });
    if (dt.getFullYear() === now.getFullYear()) {
      return `${dt.getDate()} ${month}`;
    }
    return `${dt.getDate()} ${month}, ${dt.getFullYear()}`;
  } catch {
    return '';
  }
}

function deduplicateMemories(staticFacts, dynamicFacts, searchResults) {
  const seen = new Set();

  const uniqueStatic = staticFacts.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  const uniqueDynamic = dynamicFacts.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  const uniqueSearch = searchResults.filter((r) => {
    const memory = r.memory ?? '';
    if (!memory || seen.has(memory)) return false;
    seen.add(memory);
    return true;
  });

  return {
    static: uniqueStatic,
    dynamic: uniqueDynamic,
    searchResults: uniqueSearch,
  };
}

function formatContext(
  profileResult,
  includeProfile = true,
  includeRelevantMemories = false,
  maxResults = 10,
) {
  if (!profileResult) return null;

  const staticFacts = profileResult.profile?.static || [];
  const dynamicFacts = profileResult.profile?.dynamic || [];
  const searchResults = profileResult.searchResults?.results || [];

  const deduped = deduplicateMemories(
    includeProfile ? staticFacts : [],
    includeProfile ? dynamicFacts : [],
    includeRelevantMemories ? searchResults : [],
  );

  const statics = deduped.static.slice(0, maxResults);
  const dynamics = deduped.dynamic.slice(0, maxResults);
  const search = deduped.searchResults.slice(0, maxResults);

  if (statics.length === 0 && dynamics.length === 0 && search.length === 0) {
    return null;
  }

  const sections = [];

  if (statics.length > 0) {
    sections.push(
      '## User Profile (Persistent)\n' +
        statics.map((f) => `- ${f}`).join('\n'),
    );
  }

  if (dynamics.length > 0) {
    sections.push(
      `## Recent Context\n${dynamics.map((f) => `- ${f}`).join('\n')}`,
    );
  }

  if (search.length > 0) {
    const lines = search.map((r) => {
      const memory = r.memory ?? '';
      const timeStr = r.updatedAt ? formatRelativeTime(r.updatedAt) : '';
      const pct =
        r.similarity != null ? `[${Math.round(r.similarity * 100)}%]` : '';
      const prefix = timeStr ? `[${timeStr}] ` : '';
      return `- ${prefix}${memory} ${pct}`.trim();
    });
    sections.push(
      `## Relevant Memories (with relevance %)\n${lines.join('\n')}`,
    );
  }

  const intro =
    'The following is recalled context about the user. Reference it only when relevant to the conversation.';
  const disclaimer =
    "Use these memories naturally when relevant — including indirect connections — but don't force them into every response or make assumptions beyond what's stated.";

  return `<supermemory-context>\n${intro}\n\n${sections.join('\n\n')}\n\n${disclaimer}\n</supermemory-context>`;
}

module.exports = {
  formatContext,
  formatRelativeTime,
  deduplicateMemories,
};
