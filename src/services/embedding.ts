export interface KnowledgeChunk {
  id: number;
  title: string;
  content: string;
  score: number;
}

export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeChunk[]> {
  const res = await fetch(`/api/knowledge-search?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}
