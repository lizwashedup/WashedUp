#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>
@interface UIView (ActiveNavigationProbe)
- (void)mountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)willBeUnmountedInUpcomingTransaction;
- (void)invalidate;
- (void)updateContainer;
- (void)retireDeletedFabricStack;
@end
@interface ScreenStackActiveNavigationTests : XCTestCase
@end
@implementation ScreenStackActiveNavigationTests
- (BOOL)waitUntil:(BOOL (^)(void))condition description:(NSString *)description timeout:(NSTimeInterval)timeout
{
  NSPredicate *predicate = [NSPredicate predicateWithBlock:^BOOL(id object, NSDictionary *bindings) {
    @autoreleasepool { return condition(); }
  }];
  XCTNSPredicateExpectation *expectation = [[XCTNSPredicateExpectation alloc] initWithPredicate:predicate object:nil];
  XCTWaiterResult result = [XCTWaiter waitForExpectations:@[expectation] timeout:timeout];
  XCTAssertEqual(result, XCTWaiterResultCompleted, @"%@", description);
  return result == XCTWaiterResultCompleted;
}
- (void)testActiveStackCanOpenCloseAndReopenModal
{
  // Let the actual app establish its key window before a fixture temporarily
  // replaces it. Otherwise startup can steal key-window ownership mid-test.
  __block UIWindow *appWindow = nil;
  BOOL ready = [self waitUntil:^BOOL {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:UIWindowScene.class]) continue;
      for (UIWindow *window in ((UIWindowScene *)scene).windows) {
        if (!window.isKeyWindow) continue;
        NSMutableArray *pending = [NSMutableArray arrayWithObject:window];
        while (pending.count) {
          UIView *view = pending.lastObject; [pending removeLastObject];
          if ([view isKindOfClass:NSClassFromString(@"RNSScreenStackView")]) {
            UINavigationController *navigation = [view valueForKey:@"controller"];
            if (navigation.parentViewController && !navigation.transitionCoordinator) { appWindow=window; return YES; }
          }
          [pending addObjectsFromArray:view.subviews];
        }
      }
    }
    return NO;
  } description:@"Actual app has a mounted root before fixture creation" timeout:30];
  if (!ready) return;
  @autoreleasepool {
    UIWindow *window = [[UIWindow alloc] initWithWindowScene:appWindow.windowScene];
    UIViewController *parent = [UIViewController new]; window.rootViewController = parent; [window makeKeyAndVisible];
    UIView *stack = [[NSClassFromString(@"RNSScreenStackView") alloc] initWithFrame:parent.view.bounds];
    Class screenClass = NSClassFromString(@"RNSScreenView");
    UIView *first = [[screenClass alloc] initWithFrame:stack.bounds]; [first setValue:@2 forKey:@"activityState"];
    [stack mountChildComponentView:first index:0]; [parent.view addSubview:stack]; [window layoutIfNeeded];
    UINavigationController *nav = [stack valueForKey:@"controller"];
    UIView *modalScreen = [[screenClass alloc] initWithFrame:stack.bounds];
    [modalScreen setValue:@2 forKey:@"activityState"]; [modalScreen setValue:@1 forKey:@"stackPresentation"];
    UIViewController *modal = [modalScreen valueForKey:@"controller"];
    [stack mountChildComponentView:modalScreen index:1]; [stack updateContainer];
    [self waitUntil:^BOOL { return modal.presentingViewController && ![[stack valueForKey:@"updatingModals"] boolValue]; }
      description:@"First modal presentation completes" timeout:5];
    XCTAssertEqual(nav.parentViewController,parent);
    [modalScreen willBeUnmountedInUpcomingTransaction];
    [stack unmountChildComponentView:modalScreen index:1]; [stack updateContainer];
    [modalScreen invalidate];
    [self waitUntil:^BOOL { return !modal.presentingViewController && ![[stack valueForKey:@"updatingModals"] boolValue]; }
      description:@"First modal dismissal completes" timeout:5];
    UIView *next = [[screenClass alloc] initWithFrame:stack.bounds];
    [next setValue:@2 forKey:@"activityState"]; [next setValue:@1 forKey:@"stackPresentation"];
    UIViewController *nextModal = [next valueForKey:@"controller"];
    [stack mountChildComponentView:next index:1]; [stack updateContainer];
    [self waitUntil:^BOOL { return nextModal.presentingViewController && ![[stack valueForKey:@"updatingModals"] boolValue]; }
      description:@"Second modal presentation completes" timeout:5];
    XCTAssertEqual(nav.parentViewController,parent);
    XCTAssertEqual([[stack valueForKey:@"presentedModals"] count],1u);
    [stack retireDeletedFabricStack];
    [next willBeUnmountedInUpcomingTransaction]; [first willBeUnmountedInUpcomingTransaction];
    [stack unmountChildComponentView:next index:1]; [stack unmountChildComponentView:first index:0];
    [stack removeFromSuperview];
    dispatch_async(dispatch_get_main_queue(), ^{ [next invalidate]; [first invalidate]; });
    [self waitUntil:^BOOL { return !nextModal.presentingViewController && !nav.parentViewController; }
      description:@"Retired fixture dismisses and detaches" timeout:5];
    window.hidden=YES; window.rootViewController=nil; [appWindow makeKeyAndVisible];
  }
}
@end
