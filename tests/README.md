# Tests

```bash
npm test            # everything
npm run test:unit   # pure logic — no database needed
npm run test:api    # the whole platform over HTTP — needs MongoDB
```

| File | What it proves |
|---|---|
| `unit.test.mjs` | File import parsing and formula neutralising, rupee and date reading, column mapping, payment state rules and signatures, password hashing, authenticator codes, stock and expiry rules, roles and themes |
| `api.test.mjs` | One run of the real API against a real MongoDB: Super Admin only on a fresh install, refresh-token rotation and replay detection, sign-up with an e-mail code, setup checklist, catalogue, purchasing, FEFO selling, prescriptions, udhaar, refunds, day close, reports, staff and own-figures scoping, messaging, themes, support tickets, the platform console, support mode, data import and rollback, tenant isolation, suspension, and the Super Admin changing their own e-mail and password |
| `setup.mjs` | The configuration every test run uses. Tests never read `.env` |
| `support/server.mjs` | Starts the API inside the test process on a free port and drops its database afterwards |

The API suite uses `TEST_MONGODB_URI` when it is set, otherwise the `MONGODB_URI` in `.env` —
always in a fresh database called `ksf_test_<random>`, which is dropped when the suite ends,
so it never touches the data the pharmacies use. Without any MongoDB it is skipped and says why.

Transactions need a replica set: MongoDB Atlas (any tier) or a local `mongod --replSet rs0`.
