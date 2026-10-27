import {
  handleMonitorRequest,
  type MonitorDependencies,
} from "../monitor-push-health/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
const registration = {
  completed_24h: 10,
  covered_24h: 8,
  coverage: 0.8,
  refreshed_24h: 15,
  active_24h: 20,
  evaluated: true,
  healthy: true,
};
const delivery = {
  recipients: 100,
  delivered: 20,
  ratio: 0.2,
  evaluated: true,
  healthy: true,
};
function fixture() {
  const reads: Record<string, { data: unknown; error: unknown }> = {
    recent_edge_function_failures: { data: [], error: null },
    push_registration_health_v2: { data: [{ ...registration }], error: null },
    push_delivery_health: { data: [{ ...delivery }], error: null },
  };
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const emails: string[] = [];
  let clients = 0;
  const deps: MonitorDependencies = {
    runToken: "test-only-token",
    configured: true,
    timeoutMs: 100,
    createRpc: () => {
      clients++;
      return (name, args) => {
        calls.push({ name, args });
        return Promise.resolve(
          name === "record_push_health"
            ? { data: false, error: null }
            : reads[name],
        );
      };
    },
    sendAlert: (subject) => {
      emails.push(subject);
      return Promise.resolve(true);
    },
  };
  const request = (method = "POST", token: string | null = deps.runToken!) =>
    new Request("https://example.test/monitor", {
      method,
      headers: token === null ? {} : { "x-run-token": token },
    });
  const run = async () => (await handleMonitorRequest(request(), deps)).json();
  return { deps, reads, calls, emails, request, run, clients: () => clients };
}

for (
  const [method, token, status] of [
    ["GET", "test-only-token", 405],
    ["POST", null, 401],
    ["POST", "", 401],
    ["POST", "wrong", 401],
    ["OPTIONS", null, 204],
  ] as const
) {
  Deno.test(`${method} / ${token ?? "missing token"} does no privileged work`, async () => {
    const f = fixture();
    const response = await handleMonitorRequest(
      f.request(method, token),
      f.deps,
    );
    equal(response.status, status);
    equal(f.clients(), 0);
    equal(f.calls, []);
    equal(f.emails, []);
  });
}
Deno.test("missing server token or configuration fails closed", async () => {
  for (const patch of [{ runToken: undefined }, { configured: false }]) {
    const f = fixture();
    Object.assign(f.deps, patch);
    equal(
      (await handleMonitorRequest(f.request("POST", "test-only-token"), f.deps))
        .status,
      503,
    );
    equal(f.clients(), 0);
  }
});
Deno.test("healthy results record all three checks without sending mail", async () => {
  const f = fixture();
  const body = await f.run();
  equal(body.ok, true);
  equal(body.health, "healthy");
  equal(body.monitoringOk, true);
  equal(f.calls.filter((c) => c.name === "record_push_health").length, 3);
  equal(f.emails, []);
});
Deno.test("low volume is explicitly not evaluated, not an outage", async () => {
  const f = fixture();
  f.reads.push_registration_health_v2.data = [{
    ...registration,
    completed_24h: 0,
    covered_24h: 0,
    coverage: null,
    evaluated: false,
  }];
  f.reads.push_delivery_health.data = [{
    ...delivery,
    recipients: 0,
    delivered: 0,
    ratio: null,
    evaluated: false,
  }];
  const body = await f.run();
  equal(body.ok, true);
  equal(body.health, "not_evaluated");
  equal(body.checks.registration.health, "not_evaluated");
  equal(f.emails, []);
});
Deno.test("a debounced outage still reports unhealthy and ok false", async () => {
  const f = fixture();
  f.reads.push_delivery_health.data = [{
    ...delivery,
    delivered: 0,
    ratio: 0,
    healthy: false,
  }];
  const body = await f.run();
  equal(body.ok, false);
  equal(body.health, "unhealthy");
  equal(body.monitoringOk, true);
  equal(body.checks.delivery.alert, "suppressed");
  equal(f.emails, []);
});
for (
  const data of [null, [], [{}], [{ ...delivery, healthy: "yes" }], [{
    ...delivery,
    recipients: -1,
  }]]
) {
  Deno.test(`missing or malformed diagnostic is unknown: ${JSON.stringify(data)}`, async () => {
    const f = fixture();
    f.reads.push_delivery_health.data = data;
    const body = await f.run();
    equal(body.ok, false);
    equal(body.health, "unknown");
    equal(body.checks.delivery.recorded, false);
    equal(body.checks.edge.health, "healthy");
    equal(f.calls.filter((c) => c.args?.p_kind === "delivery").length, 0);
  });
}
Deno.test("an RPC error wins over stale healthy data", async () => {
  const f = fixture();
  f.reads.push_delivery_health.error = { message: "offline" };
  const body = await f.run();
  equal(body.ok, false);
  equal(body.checks.delivery.health, "unknown");
});
Deno.test("a failed health record preserves the diagnosis but prevents alert sending", async () => {
  const f = fixture();
  f.reads.push_delivery_health.data = [{ ...delivery, healthy: false }];
  const original = f.deps.createRpc;
  f.deps.createRpc = () => {
    const rpc = original();
    return (name, args) =>
      name === "record_push_health" && args?.p_kind === "delivery"
        ? Promise.resolve({ data: true, error: { message: "write failed" } })
        : rpc(name, args);
  };
  const body = await f.run();
  equal(body.ok, false);
  equal(body.monitoringOk, false);
  equal(body.checks.delivery.health, "unhealthy");
  equal(body.checks.delivery.alert, "unknown");
  equal(f.emails, []);
});
for (const outcome of ["accepted", "rejected", "throws", "hangs"] as const) {
  Deno.test(`alert ${outcome} does not conceal the outage or stop other checks`, async () => {
    const f = fixture();
    f.deps.timeoutMs = 10;
    f.reads.push_delivery_health.data = [{ ...delivery, healthy: false }];
    const original = f.deps.createRpc;
    f.deps.createRpc = () => {
      const rpc = original();
      return (name, args) =>
        name === "record_push_health"
          ? Promise.resolve({ data: true, error: null })
          : rpc(name, args);
    };
    f.deps.sendAlert = async (subject) => {
      f.emails.push(subject);
      if (outcome === "throws") throw new Error("offline");
      if (outcome === "hangs") return await new Promise<boolean>(() => {});
      return outcome === "accepted";
    };
    const body = await f.run();
    equal(body.ok, false);
    equal(body.health, "unhealthy");
    equal(
      body.checks.delivery.alert,
      outcome === "accepted"
        ? "accepted"
        : outcome === "rejected"
        ? "failed"
        : "unknown",
    );
    equal(body.checks.edge.health, "healthy");
    equal(body.checks.registration.health, "healthy");
    equal(f.emails.length, 1); // A true record result never emails for a healthy check.
  });
}
Deno.test("a hanging diagnostic is bounded and the other checks finish", async () => {
  const f = fixture();
  f.deps.timeoutMs = 10;
  const original = f.deps.createRpc;
  f.deps.createRpc = () => {
    const rpc = original();
    return (name, args) =>
      name === "recent_edge_function_failures"
        ? new Promise(() => {})
        : rpc(name, args);
  };
  const body = await f.run();
  equal(body.ok, false);
  equal(body.checks.edge.health, "unknown");
  equal(body.checks.delivery.health, "healthy");
});
Deno.test("edge errors are counted and email samples are escaped", async () => {
  const f = fixture();
  f.reads.recent_edge_function_failures.data = [{
    status_code: 401,
    created: "<time>",
    content: "<script>bad</script>",
  }];
  const original = f.deps.createRpc;
  f.deps.createRpc = () => {
    const rpc = original();
    return (name, args) =>
      name === "record_push_health"
        ? Promise.resolve({ data: true, error: null })
        : rpc(name, args);
  };
  f.deps.sendAlert = (_, html) => {
    assert(html.includes("&lt;script&gt;"));
    assert(!html.includes("<script>"));
    return Promise.resolve(true);
  };
  const body = await f.run();
  equal(body.checks.edge.metrics.failures_15m, 1);
  equal(body.checks.edge.alert, "accepted");
  equal(body.ok, false);
});
Deno.test("quiet signups do not hide the existing active-subscription floor", async () => {
  const f = fixture();
  f.reads.push_registration_health_v2.data = [{
    ...registration,
    completed_24h: 0,
    covered_24h: 0,
    coverage: null,
    active_24h: 2,
    evaluated: false,
    healthy: false,
  }];
  const body = await f.run();
  equal(body.ok, false);
  equal(body.checks.registration.health, "unhealthy");
  equal(body.checks.registration.alert, "suppressed");
});
Deno.test("a timed-out health record is not repeated or assumed to authorize mail", async () => {
  const f = fixture();
  f.deps.timeoutMs = 10;
  f.reads.push_delivery_health.data = [{ ...delivery, healthy: false }];
  const original = f.deps.createRpc;
  let claims = 0;
  f.deps.createRpc = () => {
    const rpc = original();
    return (name, args) => {
      if (name === "record_push_health" && args?.p_kind === "delivery") {
        claims++;
        return new Promise(() => {});
      }
      return rpc(name, args);
    };
  };
  const body = await f.run();
  equal(body.ok, false);
  equal(body.checks.delivery.health, "unhealthy");
  equal(body.checks.delivery.alert, "unknown");
  equal(claims, 1);
  equal(f.emails, []);
});
