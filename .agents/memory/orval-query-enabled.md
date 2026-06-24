---
name: Orval query enabled pattern
description: How to correctly pass `enabled` in Orval-generated TanStack Query hooks without TS errors.
---

When using Orval-generated hooks with a conditional `enabled` flag, you must also supply `queryKey` in the `query` options object or TypeScript will error with "Property 'queryKey' is missing".

**Rule:** Always include `queryKey` when passing `query` options to a generated hook.

**How to apply:**
```typescript
// WRONG – TS2741 error
useGetBeneficiario(numId, { query: { enabled: !!id } });

// CORRECT
import { useGetBeneficiario, getGetBeneficiarioQueryKey } from "@workspace/api-client-react";
const numId = Number(id);
useGetBeneficiario(numId, { query: { enabled: !!id, queryKey: getGetBeneficiarioQueryKey(numId) } });
```

**Why:** TanStack Query v5 `UseQueryOptions` type requires `queryKey` as a non-optional field. Orval exposes the raw options type directly.
