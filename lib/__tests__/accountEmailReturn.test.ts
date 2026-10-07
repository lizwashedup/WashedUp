import { redirectSystemPath } from '../../app/+native-intent';
import { createAccountEmailApi, AccountEmailFailure } from '../accountEmailContract';
it('strips link credentials only from the new email confirmation destination', () => {
  for (const path of ['/email-confirmation','/email-confirmation/','/email-confirmation/done']) {
    expect(redirectSystemPath({path:`https://washedup.app${path}?access_token=secret#refresh_token=secret`,initial:true})).toBe('/email-confirmation');
  }
  const recovery='https://washedup.app/auth/callback?code=example#access_token=example&type=recovery';
  expect(redirectSystemPath({path:recovery,initial:true})).toBe(recovery);
  expect(redirectSystemPath({path:'https://washedup.app/app/plan/abc?invitation=kept',initial:false})).toBe('/plan/abc?invitation=kept');
  expect(redirectSystemPath({path:'https://washedup.app/app/creator/events',initial:false})).toBe('/(creator)/events');
});
it('classifies missing configuration before network or account mutation', async () => {
  const fetcher=jest.fn(),authorization=jest.fn(); const api=createAccountEmailApi({url:'http://127.0.0.1',anonKey:'public',fetch:fetcher,authorization});
  await expect(api.requestLink('creator@example.com',{userId:'00000000-0000-4000-8000-000000000001',isCurrent:()=>true},'')).rejects.toMatchObject({kind:'invalid'} satisfies Partial<AccountEmailFailure>);
  expect(fetcher).not.toHaveBeenCalled(); expect(authorization).not.toHaveBeenCalled();
});
