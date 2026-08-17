const blocked = (transport) => () => {
  throw new Error(`Network egress is blocked during tests: ${transport}`);
};

const restorations = [];

function replace(target, key, replacement) {
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(target, key);
  const original = target[key];
  target[key] = replacement;
  restorations.push(() => {
    if (hadOwnProperty) target[key] = original;
    else delete target[key];
  });
}

replace(global, 'fetch', blocked('fetch'));
replace(
  global,
  'XMLHttpRequest',
  class BlockedXMLHttpRequest {
    open() {
      return blocked('XMLHttpRequest.open')();
    }

    send() {
      return blocked('XMLHttpRequest.send')();
    }
  },
);
replace(
  global,
  'WebSocket',
  class BlockedWebSocket {
    constructor() {
      return blocked('WebSocket')();
    }
  },
);

for (const moduleName of ['node:http', 'node:https', 'node:net', 'node:tls']) {
  const transport = require(moduleName);
  for (const method of ['request', 'get', 'connect', 'createConnection']) {
    if (typeof transport[method] === 'function') {
      replace(transport, method, blocked(`${moduleName}.${method}`));
    }
  }
}

const net = require('node:net');
const tls = require('node:tls');
replace(net.Socket.prototype, 'connect', blocked('node:net.Socket.connect'));
replace(tls.TLSSocket.prototype, 'connect', blocked('node:tls.TLSSocket.connect'));

const http2 = require('node:http2');
replace(http2, 'connect', blocked('node:http2.connect'));

const dgram = require('node:dgram');
replace(dgram.Socket.prototype, 'send', blocked('node:dgram.Socket.send'));

const dns = require('node:dns');
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) {
  replace(dns, method, blocked(`node:dns.${method}`));
}

const dnsPromises = require('node:dns/promises');
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) {
  replace(dnsPromises, method, blocked(`node:dns/promises.${method}`));
}

afterAll(() => {
  for (const restore of restorations.reverse()) restore();
});
