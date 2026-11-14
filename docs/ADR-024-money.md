# ADR-024: Money representation

Status: Accepted
Recorded: 2026-11-14 (accepted baseline: `implementation-plan.md` §4.2)
Unblocks: P2-T01, P6-T01
Satisfies: BR §10.4; DEC-001 to DEC-003; INV-13

## Decision

- All money is an integer count of kobo. Database type `bigint`, column names end in `_kobo`. Currency is `NGN`, stored explicitly on order and ledger rows.
- In TypeScript, money is the `Money` primitive. Raw `number` is not accepted by money functions.
- Drizzle `bigint` columns use `mode: 'bigint'`; conversion between `bigint` and `Money` happens only in two helpers (`moneyFromDb`, `moneyToDb`) that throw if a value is outside the safe-integer range.
- The API sends and accepts money as JSON integers named `*Kobo`. Values above `Number.MAX_SAFE_INTEGER` are rejected at the boundary.
- Fee: `round_half_up(subtotal_kobo * basis_points / 10000)`, computed with integer arithmetic only (add `5000` before integer division). Allocation of an amount across lines uses the largest-remainder method so parts always sum to the whole.
- Floating-point arithmetic on money is prohibited. Lint rule: ban `Math.round`, `Math.floor`, `Math.ceil`, `parseFloat` and `.toFixed` outside the money module and display formatters.
- Database `CHECK` constraints: amounts `>= 0` where negative values have no meaning; `total_kobo = subtotal_kobo + fee_kobo` on orders.

## Consequences

- Display formatting (₦ and thousands separators) is the only place that divides by 100.
- Every table that stores money must name the unit in the column name.

## Revisit trigger

A second currency (then add a currency-aware `Money` with minor-unit exponent), or amounts approaching 2^53 kobo (about ₦90 trillion).
