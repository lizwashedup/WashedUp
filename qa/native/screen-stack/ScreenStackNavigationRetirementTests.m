#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>
@interface UIView (NavigationRetirementProbe)
- (void)retireDeletedFabricStack;
- (void)mountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)willBeUnmountedInUpcomingTransaction;
- (void)invalidate;
- (void)updateContainer;
@end
@interface NavigationRetirementParentController : UIViewController
@property (nonatomic) BOOL appeared;
@end
@implementation NavigationRetirementParentController
- (void)viewDidAppear:(BOOL)animated { [super viewDidAppear:animated]; self.appeared = YES; }
@end
@interface ScreenStackNavigationRetirementTests : XCTestCase
@end
@implementation ScreenStackNavigationRetirementTests
- (void)runNavigationRetirementInteractive:(BOOL)interactive delay:(NSTimeInterval)delay custom:(BOOL)custom
{
  XCTestExpectation *done = [self expectationWithDescription:@"Navigation transition retired"];
  @autoreleasepool {
    UIWindowScene *scene = nil;
    for (UIScene *item in UIApplication.sharedApplication.connectedScenes)
      if ([item isKindOfClass:UIWindowScene.class]) { scene = (UIWindowScene *)item; break; }
    XCTAssertNotNil(scene);
    __weak UIWindow *previousKeyWindow = nil;
    for (UIWindow *existing in scene.windows) if (existing.isKeyWindow) { previousKeyWindow = existing; break; }
    __block UIWindow *window = [[UIWindow alloc] initWithWindowScene:scene];
    __block NavigationRetirementParentController *parent = [NavigationRetirementParentController new];
    window.rootViewController = parent; [window makeKeyAndVisible];
    __block UIView *stack = [[NSClassFromString(@"RNSScreenStackView") alloc] initWithFrame:parent.view.bounds];
    Class screenClass = NSClassFromString(@"RNSScreenView");
    __block UIView *first = [[screenClass alloc] initWithFrame:stack.bounds];
    __block UIView *second = [[screenClass alloc] initWithFrame:stack.bounds];
    [first setValue:@2 forKey:@"activityState"]; [second setValue:@2 forKey:@"activityState"];
    [stack mountChildComponentView:first index:0];
    [parent.view addSubview:stack]; [window layoutIfNeeded];
    __block UINavigationController *nav = [stack valueForKey:@"controller"];
    XCTAssertEqual(nav.parentViewController, parent);
    if (delay >= 0 || custom) {
      NSPredicate *visible = [NSPredicate predicateWithBlock:^BOOL(id object, NSDictionary *bindings) { return parent.appeared; }];
      XCTNSPredicateExpectation *appearance = [[XCTNSPredicateExpectation alloc] initWithPredicate:visible object:nil];
      XCTAssertEqual([XCTWaiter waitForExpectations:@[appearance] timeout:5], XCTWaiterResultCompleted, @"Fixture must appear before testing an active transition");
    }
    if (custom) [second setValue:@2 forKey:@"stackAnimation"]; // RNSScreenStackAnimationFade
    [stack mountChildComponentView:second index:1];
    if (interactive) {
      [nav pushViewController:[second valueForKey:@"controller"] animated:NO];
      [stack setValue:@YES forKey:@"isFullWidthSwiping"];
      Class interactionClass = NSClassFromString(@"WURetirableInteractiveTransition");
      XCTAssertNotNil(interactionClass);
      UIPercentDrivenInteractiveTransition *interaction = [interactionClass new];
      [stack setValue:interaction forKey:@"interactionController"];
      [nav popViewControllerAnimated:YES];
      [interaction updateInteractiveTransition:0.35];
    } else {
      [stack updateContainer];
    }
    __weak UIView *weakStack = stack;
    __weak UINavigationController *weakNav = nav;
    void (^retire)(void) = ^{
      @autoreleasepool {
        if (delay < 0 && interactive) {
          XCTAssertFalse([[[stack valueForKey:@"interactionController"] valueForKey:@"started"] boolValue], @"Must retire before the native interactive context starts");
        } else if (delay >= 0 && (!interactive || delay > 0)) {
          XCTAssertNotNil(nav.transitionCoordinator, @"Must interrupt an active native transition");
        } else if (interactive) {
          XCTAssertNotNil([stack valueForKey:@"interactionController"], @"Must retire a requested interactive pop, even before UIKit starts it");
        }
        NSLog(@"STORE52_NAV_RETIRE interactive=%d delay=%f active=%d", interactive, delay, nav.transitionCoordinator != nil);
        [stack retireDeletedFabricStack];
        [first willBeUnmountedInUpcomingTransaction]; [second willBeUnmountedInUpcomingTransaction];
        [stack unmountChildComponentView:second index:1]; [stack unmountChildComponentView:first index:0];
        [stack removeFromSuperview];
        // The direct fixture models the child Delete invalidations performed by Fabric.
        dispatch_async(dispatch_get_main_queue(), ^{ [first invalidate]; [second invalidate]; });
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
          @autoreleasepool {
            XCTAssertNil(nav.parentViewController); XCTAssertNil(nav.view.superview); XCTAssertNil(nav.delegate);
            window.hidden = YES; window.rootViewController = nil; [previousKeyWindow makeKeyAndVisible];
            first = nil; second = nil; nav = nil; stack = nil; parent = nil; window = nil;
          }
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            XCTAssertNil(weakStack); XCTAssertNil(weakNav);
            [done fulfill];
          });
        });
      }
    };
    if (delay < 0) retire();
    else dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), retire);
  }
  [self waitForExpectations:@[done] timeout:10];
}
- (void)testRetireBeforeCustomAnimationStarts { [self runNavigationRetirementInteractive:NO delay:-1 custom:YES]; }
- (void)testRetireBeforeInteractiveContextStarts { [self runNavigationRetirementInteractive:YES delay:-1 custom:NO]; }
- (void)testRetireDuringPushImmediately { [self runNavigationRetirementInteractive:NO delay:0 custom:NO]; }
- (void)testRetireDuringPushMidTransition { [self runNavigationRetirementInteractive:NO delay:0.15 custom:NO]; }
- (void)testRetireAsInteractivePopBegins { [self runNavigationRetirementInteractive:YES delay:0 custom:NO]; }
- (void)testRetireDuringInteractivePopMidTransition { [self runNavigationRetirementInteractive:YES delay:0.15 custom:NO]; }
@end
