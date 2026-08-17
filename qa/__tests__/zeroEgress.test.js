describe('zero egress guard', () => {
  it('blocks browser transport entry points', () => {
    expect(() => global.fetch('https://example.com')).toThrow(
      'Network egress is blocked during tests: fetch',
    );
    expect(() => new global.XMLHttpRequest().open('GET', 'https://example.com')).toThrow(
      'Network egress is blocked during tests: XMLHttpRequest.open',
    );
    expect(() => new global.WebSocket('wss://example.com')).toThrow(
      'Network egress is blocked during tests: WebSocket',
    );
  });

  it('blocks Node transport entry points', () => {
    expect(() => require('node:https').request('https://example.com')).toThrow(
      'Network egress is blocked during tests: node:https.request',
    );
    expect(() => new (require('node:net').Socket)().connect(443, 'example.com')).toThrow(
      'Network egress is blocked during tests: node:net.Socket.connect',
    );
    expect(() => require('node:tls').TLSSocket.prototype.connect.call({})).toThrow(
      'Network egress is blocked during tests: node:tls.TLSSocket.connect',
    );
    expect(() => require('node:http2').connect('https://example.com')).toThrow(
      'Network egress is blocked during tests: node:http2.connect',
    );
    const socket = require('node:dgram').createSocket('udp4');
    expect(() => socket.send('blocked', 9, 'example.com')).toThrow(
      'Network egress is blocked during tests: node:dgram.Socket.send',
    );
    socket.close();
    expect(() => require('node:dns').lookup('example.com', () => {})).toThrow(
      'Network egress is blocked during tests: node:dns.lookup',
    );
    expect(() => require('node:dns/promises').lookup('example.com')).toThrow(
      'Network egress is blocked during tests: node:dns/promises.lookup',
    );
  });
});
