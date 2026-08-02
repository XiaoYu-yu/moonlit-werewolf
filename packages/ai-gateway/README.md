# AI cost accounting contract

The Worker enforces two Redis-backed budgets before any chat provider call:

- `AI_DAILY_BUDGET_CENTS` is bucketed by the Beijing calendar day
  (`Asia/Shanghai`, fixed UTC+08:00).
- `AI_MATCH_BUDGET_CENTS` is bucketed by the job's authoritative `matchId`.

Both counters are checked and reserved in one Lua invocation. All related keys use the
`{ai-budget}` Redis Cluster hash tag and have TTLs. Completed calls settle the reservation to the
gateway's cumulative provider cost. A provider call that starts but returns no trustworthy usage is
charged its conservative estimate; an unexpected gateway failure settles the full turn
reservation. If Redis cannot reserve, the Worker does not contact a provider and returns the job's
deterministic legal fallback.

`AI_MIN_RESERVATION_CENTS` defaults to `1` and cannot be zero. A request with neither a positive
`estimatedCostCents` nor configured pricing therefore still consumes a conservative reservation.
When both exist, the larger explicit-or-price-derived estimate wins. The reservation covers that
maximum for every possible primary/fallback attempt.
Optional provider prices use:

```text
AI_PRICE_<PROVIDER>_INPUT_CENTS_PER_MILLION
AI_PRICE_<PROVIDER>_OUTPUT_CENTS_PER_MILLION
```

`<PROVIDER>` is `DEEPSEEK` or `KIMI`. The Worker also supports
`AI_MAX_ATTEMPTS_PER_PROVIDER`, `AI_MATCH_BUDGET_TTL_SECONDS`,
`AI_BUDGET_SETTLEMENT_GRACE_SECONDS`, and an optional process-local second ceiling through
`AI_PROCESS_BUDGET_CENTS`.

BullMQ job IDs become deterministic reservation IDs. Any active, settled, or released reservation
marker is treated as a replay and cannot invoke a provider again. Markers retain their original
daily and match keys so a retry across Beijing midnight cannot mutate the new day's counter.

Costs are stored internally as integer thousandths of a cent, rounded upward, so fractional costs
cannot bypass an integer-cent budget.
