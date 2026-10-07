import { chatLocationLabel, parsePlanChatLocation, readChatLocation } from '../chatLocation';

it('preserves the existing Plan/Circle coordinates and address, including a real zero pin', () => {
  expect(parsePlanChatLocation('{"lat":0,"lng":0,"address":" Equator "}')).toEqual({latitude:0,longitude:0,address:'Equator'});
  expect(parsePlanChatLocation('{"lat":34.0123,"lng":-118.4951,"address":"Ocean Park"}')).toEqual({latitude:34.0123,longitude:-118.4951,address:'Ocean Park'});
});
it.each(['{', 'null', '[]', '{}', '{"lat":"34","lng":-118}', '{"lat":91,"lng":0}', '{"lat":0,"lng":181}'])('does not invent a map destination for malformed payload %s', body => {
  expect(parsePlanChatLocation(body)).toBeNull();
});
it('rejects nonfinite topic coordinates without coercing them', () => {
  expect(readChatLocation(NaN,0,'')).toBeNull();
  expect(readChatLocation(0,Infinity,'')).toBeNull();
  expect(readChatLocation(null,0,'')).toBeNull();
});
it('uses an exact readable coordinate fallback if the saved address is absent', () => {
  const location = readChatLocation(34.0123,-118.4951,undefined)!;
  expect(chatLocationLabel(location)).toBe('34.01230, -118.49510');
  expect(chatLocationLabel({...location,address:'Ocean Park'})).toBe('Ocean Park');
});
