// Frozen pre-optimization sorter: correctness oracle, not production code.
import { tier1Compare, boxesIntersect, isBehind, type Placed, type SortResult } from "../../src/iso/depth";

export function referenceDepthSort(items: Placed[]): SortResult {
  const base = [...items].sort(tier1Compare);
  const n = base.length;
  const cycles: string[][] = [];
  if (n < 2) return { order: base, cycles };

  // Adjacency over screen-overlapping pairs only (Tier 2's cost control).
  const edges: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  let anyEdge = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!boxesIntersect(base[i], base[j])) continue;
      let a = -1, b = -1;
      if (isBehind(base[i], base[j])) { a = i; b = j; }
      else if (isBehind(base[j], base[i])) { a = j; b = i; }
      else continue;
      edges[a].push(b); indeg[b]++; anyEdge = true;
    }
  }
  if (!anyEdge) return { order: base, cycles };

  // Kahn's algorithm, seeded in Tier-1 order so the result is stable and
  // degrades gracefully to Tier 1 where the DAG is silent.
  const out: Placed[] = [];
  const ready: number[] = [];
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  while (ready.length) {
    // pick the Tier-1-smallest ready node (indices are already Tier-1 sorted)
    ready.sort((p, q) => p - q);
    const i = ready.shift()!;
    done[i] = 1;
    out.push(base[i]);
    for (const j of edges[i]) if (--indeg[j] === 0) ready.push(j);
  }

  if (out.length < n) {
    // Tier 3: a cycle. Emit the survivors in Tier-1 order and report them.
    const stuck: Placed[] = [];
    for (let i = 0; i < n; i++) if (!done[i]) stuck.push(base[i]);
    cycles.push(stuck.map((p) => p.sprite));
    out.push(...stuck);
  }
  return { order: out, cycles };
}

