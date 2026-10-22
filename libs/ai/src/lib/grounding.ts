import type { AiArtifactMeta, GroundedClaim } from '@soccalytics/contracts';
import { factKey, type Facts } from './context.js';

/**
 * Hallucination guard. Each claim's evidence must reference a subject and
 * metric present in the context with (approximately) the same value.
 * Tolerance allows for the model rounding 0.87 → 0.9 but not inventing data.
 */
export function verifyClaims(
  claims: GroundedClaim[],
  facts: Facts,
  extraViolations: string[] = [],
): AiArtifactMeta['grounding'] {
  const violations = [...extraViolations];
  let verified = 0;
  for (const claim of claims) {
    if (!claim.evidence.length) {
      violations.push(`No evidence for claim: "${truncate(claim.text)}"`);
      continue;
    }
    let ok = true;
    for (const ev of claim.evidence) {
      const expected = facts.get(factKey(ev.subject, ev.metric));
      if (expected === undefined) {
        ok = false;
        violations.push(`Unknown metric ${ev.metric} for ${ev.subject}`);
      } else if (!approxEqual(expected, ev.value)) {
        ok = false;
        violations.push(`${ev.subject}.${ev.metric}: cited ${ev.value}, actual ${expected}`);
      }
    }
    if (ok) verified++;
  }
  return { claims: claims.length, verified, violations };
}

export function approxEqual(expected: number, cited: number): boolean {
  const abs = Math.abs(expected - cited);
  return abs <= 0.051 || abs / Math.max(Math.abs(expected), 1e-9) <= 0.02;
}

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);
