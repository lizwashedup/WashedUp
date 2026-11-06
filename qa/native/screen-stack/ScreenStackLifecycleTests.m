#import <XCTest/XCTest.h>
#import <UIKit/UIKit.h>

@interface UIView (ScreenStackTestEntry)
+ (BOOL)shouldBeRecycled;
@end
@interface NSObject (ScreenStackLinkingEntry)
+ (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary *)options;
@end

// A test bundle loaded into an independent copy of the Release simulator app.
// These tests invoke native lifecycle APIs; they do not authenticate or send data.
@interface ScreenStackLifecycleTests : XCTestCase
@end

@implementation ScreenStackLifecycleTests
- (NSArray<UIView *> *)mountedStacks
{
  NSMutableArray<UIView *> *found = [NSMutableArray new];
  NSMutableArray<UIView *> *pending = [NSMutableArray new];
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:UIWindowScene.class]) [pending addObjectsFromArray:((UIWindowScene *)scene).windows];
  }
  NSHashTable *seen = [NSHashTable weakObjectsHashTable];
  while (pending.count) {
    UIView *view = pending.lastObject;
    [pending removeLastObject];
    if ([seen containsObject:view]) continue;
    [seen addObject:view];
    if ([view isKindOfClass:NSClassFromString(@"RNSScreenStackView")]) [found addObject:view];
    [pending addObjectsFromArray:view.subviews];
  }
  return found;
}
- (void)testFullFabricShutdownDuringAuthLinkTransition
{
  XCTestExpectation *ready = [self expectationWithDescription:@"Actual app root is ready"];
  NSDate *startupDeadline = [NSDate dateWithTimeIntervalSinceNow:30];
  __block NSDate *stableSince = nil;
  __block BOOL rootReady = NO;
  [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *timer) {
    @autoreleasepool {
    NSArray<UIView *> *stacks = [self mountedStacks];
    BOOL stable = stacks.count > 0;
    for (UIView *stack in stacks) {
      UINavigationController *nav = [stack valueForKey:@"controller"];
      if (nav.transitionCoordinator) stable = NO;
    }
    if (stable && stableSince == nil) stableSince = [NSDate date];
    if (!stable) stableSince = nil;
    rootReady = stableSince != nil && stableSince.timeIntervalSinceNow < -0.5;
    if (rootReady || startupDeadline.timeIntervalSinceNow <= 0) {
      [timer invalidate]; [ready fulfill];
    }
    }
  }];
  [self waitForExpectations:@[ready] timeout:35];
  XCTAssertTrue(rootReady, @"The actual app must reach a stable mounted root before testing navigation");
  if (!rootReady) return;
  Class linking = NSClassFromString(@"RCTLinkingManager");
  XCTAssertNotNil(linking);
  XCTestExpectation *finished = [self expectationWithDescription:@"Native transition and surface shutdown"];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  [linking application:UIApplication.sharedApplication openURL:[NSURL URLWithString:@"washedupapp://login"] options:@{}];
  [NSTimer scheduledTimerWithTimeInterval:0.01 repeats:YES block:^(NSTimer *timer) {
    @autoreleasepool {
    NSArray<UIView *> *stacks = [self mountedStacks];
    BOOL transitioning = NO;
    for (UIView *stack in stacks) {
      UINavigationController *nav = [stack valueForKey:@"controller"];
      if (nav.transitionCoordinator) transitioning = YES;
    }
    if (!transitioning && deadline.timeIntervalSinceNow > 0) return;
    [timer invalidate];
    if (!transitioning) {
      XCTFail(@"No native auth-link transition observed; shutdown case was not exercised");
      [finished fulfill];
      return;
    }
    NSLog(@"STORE52_FULL_FABRIC shutdown_during_transition stacks=%lu", (unsigned long)stacks.count);
    NSHashTable<UIView *> *weakStacks = [NSHashTable weakObjectsHashTable];
    NSHashTable<UINavigationController *> *weakControllers = [NSHashTable weakObjectsHashTable];
    for (UIView *stack in stacks) {
      [weakStacks addObject:stack];
      [weakControllers addObject:[stack valueForKey:@"controller"]];
    }
    // The same public notification RCTSurfacePresenter observes at termination.
    // Test-only: no actual process termination or user data changes.
    [[NSNotificationCenter defaultCenter] postNotificationName:UIApplicationWillTerminateNotification object:UIApplication.sharedApplication];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      @autoreleasepool {
      NSUInteger retired = 0;
      for (UIView *stack in stacks) if (stack.tag == 0) retired++;
      NSLog(@"STORE52_FULL_FABRIC retired=%lu total=%lu", (unsigned long)retired, (unsigned long)stacks.count);
      XCTAssertEqual(retired, stacks.count, @"All observed Fabric stacks must actually retire");
      for (UIView *stack in stacks) {
        UINavigationController *nav = [stack valueForKey:@"controller"];
        XCTAssertNil(nav.parentViewController, @"Retirement must preserve parent-controller cleanup");
      }
      if (![NSClassFromString(@"RNSScreenStackView") shouldBeRecycled]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          NSLog(@"STORE52_FULL_FABRIC still_retained=%lu", (unsigned long)weakStacks.allObjects.count);
          XCTAssertEqual(weakStacks.allObjects.count, 0u, @"Retired non-recycled stacks must deallocate");
          XCTAssertEqual(weakControllers.allObjects.count, 0u, @"Retired navigation controllers must deallocate");
          [finished fulfill];
        });
      } else {
        [finished fulfill];
      }
      }
    });
    }
  }];
  [self waitForExpectations:@[finished] timeout:10];
}
@end
