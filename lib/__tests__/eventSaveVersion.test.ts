import {sameEventSaveVersion} from '../eventSaveVersion';
it('distinguishes a one-microsecond change within the same millisecond',()=>{expect(sameEventSaveVersion('2026-09-15T01:00:00.123456Z','2026-09-15T01:00:00.123457Z')).toBe(false);});
it.each([['2026-09-15T01:00:00.1Z','2026-09-14T18:00:00.100000-07:00'],['2026-09-15T01:00:00Z','2026-09-15T01:00:00.000000+0000']])('compares equivalent timestamps %s', (a,b)=>expect(sameEventSaveVersion(a,b)).toBe(true));
it.each(['invalid','2026-09-15','2026-09-15T01:00:00.1234567Z','9999-09-15T01:00:00Z'])('fails closed for unsupported version %s',a=>expect(()=>sameEventSaveVersion(a,'2026-09-15T01:00:00Z')).toThrow());
