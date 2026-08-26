import type { AggregatedReview, ReviewFinding, ReviewSeverity, TargetEvidence, TransactionReview } from './model'
import { mostSevere, severityRank } from './model'

/** One policy applies semantic findings, incomplete coverage, and oracle evidence. */
export function aggregateReview(review: TransactionReview, evidence: TargetEvidence[]): AggregatedReview {
  const findings: ReviewFinding[] = [...review.findings]

  for (const item of evidence) {
    if (item.status === 'unavailable') {
      findings.push({
        code: 'oracle-unavailable', severity: 'warning', title: 'Destination assessment unavailable',
        detail: `No risk assessment was available for ${item.target.value}.`,
      })
    } else if ((item.score ?? 0) > 75) {
      findings.push({
        code: 'oracle-critical', severity: 'critical', title: 'Critical destination risk signal',
        detail: `The destination assessment returned score ${item.score}.`,
      })
    } else if ((item.score ?? 0) > 50) {
      findings.push({
        code: 'oracle-high', severity: 'high', title: 'High destination risk signal',
        detail: `The destination assessment returned score ${item.score}.`,
      })
    } else if ((item.score ?? 0) > 20) {
      findings.push({
        code: 'oracle-elevated', severity: 'warning', title: 'Elevated destination risk signal',
        detail: `The destination assessment returned score ${item.score}.`,
      })
    }
  }

  // The UI must never present partial/opaque semantics as an unqualified low-risk review.
  if (review.operations.some((operation) => operation.coverage !== 'understood')) {
    findings.push({
      code: 'incomplete-coverage', severity: 'warning', title: 'Some transaction effects are not fully understood',
      detail: 'Review every partial or opaque operation before proceeding.',
    })
  }

  const severity = mostSevere(findings)
  return { review, evidence, findings, severity }
}

export function tierForReviewSeverity(severity: ReviewSeverity): 'low' | 'elevated' | 'high' | 'critical' {
  return severityRank[severity] >= severityRank.critical
    ? 'critical'
    : severityRank[severity] >= severityRank.high
      ? 'high'
      : severityRank[severity] >= severityRank.warning
        ? 'elevated'
        : 'low'
}
