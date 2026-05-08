# Minimal repro for TanStack/router#7361

Reproduction repo for [TanStack/router#7361](https://github.com/TanStack/router/issues/7361) — `[Start RSC] SerovalUnsupportedTypeError on RawStream during dev SSR — production unaffected`.

## What this is

Vanilla [TanStack `start-basic` example](https://github.com/tanstack/router/tree/main/examples/react/start-basic), with **one** intentional modification to demonstrate the bug:

```bash
bun add @tanstack/router-core@1.168.0
```

That single command forces a `@tanstack/router-core` version conflict at the project root vs the exact `1.169.2` pins inside every `@tanstack/start-*` package. bun cannot satisfy both with one hoisted copy, so it nests — producing 10 distinct on-disk copies of `router-core` (1 root + 9 nested). Each copy defines its own `RawStream` class. `RawStreamSSRPlugin.test()` does `value instanceof RawStream`, which fails cross-realm, and the seroval pipeline throws.

The two commits in `git log` show the exact diff: one to import vanilla `start-basic`, one to apply the `bun add` conflict.

## Reproducing

```bash
git clone https://github.com/Vijayabaskar56/tanstack-rsc-rawstream-cross-realm-repro
cd tanstack-rsc-rawstream-cross-realm-repro
bun install
bun dev
```

Open [http://localhost:3000/](http://localhost:3000/).

### Observed

- **Page renders blank.**
- **Server terminal:**
  ```
  Serialization error: SerovalUnsupportedTypeError: The value [object Object] of type "object" cannot be parsed/serialized.
    value: RawStream { stream: ReadableStream, hint: 'text' }
      at Object.stream (.../router-core/src/ssr/serializer/transformer.ts:193)
  ```
- **Browser console:**
  ```
  Invariant failed: Expected to find a dehydrated data on window.$_TSR.router, but we did not.
  An error occurred in the <AwaitInner> component.
  ```

### Confirming the trigger is duplication on disk

```bash
find node_modules -path "*@tanstack/router-core/package.json" -not -path "*router-generator*" | wc -l
# → 10
```

### Reverting the experiment (no code change made or reverted)

```bash
bun remove @tanstack/router-core
rm -rf node_modules
bun install
# → 1 hoisted copy of router-core; page renders cleanly
```

## Why this is a fair representation, not contrived

`@tanstack/start-*` packages publish with **exact** internal pins (`"@tanstack/router-core": "1.169.2"`, not `"^1.169.2"`). Daily releases + downstream lockfiles that lag a few days = different `start-*` packages pinning different exact versions ⇒ every install on that lockfile nests `router-core` ⇒ bug fires.

A larger consumer-side reproduction where this happened organically: [timelessco/reform/blob/main/src/routes/rsc-test.tsx](https://github.com/timelessco/reform/blob/main/src/routes/rsc-test.tsx). Same code on the deployed Vercel build renders cleanly: <https://better-forms-mu.vercel.app/rsc-test> — because Rollup dedupes at build time, but Vite dev respects nested `node_modules` resolution.

## Validated fix

`bun patch` workaround merged in production: [timelessco/reform#73](https://github.com/timelessco/reform/pull/73). Brands `RawStream` instances with `Symbol.for('tanstack.router.RawStream')` and replaces both `instanceof RawStream` checks with brand checks. `Symbol.for` resolves to the same symbol across module realms by spec, so the brand survives any duplication scenario.

```diff
 var RawStream = class {
   constructor(stream, options) {
     this.stream = stream;
-    this.hint = options?.hint ?? "binary";
+    this.hint = options?.hint ?? "binary"; this[Symbol.for("tanstack.router.RawStream")] = true;
   }
 };
 ...
-    return value instanceof RawStream;
+    return value !== null && typeof value === "object" && value[Symbol.for("tanstack.router.RawStream")] === true;
```

The same change could be ported to TypeScript source in `packages/router-core/src/ssr/serializer/RawStream.ts` — happy to open a PR if the brand approach looks right.

## Related

- Issue: [TanStack/router#7361](https://github.com/TanStack/router/issues/7361)
- Closed precedent (same root-cause class, different file): [TanStack/router#6994](https://github.com/TanStack/router/pull/6994), [TanStack/router#6982](https://github.com/TanStack/router/issues/6982)
- Original RawStream PR: [TanStack/router#6231](https://github.com/TanStack/router/pull/6231)
- Latest commit on `RawStream.ts` (instanceof unchanged): [TanStack/router#7144](https://github.com/TanStack/router/pull/7144)
