// Session-scoped coordination between one-time prompts that can otherwise
// collide (welcome modal, handle prompt, profile-complete prompt).
// Module-level state resets on every JS bundle reload, which is the intended
// "per session" scope — AsyncStorage handles the persistent "ever shown" flag.

let handlePromptShownThisSession = false;
let welcomeShownThisSession = false;

export function markHandlePromptShown(): void {
  handlePromptShownThisSession = true;
}

export function wasHandlePromptShownThisSession(): boolean {
  return handlePromptShownThisSession;
}

export function markWelcomeShown(): void {
  welcomeShownThisSession = true;
}

export function wasWelcomeShownThisSession(): boolean {
  return welcomeShownThisSession;
}
