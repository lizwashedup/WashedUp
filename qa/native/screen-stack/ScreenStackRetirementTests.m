#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>

@interface UIView (RetirementExperiment)
+ (BOOL)shouldBeRecycled;
- (void)retireDeletedFabricStack;
- (void)invalidate;
- (void)mountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)willBeUnmountedInUpcomingTransaction;
- (void)updateContainer;
- (void)maybeAddToParentAndUpdateContainer;
@end

@interface ScreenStackRetirementTests : XCTestCase
@end

@implementation ScreenStackRetirementTests
- (void)testStackOptsOutOfReuse
{
  Class stackClass = NSClassFromString(@"RNSScreenStackView");
  XCTAssertNotNil(stackClass);
  XCTAssertFalse([stackClass shouldBeRecycled]);
}
- (void)runModalRetirementAfter:(NSTimeInterval)delay alreadyDismissing:(BOOL)alreadyDismissing
{
  XCTestExpectation *finished = [self expectationWithDescription:@"Retired stack cleanup and release"];
  @autoreleasepool {
  UIWindowScene *scene = nil;
  for (UIScene *candidate in UIApplication.sharedApplication.connectedScenes) {
    if ([candidate isKindOfClass:UIWindowScene.class]) { scene = (UIWindowScene *)candidate; break; }
  }
  XCTAssertNotNil(scene);
    __weak UIWindow *previousKeyWindow = nil;
    for (UIWindow *existing in scene.windows) if (existing.isKeyWindow) { previousKeyWindow = existing; break; }
  __block UIWindow *window = [[UIWindow alloc] initWithWindowScene:scene];
  __block UIViewController *parent = [UIViewController new];
  window.rootViewController = parent;
  [window makeKeyAndVisible];
  __block UIView *stack = [[NSClassFromString(@"RNSScreenStackView") alloc] initWithFrame:parent.view.bounds];
  Class screenClass = NSClassFromString(@"RNSScreenView");
  __block UIView *first = [[screenClass alloc] initWithFrame:stack.bounds];
  __block UIView *second = [[screenClass alloc] initWithFrame:stack.bounds];
  [first setValue:@2 forKey:@"activityState"];
  [second setValue:@2 forKey:@"activityState"];
  [second setValue:@1 forKey:@"stackPresentation"];
  [stack mountChildComponentView:first index:0];
  [parent.view addSubview:stack];
  [window layoutIfNeeded];
  __block UINavigationController *navigation = [stack valueForKey:@"controller"];
  XCTAssertEqual(navigation.parentViewController, parent);
  __block UIViewController *modal = [second valueForKey:@"controller"];
  [stack mountChildComponentView:second index:1];
  [stack updateContainer];
  __weak UIView *weakStack = stack;
  __weak UINavigationController *weakNavigation = navigation;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    XCTAssertNotNil(modal.presentingViewController, @"Modal presentation must actually begin");
    if (alreadyDismissing) [modal dismissViewControllerAnimated:YES completion:nil];
    [first willBeUnmountedInUpcomingTransaction];
    [second willBeUnmountedInUpcomingTransaction];
    [stack retireDeletedFabricStack];
    [stack unmountChildComponentView:second index:1];
    [stack unmountChildComponentView:first index:0];
    [stack removeFromSuperview];
    [stack retireDeletedFabricStack]; // Duplicate lifecycle notification must not repeat cleanup.
    // Direct fixture must model the child Delete invalidations normally queued by
    // mountingTransactionWillMount/DidMount; unmount alone does not delete screens.
    dispatch_async(dispatch_get_main_queue(), ^{ [first invalidate]; [second invalidate]; });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      XCTAssertNil(navigation.parentViewController);
      XCTAssertNil(navigation.view.superview);
      XCTAssertNil(modal.presentingViewController);
      XCTAssertEqual([[stack valueForKey:@"presentedModals"] count], 0u);
      // Delayed layout/navigation work must not reattach a deleted stack.
      [parent.view addSubview:stack];
      [stack updateContainer];
      [stack maybeAddToParentAndUpdateContainer];
      XCTAssertNil(navigation.parentViewController);
      [stack removeFromSuperview];
      window.hidden = YES;
      window.rootViewController = nil;
      [previousKeyWindow makeKeyAndVisible];
      first = nil; second = nil; modal = nil; navigation = nil; stack = nil; parent = nil; window = nil;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        XCTAssertNil(weakStack, @"Deleted stack should not leak after transitions complete");
        XCTAssertNil(weakNavigation, @"Deleted navigation controller should not leak");
        [finished fulfill];
      });
    });
  });
  } // Drain setup KVC autoreleases before waiting for weak-reference assertions.
  [self waitForExpectations:@[finished] timeout:10];
}
- (void)testRetireDuringModalPresentation { [self runModalRetirementAfter:0.02 alreadyDismissing:NO]; }
- (void)testRetireWithPresentedModal { [self runModalRetirementAfter:0.8 alreadyDismissing:NO]; }
- (void)testRetireDuringModalDismissal { [self runModalRetirementAfter:0.8 alreadyDismissing:YES]; }
@end
